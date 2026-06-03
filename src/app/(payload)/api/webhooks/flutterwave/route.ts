import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { verifyFlutterwaveTransaction } from '@/lib/payments/flutterwave'
import { getPayload } from '@/lib/payload'
import { markOrderPaid, resolveOrderEmail } from '@/lib/orders'
import { sendOrderConfirmation } from '@/lib/email'
import { formatPrice } from '@/lib/utils'
import { claimEvent, hasEvent } from '@/lib/idempotency'
import type { Order } from '@/payload-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) return false
  return timingSafeEqual(aBuf, bBuf)
}

type FlutterwavePayload = {
  event?: string
  'event.type'?: string
  data?: {
    id?: number | string
    tx_ref?: string
    flw_ref?: string
    status?: string
    amount?: number
    /** Refund-shaped events include this — id of the parent transaction. */
    transaction_id?: number | string
    currency?: string
    meta?: { orderId?: string | number }
    /** Some refund payloads use this naming variant */
    reason?: string
  }
}

// J3 (round-4 M10) — refund webhook event names Flutterwave is known to
// send. We accept a small allow-list; anything else falls through to the
// charge-success branch as before.
const REFUND_EVENT_TYPES = new Set([
  'refund.completed',
  'charge.refunded',
  'transfer.completed', // some accounts route refunds as transfers
])

export async function POST(req: Request) {
  const secret = process.env.FLUTTERWAVE_WEBHOOK_SECRET
  const signature = req.headers.get('verif-hash')
  // M16 fix: timing-safe compare. Plain `!==` returns early on the first
  // differing byte and leaks the length of the matching prefix via response
  // time — small risk for a fixed-length shared secret, but trivial to fix.
  if (!secret || !signature || !constantTimeEqual(signature, secret)) {
    return NextResponse.json({ error: 'Bad signature' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as FlutterwavePayload | null
  if (!body?.data) return NextResponse.json({ error: 'Missing payload' }, { status: 400 })

  const txId = body.data.id
  if (!txId) return NextResponse.json({ error: 'Missing transaction id' }, { status: 400 })

  // B16/B17 fix: check (don't claim yet) so a retry after a hard failure
  // can re-attempt instead of getting an idempotent no-op.
  if (await hasEvent({ processor: 'flutterwave', eventId: String(txId) })) {
    return NextResponse.json({ received: true, idempotent: true })
  }

  // R11 — per-event advisory lock (mirrors the Stripe webhook). Without
  // this, two concurrent Flutterwave deliveries of the same event both
  // pass `hasEvent` before either calls `claimEvent`, then both proceed
  // to create duplicate refund rows / send duplicate confirmation
  // emails. markOrderPaid is SQL-atomic so the order flip itself is
  // safe, but the email and the refund-create are not. Bracket the
  // whole handler so concurrent retries serialise behind the lock; the
  // second delivery sees the claim on its re-check and exits cleanly.
  const fwLockPayload = await getPayload()
  const fwLockPool = (fwLockPayload.db as unknown as {
    pool: import('pg').Pool
  }).pool
  const fwLockClient = await fwLockPool.connect()
  try {
    await fwLockClient.query(`SELECT pg_advisory_lock(hashtext($1))`, [
      `flw-evt:${txId}`,
    ])
    if (await hasEvent({ processor: 'flutterwave', eventId: String(txId) })) {
      return NextResponse.json({ received: true, idempotent: true })
    }

  // J3 (round-4 M10) — refund branch. Dashboard-initiated refunds previously
  // had NO handler; the ledger silently diverged from reality. We look up
  // the originating order by `payment.processorIntentRef` (the parent
  // transaction id we now store on markOrderPaid) and create a refund row.
  // Best-effort — if the parent isn't found we log and claim so Flutterwave
  // stops retrying. Operators reconcile manually for orphans.
  const eventName = (body.event ?? body['event.type'] ?? '').toString()
  if (REFUND_EVENT_TYPES.has(eventName)) {
    const parentTxId = body.data.transaction_id ?? body.data.id
    const payload = await getPayload()
    const { docs } = await payload.find({
      collection: 'orders',
      where: { 'payment.processorIntentRef': { equals: String(parentTxId) } },
      limit: 1,
      overrideAccess: true,
    })
    const parentOrder = docs[0]
    if (parentOrder) {
      const reference = body.data.flw_ref ?? `flw_refund_${txId}`
      const existing = await payload.find({
        collection: 'refunds',
        where: { processorRef: { equals: reference } },
        limit: 1,
        overrideAccess: true,
      })
      if (existing.docs.length === 0) {
        try {
          // Final audit M1 — map Flutterwave's refund status to our
          // internal status instead of hardcoding 'completed'. A refund
          // Flutterwave reports as pending/failed must NOT be recorded
          // completed, or generateVendorStatement treats it as settled
          // and deducts from the vendor's gross for money that may never
          // come back. Mirror the Stripe charge.refunded handler.
          const fwStatus = String(body.data.status ?? '').toLowerCase()
          const internalStatus: 'completed' | 'processing' | 'failed' =
            fwStatus === 'completed' || fwStatus === 'successful'
              ? 'completed'
              : fwStatus === 'failed'
                ? 'failed'
                : 'processing'
          // Final audit M1 — guard against zero-decimal currencies before
          // the `* 100` minor-unit conversion (the charge-success path
          // already does this; the refund branch was missing it, so a
          // refund in a zero-decimal currency would record 100× the real
          // amount and blow the cumulative-refund ledger).
          const refundCurrency = String(
            body.data.currency ?? parentOrder.currency,
          ).toUpperCase()
          const SUPPORTED_TWO_DECIMAL = new Set(['NAD', 'ZAR', 'USD', 'GBP', 'EUR'])
          if (!SUPPORTED_TWO_DECIMAL.has(refundCurrency)) {
            console.error(
              `[flutterwave-webhook] refund in unsupported currency ${refundCurrency} — refusing to guess minor units; manual reconciliation required (ref ${reference}).`,
            )
          } else {
            await payload.create({
              collection: 'refunds',
              overrideAccess: true,
              data: {
                reference,
                order: parentOrder.id,
                status: internalStatus,
                amountMinor: Math.round((body.data.amount ?? 0) * 100),
                currency: refundCurrency as 'NAD' | 'ZAR' | 'USD' | 'GBP' | 'EUR',
                reason: 'requested_by_customer',
                description: `Captured via Flutterwave ${eventName} webhook (status=${fwStatus || 'unknown'})`,
                processor: 'flutterwave',
                processorRef: reference,
                refundedAt: new Date().toISOString(),
              },
            })
          }
        } catch (e) {
          console.error('[flutterwave-webhook] refund create failed:', e)
        }
      }
    } else {
      console.warn(
        `[flutterwave-webhook] received ${eventName} but parent order not found (txId=${parentTxId})`,
      )
    }
    await claimEvent({
      processor: 'flutterwave',
      eventId: String(txId),
      kind: eventName,
      orderId: parentOrder?.id ? String(parentOrder.id) : undefined,
    })
    return NextResponse.json({ received: true })
  }

  // Always re-verify by hitting Flutterwave's verify endpoint — never trust
  // the webhook body alone.
  const verified = await verifyFlutterwaveTransaction(String(txId))
  if (!verified || verified.status !== 'successful') {
    // Not-paid is also a terminal-ish state; claim so we stop seeing this.
    await claimEvent({
      processor: 'flutterwave',
      eventId: String(txId),
      kind: body.event ?? body['event.type'],
    })
    return NextResponse.json({ received: true, ignored: true })
  }

  const orderId = body.data.meta?.orderId
  if (!orderId) return NextResponse.json({ error: 'Missing orderId in meta' }, { status: 400 })

  try {
    const payload = await getPayload()
    const existing = (await payload.findByID({
      collection: 'orders',
      id: orderId,
      depth: 0,
      overrideAccess: true,
    })) as Order

    // Amount + currency verification — protect against a tampered webhook
    // body claiming a small payment settles a much larger order.
    //
    // J6 (round-4 m6): we currently accept NAD / ZAR / USD / GBP / EUR
    // (all two-decimal). For zero-decimal currencies (XAF, RWF, etc.)
    // Flutterwave returns whole-unit integers and `* 100` would 100×-
    // overcharge our minor-unit math. Refuse any unexpected currency
    // up-front rather than computing a wrong amount.
    const SUPPORTED_TWO_DECIMAL = new Set(['NAD', 'ZAR', 'USD', 'GBP', 'EUR'])
    if (!SUPPORTED_TWO_DECIMAL.has(String(verified.currency).toUpperCase())) {
      console.error(
        `[flutterwave-webhook] unsupported currency ${verified.currency} on order ${orderId}`,
      )
      return NextResponse.json({ error: 'unsupported_currency' }, { status: 400 })
    }
    const expectedMinor = existing.totalMinor
    const verifiedMinor = Math.round(verified.amount * 100)
    if (verifiedMinor !== expectedMinor) {
      // Hard fail — DO NOT claim. Manual investigation needed.
      console.error(
        `[flutterwave-webhook] amount mismatch on order ${orderId}: expected ${expectedMinor}, got ${verifiedMinor}`,
      )
      return NextResponse.json(
        { error: 'amount_mismatch', expected: expectedMinor, paid: verifiedMinor },
        { status: 400 },
      )
    }
    if (verified.currency !== existing.currency) {
      console.error(
        `[flutterwave-webhook] currency mismatch on order ${orderId}: expected ${existing.currency}, got ${verified.currency}`,
      )
      return NextResponse.json({ error: 'currency_mismatch' }, { status: 400 })
    }

    // J3 (round-4 M10) — populate processorIntentRef with Flutterwave's
    // numeric transaction id so the future refund webhook can resolve
    // back to this order via the same pattern Stripe uses.
    const order = (await markOrderPaid(orderId, {
      processor: 'flutterwave',
      processorRef: verified.txRef,
      processorIntentRef: String(txId),
    })) as Order

    // Claim after the order is marked paid.
    await claimEvent({
      processor: 'flutterwave',
      eventId: String(txId),
      kind: body.event ?? body['event.type'],
      orderId,
    })

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
    const recipient = await resolveOrderEmail(order)
    if (!recipient) {
      console.error(
        `[flutterwave-webhook] cannot resolve email for order ${order.orderNumber} — skipping confirmation`,
      )
      return NextResponse.json({ received: true, warning: 'no_email' })
    }
    await sendOrderConfirmation({
      to: recipient,
      props: {
        orderNumber: order.orderNumber,
        customerName: order.shippingAddress?.name ?? undefined,
        totalFormatted: formatPrice(order.totalMinor, order.currency),
        // R11 — mirror Stripe + manual paths so line items visibly sum
        // to Total when shipping/tax are present (was missing here).
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
    return NextResponse.json({ received: true })
  } catch (e) {
    console.error('[flutterwave-webhook]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Internal error' },
      { status: 500 },
    )
  }
  } finally {
    // R11 — release the advisory lock + return the dedicated client.
    try {
      await fwLockClient.query(`SELECT pg_advisory_unlock(hashtext($1))`, [
        `flw-evt:${txId}`,
      ])
    } catch {
      // session-close releases anyway
    }
    fwLockClient.release()
  }
}
