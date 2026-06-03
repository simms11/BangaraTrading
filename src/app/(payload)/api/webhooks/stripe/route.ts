import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { getLogger } from '@/lib/logger'
import { verifyStripeWebhook } from '@/lib/payments/stripe'
import { getPayload } from '@/lib/payload'
import {
  markOrderPaid,
  resolveOrderEmail,
  cancelOrderAndReleaseInventory,
} from '@/lib/orders'
import { sendOrderConfirmation } from '@/lib/email'
import { formatPrice } from '@/lib/utils'
import { claimEvent, hasEvent } from '@/lib/idempotency'
import type { Order } from '@/payload-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const signature = req.headers.get('stripe-signature')
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  const rawBody = await req.text()
  let event: Stripe.Event
  try {
    event = verifyStripeWebhook(rawBody, signature)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Verification failed' },
      { status: 400 },
    )
  }

  // R7 round-7 reliability M9 — refuse test-mode events in production.
  // The signing-secret check alone doesn't catch the operator-misconfig
  // case where the prod STRIPE_WEBHOOK_SECRET is accidentally set to
  // the test-mode secret (the Stripe dashboard shows both side-by-side).
  // Without this, test orders would be created as real production
  // orders. event.livemode is set by Stripe per event.
  if (process.env.NODE_ENV === 'production' && event.livemode === false) {
    getLogger().error(
      { eventId: event.id, type: event.type },
      'stripe-webhook refused test-mode event in production',
    )
    return NextResponse.json(
      { error: 'test_event_in_production' },
      { status: 400 },
    )
  }

  // B16/B17 fix: check idempotency, but don't *claim* until we've actually
  // processed the event. If we 4xx out of business logic (e.g. amount
  // mismatch), Stripe retries — and a retry hitting an already-claimed key
  // would no-op even though we never updated the order.
  if (await hasEvent({ processor: 'stripe', eventId: event.id })) {
    return NextResponse.json({ received: true, idempotent: true })
  }

  // R7 round-7 C2: take a Postgres transaction-scope advisory lock keyed
  // on the event id BEFORE processing. Two concurrent deliveries of the
  // same event (Stripe retried because our first response was slow) used
  // to both pass `hasEvent` and both run business logic, producing
  // duplicate confirmation emails and racing the tax/total update. The
  // lock serialises so the second delivery blocks until the first
  // commits its claim, then sees `hasEvent=true` on its own retry.
  const stripePayload = await getPayload()
  const stripeLockPool = (stripePayload.db as unknown as {
    pool: import('pg').Pool
  }).pool
  const lockClient = await stripeLockPool.connect()
  try {
    // pg_advisory_lock is session-scoped and we must release it
    // explicitly; use a single dedicated connection so we don't leak
    // it back to the pool while still holding the lock.
    await lockClient.query(`SELECT pg_advisory_lock(hashtext($1))`, [
      `stripe-evt:${event.id}`,
    ])
    // Re-check idempotency inside the lock — the lock-holder we just
    // unblocked from may have just written the claim.
    if (await hasEvent({ processor: 'stripe', eventId: event.id })) {
      return NextResponse.json({ received: true, idempotent: true })
    }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session
      const orderId = session.metadata?.orderId || session.client_reference_id
      if (!orderId) {
        await claimEvent({
          processor: 'stripe',
          eventId: event.id,
          kind: event.type,
        })
        return NextResponse.json({ received: true, ignored: 'no_order_id' })
      }

      // Verify the amount Stripe charged matches what we recorded on the order.
      const payload = await getPayload()
      const existing = (await payload.findByID({
        collection: 'orders',
        id: orderId,
        depth: 0,
        overrideAccess: true,
      })) as Order
      // B62 fix + R7 round-7 C2: when Stripe Tax is enabled, Stripe adds
      // VAT/sales-tax on top of our recorded subtotal. We compare against
      // a STABLE expected (subtotal + shipping − discount) so a webhook
      // retry doesn't observe `existing.totalMinor` after a prior retry
      // already wrote tax INTO it — which would otherwise cause every
      // retry to demand 2× tax and 4× tax… and Stripe to give up after
      // 72h with the order stuck in pending_payment and the customer
      // charged. The previous `expected = existing.totalMinor` was the
      // bug because totalMinor mutates between retries.
      //
      // Tax/total writes are also now gated on `status='pending_payment'`
      // via a conditional UPDATE so a webhook arriving for a paid (or
      // cancelled) order can't retroactively rewrite the totals.
      const taxFromStripe = session.total_details?.amount_tax ?? 0
      const stableExpected =
        (existing.subtotalMinor ?? 0) +
        (existing.shippingMinor ?? 0) -
        (existing.discountMinor ?? 0)
      const paid = session.amount_total ?? 0
      if (paid - taxFromStripe !== stableExpected) {
        getLogger().error(
          {
            orderId,
            stableExpected,
            paid,
            tax: taxFromStripe,
            currentTotalMinor: existing.totalMinor,
            eventId: event.id,
          },
          'stripe-webhook amount mismatch',
        )
        return NextResponse.json(
          {
            error: 'amount_mismatch',
            expected: stableExpected,
            paid,
            tax: taxFromStripe,
          },
          { status: 400 },
        )
      }

      if (taxFromStripe > 0 && existing.taxMinor !== taxFromStripe) {
        // Conditional UPDATE: only write the tax when the order is still
        // pending_payment. A webhook retry that races a paid status flip
        // can no longer overwrite totals on a settled order.
        const pool = (payload.db as unknown as { pool: import('pg').Pool }).pool
        await pool.query(
          `UPDATE orders
             SET tax_minor = $1,
                 total_minor = $2,
                 updated_at = NOW()
           WHERE id = $3
             AND status = 'pending_payment'::enum_orders_status`,
          [taxFromStripe, stableExpected + taxFromStripe, orderId],
        )
      }

      const order = (await markOrderPaid(orderId, {
        processor: 'stripe',
        processorRef: session.id,
        // C3 fix: capture the underlying PaymentIntent now so refund
        // webhooks (which arrive carrying `pi_…`, not `cs_…`) can resolve
        // back to this order via `payment.processorIntentRef`.
        processorIntentRef:
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id,
        // Clean-room money M1 — the true charged amount (incl. Stripe Tax)
        // so a paid-after-cancel auto-refund makes the customer whole even
        // when the order's totalMinor never captured the tax.
        amountChargedMinor: session.amount_total ?? undefined,
      })) as Order

      // Claim after the order is marked paid. If email send fails the claim
      // still holds — the retry queue (Phase 5.7) covers email; we don't
      // want Stripe redelivering and re-marking-paid.
      await claimEvent({
        processor: 'stripe',
        eventId: event.id,
        kind: event.type,
        orderId,
      })

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
      const recipient =
        (await resolveOrderEmail(order)) ?? session.customer_details?.email ?? null
      if (!recipient) {
        // Email field redacted at the field level by pino redact paths.
        getLogger().error(
          { orderNumber: order.orderNumber, eventId: event.id },
          'stripe-webhook cannot resolve email — skipping confirmation',
        )
        return NextResponse.json({ received: true, warning: 'no_email' })
      }
      await sendOrderConfirmation({
        to: recipient,
        props: {
          orderNumber: order.orderNumber,
          customerName: order.shippingAddress?.name ?? undefined,
          totalFormatted: formatPrice(order.totalMinor, order.currency),
          // Final audit (frontend) — itemize so line items sum to Total
          // (Stripe Tax may have adjusted totalMinor; show the breakdown).
          // R10: include Tax row when > 0 so the customer doesn't see an
          // unexplained gap between Subtotal+Shipping and Total.
          subtotalFormatted: formatPrice(order.subtotalMinor, order.currency),
          shippingFormatted: formatPrice(order.shippingMinor ?? 0, order.currency),
          taxFormatted:
            order.taxMinor && order.taxMinor > 0
              ? formatPrice(order.taxMinor, order.currency)
              : undefined,
          currency: order.currency,
          siteUrl,
          items: (order.lineItems ?? []).map((l) => ({
            title: l.titleSnapshot,
            quantity: l.quantity,
            lineTotalFormatted: formatPrice(l.lineTotalMinor, order.currency),
          })),
        },
      })
    } else if (
      event.type === 'checkout.session.expired' ||
      event.type === 'payment_intent.payment_failed'
    ) {
      // B72 fix: previously these events were swallowed by the "Unhandled
      // event type" branch and the order sat in pending_payment forever,
      // with the inventory we deducted at order creation still held. The
      // cancelOrderAndReleaseInventory helper conditionally flips the order
      // to 'cancelled' (only if still pending_payment so an out-of-order
      // delivery after `completed` doesn't undo a paid order) and atomically
      // increments stock back.
      let orderId: string | undefined
      if (event.type === 'checkout.session.expired') {
        const session = event.data.object as Stripe.Checkout.Session
        orderId = session.metadata?.orderId || session.client_reference_id || undefined
      } else {
        const intent = event.data.object as Stripe.PaymentIntent
        orderId = intent.metadata?.orderId || undefined
        // J3 (round-4 M9) — `payment_intent.payment_failed` events for
        // PIs created out-of-band (Stripe's hosted recovery link, dashboard
        // manual capture, merchant-initiated retries) do NOT inherit the
        // `payment_intent_data.metadata` we set on the original Checkout
        // Session, so `orderId` is missing. Fall back to looking up the
        // order by `payment.processorIntentRef` (which we capture for the
        // original PI on mark-paid); if that fails too, log at warn so ops
        // sees a stuck-inventory candidate instead of silently no-op'ing.
        if (!orderId) {
          try {
            const payload = await getPayload()
            const { docs } = await payload.find({
              collection: 'orders',
              where: { 'payment.processorIntentRef': { equals: intent.id } },
              limit: 1,
              overrideAccess: true,
            })
            if (docs[0]) {
              orderId = String(docs[0].id)
            }
          } catch (e) {
            getLogger().warn(
              { eventId: event.id, piId: intent.id, err: e instanceof Error ? e.message : String(e) },
              'stripe-webhook payment_intent.payment_failed lookup-by-PI failed',
            )
          }
          if (!orderId) {
            getLogger().warn(
              { eventId: event.id, piId: intent.id },
              'stripe-webhook payment_intent.payment_failed received for out-of-band PI; inventory may be stuck',
            )
          }
        }
      }
      if (orderId) {
        try {
          await cancelOrderAndReleaseInventory(orderId, `stripe:${event.type}`)
        } catch (e) {
          getLogger().error(
            {
              orderId,
              eventType: event.type,
              eventId: event.id,
              err: e instanceof Error ? e.message : String(e),
            },
            'stripe-webhook cancel/release failed',
          )
        }
      }
      await claimEvent({
        processor: 'stripe',
        eventId: event.id,
        kind: event.type,
        orderId,
      })
    } else if (event.type === 'charge.refunded') {
      // B18 fix: capture the refund into our ledger so the data matches
      // reality. Stripe-initiated refunds (via Stripe dashboard) reach us
      // via this event; our own auto-refund flow also produces this event
      // and we deduplicate via processorRef.
      //
      // C3 fix: `charge.payment_intent` is a PaymentIntent id (`pi_…`),
      // but our order stores the Checkout Session id (`cs_…`) in
      // `payment.processorRef`. The previous code queried
      // `payment.processorRef equals charge.payment_intent` and matched
      // nothing — every Stripe-dashboard refund was silently dropped
      // from our ledger. We now look up via `payment.processorIntentRef`
      // which we capture from session.payment_intent on completion.
      const charge = event.data.object as Stripe.Charge
      const paymentIntentId =
        typeof charge.payment_intent === 'string'
          ? charge.payment_intent
          : charge.payment_intent?.id ?? ''
      const payload = await getPayload()
      const { docs } = await payload.find({
        collection: 'orders',
        where: { 'payment.processorIntentRef': { equals: paymentIntentId } },
        limit: 1,
        overrideAccess: true,
      })
      const order = docs[0]
      if (order) {
        // I9 (M19) fix: when Stripe sends the charge object without the
        // `refunds.data` list expanded (basic event payload), iterating
        // the empty array silently drops the refund. Fall back to the
        // Refunds API to fetch the real list. Also track an in-loop
        // seen-set so a duplicate refund id within a single payload
        // (Stripe quirk) only inserts once.
        let refunds = charge.refunds?.data ?? []
        if (refunds.length === 0 && charge.id) {
          try {
            // J1 (round-4 m3) — reuse the singleton + pinned API version
            // from stripe.ts. The previous fallback constructed a new
            // Stripe client per call, defeating HTTP keep-alive and
            // drifting the apiVersion from the rest of the codebase.
            const { getStripeClient } = await import('@/lib/payments/stripe')
            const client = getStripeClient()
            if (client) {
              const listed = await client.refunds.list({ charge: charge.id, limit: 100 })
              refunds = listed.data
            }
          } catch (e) {
            console.warn(
              `[stripe-webhook] could not list refunds for charge ${charge.id}:`,
              e instanceof Error ? e.message : String(e),
            )
          }
        }
        const seenInPayload = new Set<string>()
        for (const r of refunds) {
          if (seenInPayload.has(r.id)) continue
          seenInPayload.add(r.id)
          const existing = await payload.find({
            collection: 'refunds',
            where: { processorRef: { equals: r.id } },
            limit: 1,
            overrideAccess: true,
          })
          if (existing.docs.length > 0) continue
          // R7 round-7 reliability M10 — map Stripe's refund.status to
          // our internal status. Previously we wrote 'completed'
          // unconditionally even for refunds Stripe reported as
          // `pending` (e.g. bank-rejected ACH reversal that may never
          // settle) or `failed`. Mis-recording a pending refund as
          // completed silently under-pays the vendor on the next
          // payout statement because the payout query treats our
          // 'completed' refunds as fully settled.
          const internalStatus: 'completed' | 'processing' | 'failed' =
            r.status === 'succeeded'
              ? 'completed'
              : r.status === 'failed' || r.status === 'canceled'
                ? 'failed'
                : 'processing'
          await payload.create({
            collection: 'refunds',
            overrideAccess: true,
            data: {
              reference: r.id,
              order: order.id,
              status: internalStatus,
              amountMinor: r.amount,
              currency: r.currency.toUpperCase() as
                | 'NAD'
                | 'ZAR'
                | 'USD'
                | 'GBP'
                | 'EUR',
              reason:
                r.reason === 'fraudulent'
                  ? 'fraud'
                  : r.reason === 'requested_by_customer'
                    ? 'requested_by_customer'
                    : 'other',
              description: 'Captured via Stripe charge.refunded webhook',
              processor: 'stripe',
              processorRef: r.id,
              refundedAt: new Date(r.created * 1000).toISOString(),
            },
          })
        }
      }
      await claimEvent({
        processor: 'stripe',
        eventId: event.id,
        kind: event.type,
        orderId: order?.id,
      })
    } else if (
      event.type === 'charge.refund.updated' ||
      event.type === 'refund.updated'
    ) {
      // M1 (Phase 2) — advance an existing refund row when Stripe's
      // refund status changes (pending → succeeded / pending → failed).
      // Without this, a Stripe refund initially reported as `pending`
      // (e.g. an ACH reversal) stays as `processing` in our ledger
      // forever; if it ultimately FAILS at Stripe, payouts continue to
      // deduct it from the vendor's gross even though no money was
      // actually refunded — silent vendor under-payment. Find the row
      // by processorRef = the Stripe refund id; map status; update.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ref = event.data.object as any
      const refundId: string | undefined = ref?.id
      const stripeStatus: string | undefined = ref?.status
      if (refundId && stripeStatus) {
        const payload = await getPayload()
        const { docs } = await payload.find({
          collection: 'refunds',
          where: { processorRef: { equals: refundId } },
          limit: 1,
          overrideAccess: true,
        })
        const row = docs[0] as { id: number | string; status?: string } | undefined
        if (row) {
          const next =
            stripeStatus === 'succeeded'
              ? 'completed'
              : stripeStatus === 'failed' || stripeStatus === 'canceled'
                ? 'failed'
                : 'processing'
          if (row.status !== next) {
            try {
              await payload.update({
                collection: 'refunds',
                id: row.id,
                overrideAccess: true,
                data:
                  next === 'completed'
                    ? { status: next, refundedAt: new Date().toISOString() }
                    : { status: next },
              })
            } catch (e) {
              getLogger().error(
                { refundId, next, err: e instanceof Error ? e.message : String(e) },
                'stripe-webhook refund.updated patch failed',
              )
            }
          }
        }
      }
      await claimEvent({
        processor: 'stripe',
        eventId: event.id,
        kind: event.type,
      })
    } else {
      // Unhandled event type — claim so Stripe stops retrying.
      await claimEvent({
        processor: 'stripe',
        eventId: event.id,
        kind: event.type,
      })
    }
    return NextResponse.json({ received: true })
  } catch (e) {
    getLogger().error(
      { eventId: event.id, err: e instanceof Error ? e.message : String(e) },
      'stripe-webhook handler exception',
    )
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Internal error' },
      { status: 500 },
    )
  }
  } finally {
    // Release the advisory lock and the dedicated client. Use pg_advisory_unlock
    // with the same key (best-effort; the lock is also auto-released when the
    // session ends, but we release explicitly to free the slot immediately).
    try {
      await lockClient.query(`SELECT pg_advisory_unlock(hashtext($1))`, [
        `stripe-evt:${event.id}`,
      ])
    } catch {
      // ignore — connection release below covers it
    }
    lockClient.release()
  }
}
