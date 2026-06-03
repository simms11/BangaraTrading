import type { TaskConfig, Where } from 'payload'

/**
 * L1 (chaos C1 mitigation): find pending_payment orders whose inventory
 * was decremented at creation but which have been sitting > 30 minutes
 * with no payment confirmation. These are the residue of failure modes
 * the round-5 chaos audit flagged:
 *
 *   - Stripe `checkout.sessions.create` timed out after the order was
 *     created and inventory decremented, but before the user was redirected.
 *   - The processor session was created but the customer abandoned the
 *     hosted-checkout page and no `checkout.session.expired` event ever
 *     fired (or our webhook missed it).
 *   - revertDecrements failed mid-recovery because the DB pool was down,
 *     leaving the order row absent + inventory stuck.
 *
 * For each match we call `cancelOrderAndReleaseInventory`, which:
 *   1. Atomically flips status → cancelled (no-op if already moved).
 *   2. Releases inventory ONLY if inventoryDecremented=true (so we don't
 *      double-credit stock on quote-derived orders).
 *
 * Runs every 15 minutes via the same cron tick as the rest of the
 * scheduled jobs. Safe to run more often if abandonment volume warrants.
 */
type IO = {
  input: Record<string, never>
  output: { scanned: number; cancelled: number; releaseFailures: number }
}

const ABANDON_THRESHOLD_MINUTES = 30
const BATCH_LIMIT = 100

export const sweepAbandonedOrdersTask: TaskConfig<IO> = {
  slug: 'sweepAbandonedOrders',
  retries: 1,
  handler: async ({ req }) => {
    // R7 round-7 concurrency m2 — overlap guard. A single sweep tick
    // can take >15 min under heavy backlog (up to 100 orders × Stripe
    // probe = several minutes); the cron then re-fires before the
    // first finishes. Without this, two workers double-probe the same
    // orders and double Stripe API rate-limit consumption. Try a
    // non-blocking advisory lock; bail cleanly if another instance
    // already holds it. The lock auto-releases on session close.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lockPool = (req.payload.db as any).pool as
      | { connect: () => Promise<{ query: (text: string, params?: unknown[]) => Promise<{ rows: Array<{ acquired: boolean }> }>; release: () => void }> }
      | undefined
    let lockClient: Awaited<ReturnType<NonNullable<typeof lockPool>['connect']>> | null = null
    if (lockPool) {
      lockClient = await lockPool.connect()
      const acquired = await lockClient.query(
        `SELECT pg_try_advisory_lock(hashtext($1)) AS acquired`,
        ['job:sweepAbandonedOrders'],
      )
      if (!acquired.rows[0]?.acquired) {
        lockClient.release()
        req.payload.logger?.info?.(
          `[jobs:sweepAbandonedOrders] skipping — previous tick still running`,
        )
        return { output: { scanned: 0, cancelled: 0, releaseFailures: 0 } }
      }
    }

    const cutoff = new Date(
      Date.now() - ABANDON_THRESHOLD_MINUTES * 60 * 1000,
    ).toISOString()
    let scanned = 0
    let cancelled = 0
    let releaseFailures = 0
    try {

    // Pull abandoned candidates in batches, advancing an id cursor each
    // iteration. Final audit M-1 fix: the previous loop sorted by
    // createdAt and never passed a page/offset, so every iteration
    // re-queried the HEAD of the same filtered set. That drained only
    // because processed orders left the filter — but an order whose
    // Stripe session is still `open` is skipped WITHOUT leaving the
    // filter, so a wall of ≥BATCH_LIMIT open-session orders would make
    // every page re-fetch the same head and never reach genuinely-
    // abandoned orders sitting behind them. Cursoring on the monotonic
    // `id` guarantees forward progress regardless of which rows leave
    // the filter.
    let lastId: number | string | null = null
    for (let page = 1; page < 20; page++) {
      const cursorClause: Where[] =
        lastId != null ? [{ id: { greater_than: lastId } }] : []
      const { docs } = await req.payload.find({
        collection: 'orders',
        where: {
          and: [
            { status: { equals: 'pending_payment' } },
            { createdAt: { less_than: cutoff } },
            { inventoryDecremented: { equals: true } },
            // R8 business M3 — never sweep manual / bank-transfer orders.
            // They legitimately sit in pending_payment for hours/days
            // awaiting the customer's transfer; cancelling at 30 min
            // strands the incoming funds (and manual has no auto-refund).
            { 'payment.processor': { not_equals: 'manual' } },
            ...cursorClause,
          ],
        },
        limit: BATCH_LIMIT,
        depth: 0,
        sort: 'id',
        overrideAccess: true,
      })
      if (docs.length === 0) break
      scanned += docs.length
      // Advance the cursor past this page's last id before processing,
      // so the next iteration never re-fetches these rows.
      lastId = docs[docs.length - 1]!.id

      const { cancelOrderAndReleaseInventory } = await import('@/lib/orders')
      for (const o of docs) {
        try {
          // M2 (round-6) — Stripe session cross-check. Before cancelling
          // an "abandoned" order, ask Stripe whether the checkout session
          // is still `open` (customer still on the hosted page) or already
          // `complete` but the webhook is lagging. Skipping these avoids
          // the worst flavour of the paid-after-cancel race: we observe
          // session=open, we cancel, customer pays, webhook arrives →
          // paid-after-cancel auto-refund chain fires. With the check we
          // simply don't cancel and let the next sweep tick re-evaluate.
          //
          // Only checked when we have a stripe processor reference on
          // the order. Manual/Flutterwave orders short-circuit. Any
          // Stripe API error is non-fatal — we fall back to the prior
          // behaviour (cancel), since stranded inventory is the worse
          // failure mode and the paid-after-cancel chain still recovers
          // customer funds via auto-refund.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const stripeRef = ((o as any).payment?.processor === 'stripe'
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ? (o as any).payment?.processorRef
            : null) as string | null
          if (stripeRef && stripeRef.startsWith('cs_')) {
            try {
              const { getStripeClient } = await import('@/lib/payments/stripe')
              const stripe = getStripeClient()
              if (stripe) {
                const session = await stripe.checkout.sessions.retrieve(stripeRef, {
                  // R7 round-7 reliability C1: cap probe at 5s so a Stripe
                  // hang doesn't stall the whole sweeper batch past the
                  // Vercel function deadline.
                  timeout: 5_000,
                } as Parameters<typeof stripe.checkout.sessions.retrieve>[1])
                if (session.status === 'open') {
                  req.payload.logger?.info?.(
                    `[jobs:sweepAbandonedOrders] skipping order ${o.id} — Stripe session ${stripeRef} status=open (customer still on hosted page); not cancelling.`,
                  )
                  continue
                }
                if (session.status === 'complete') {
                  // R7 round-7 money M1: payment SUCCEEDED at Stripe but
                  // the `checkout.session.completed` webhook never reached
                  // us (rotated secret, dropped event, 72h retry window
                  // exhausted). The old code unconditionally `continue`d
                  // here, stranding the order permanently — subsequent
                  // sweep ticks would see `complete` again, skip again,
                  // forever; inventory leaked, customer charged with no
                  // order. Now we treat the sweeper as a webhook fallback:
                  // call markOrderPaid with the session data so the same
                  // happy-path runs and the order finalises. Idempotent
                  // and safe — markOrderPaid is gated by status=
                  // 'pending_payment' at the SQL level.
                  try {
                    const { markOrderPaid, resolveOrderEmail } = await import('@/lib/orders')
                    const intentId =
                      typeof session.payment_intent === 'string'
                        ? session.payment_intent
                        : session.payment_intent?.id
                    const recovered = await markOrderPaid(o.id, {
                      processor: 'stripe',
                      processorRef: session.id,
                      processorIntentRef: intentId,
                      // R10 — when the webhook is missed and we recover
                      // here, the webhook's tax-write never ran. Pass
                      // session.amount_total so markOrderPaid reconciles
                      // totalMinor/taxMinor; otherwise on Stripe-Tax
                      // orders the order under-records by the tax (and a
                      // later full refund would be capped short).
                      amountChargedMinor: session.amount_total ?? undefined,
                    })
                    // M13 (Phase 2) — send the confirmation email and
                    // claim a synthetic event so a delayed real webhook
                    // becomes idempotent. Without this, a webhook-miss
                    // recovery silently never produced a confirmation
                    // email and the customer had no proof of order.
                    try {
                      const recipient =
                        (await resolveOrderEmail(recovered)) ??
                        session.customer_details?.email ??
                        null
                      if (recipient) {
                        const { sendOrderConfirmation } = await import('@/lib/email')
                        const { formatPrice } = await import('@/lib/utils')
                        const siteUrl =
                          process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
                        await sendOrderConfirmation({
                          to: recipient,
                          props: {
                            orderNumber: recovered.orderNumber,
                            customerName: recovered.shippingAddress?.name ?? undefined,
                            totalFormatted: formatPrice(recovered.totalMinor, recovered.currency),
                            subtotalFormatted: formatPrice(
                              recovered.subtotalMinor,
                              recovered.currency,
                            ),
                            shippingFormatted: formatPrice(
                              recovered.shippingMinor ?? 0,
                              recovered.currency,
                            ),
                            taxFormatted:
                              recovered.taxMinor && recovered.taxMinor > 0
                                ? formatPrice(recovered.taxMinor, recovered.currency)
                                : undefined,
                            currency: recovered.currency,
                            siteUrl,
                            items: (recovered.lineItems ?? []).map((l) => ({
                              title: l.titleSnapshot,
                              quantity: l.quantity,
                              lineTotalFormatted: formatPrice(
                                l.lineTotalMinor,
                                recovered.currency,
                              ),
                            })),
                          },
                        })
                      } else {
                        req.payload.logger?.warn?.(
                          `[jobs:sweepAbandonedOrders] recovered order ${o.id} but could not resolve email — confirmation skipped.`,
                        )
                      }
                    } catch (mailErr) {
                      req.payload.logger?.error?.(
                        `[jobs:sweepAbandonedOrders] confirmation send failed for recovered order ${o.id}: ${
                          mailErr instanceof Error ? mailErr.message : String(mailErr)
                        }`,
                      )
                    }
                    // Claim a synthetic event id so a delayed real Stripe
                    // redelivery of checkout.session.completed short-
                    // circuits via hasEvent and doesn't send the email
                    // again. The Stripe webhook uses event.id as the
                    // claim key; we synthesise a sweeper-specific key so
                    // a later real event with a DIFFERENT event.id still
                    // hits the SQL conditional and no-ops on status.
                    try {
                      const { claimEvent } = await import('@/lib/idempotency')
                      await claimEvent({
                        processor: 'stripe',
                        eventId: `sweeper:${session.id}`,
                        kind: 'sweeper.recovery',
                        orderId: String(recovered.id),
                      })
                    } catch (claimErr) {
                      req.payload.logger?.warn?.(
                        `[jobs:sweepAbandonedOrders] synthetic claim failed for ${o.id}: ${
                          claimErr instanceof Error ? claimErr.message : String(claimErr)
                        }`,
                      )
                    }
                    req.payload.logger?.warn?.(
                      `[jobs:sweepAbandonedOrders] recovered order ${o.id} via sweeper fallback — Stripe session ${stripeRef} was complete but webhook never arrived.`,
                    )
                    try {
                      const Sentry = await import('@sentry/nextjs').catch(() => null)
                      Sentry?.captureMessage(
                        `Stripe webhook miss: order ${o.id} session ${stripeRef} complete but no webhook — sweeper finalised it.`,
                        'warning',
                      )
                    } catch {
                      // Sentry not configured
                    }
                  } catch (e) {
                    req.payload.logger?.error?.(
                      `[jobs:sweepAbandonedOrders] fallback markOrderPaid failed for ${o.id}: ${
                        e instanceof Error ? e.message : String(e)
                      }`,
                    )
                  }
                  continue
                }
              }
            } catch (e) {
              req.payload.logger?.warn?.(
                `[jobs:sweepAbandonedOrders] Stripe session probe failed for ${stripeRef} (proceeding with cancel): ${
                  e instanceof Error ? e.message : String(e)
                }`,
              )
            }
          }
          const result = await cancelOrderAndReleaseInventory(
            o.id,
            `sweep:abandoned (created ${new Date((o as { createdAt?: string }).createdAt ?? '').toISOString()})`,
          )
          if (result.cancelled) cancelled += 1
        } catch (e) {
          releaseFailures += 1
          req.payload.logger?.error?.(
            `[jobs:sweepAbandonedOrders] cancel failed for order ${o.id}: ${
              e instanceof Error ? e.message : String(e)
            }`,
          )
        }
      }
      if (docs.length < BATCH_LIMIT) break
    }

    req.payload.logger?.info?.(
      `[jobs:sweepAbandonedOrders] scanned=${scanned} cancelled=${cancelled} failures=${releaseFailures}`,
    )
    return { output: { scanned, cancelled, releaseFailures } }
    } finally {
      // Release the overlap-guard lock.
      if (lockClient) {
        try {
          await lockClient.query(`SELECT pg_advisory_unlock(hashtext($1))`, [
            'job:sweepAbandonedOrders',
          ])
        } catch {
          // session-close releases anyway
        }
        lockClient.release()
      }
    }
  },
}
