import 'server-only'
import type { Payload } from 'payload'
import type { Order, Refund } from '@/payload-types'

/**
 * Issue a refund through the original payment processor.
 *
 * The Refunds collection's beforeChange hook triggers this when status
 * transitions to "processing". On success, the hook flips status to
 * "completed" — which then chains into the Orders status-sync hook from
 * Phase 5.
 *
 * Idempotency: if the refund already has a processorRef, we skip the
 * processor call (it's been issued; just mark complete in the DB).
 */
export type IssueRefundResult =
  | { ok: true; processorRef: string }
  | { ok: false; error: string }

export async function issueProcessorRefund(args: {
  payload: Payload
  refund: Refund
}): Promise<IssueRefundResult> {
  const { payload, refund } = args
  if (refund.processorRef) {
    return { ok: true, processorRef: refund.processorRef }
  }
  const orderId = typeof refund.order === 'object' ? refund.order.id : refund.order
  if (orderId == null) return { ok: false, error: 'missing_order' }

  const order = (await payload.findByID({
    collection: 'orders',
    id: orderId,
    depth: 0,
    overrideAccess: true,
  })) as Order

  const processor = (refund.processor || order.payment?.processor) as
    | 'stripe'
    | 'flutterwave'
    | 'manual'
    | undefined

  if (processor === 'manual' || !processor) {
    // Manual refunds happen out-of-band (bank transfer). Mark as success so
    // the hook chain progresses; ops fills in the bank-transfer ref by hand.
    return { ok: true, processorRef: refund.reference }
  }

  if (processor === 'stripe') return refundViaStripe(refund, order)
  if (processor === 'flutterwave') return refundViaFlutterwave(refund, order)
  return { ok: false, error: `unsupported_processor:${processor}` }
}

async function refundViaStripe(refund: Refund, order: Order): Promise<IssueRefundResult> {
  // J1 (round-4 C1) — use the singleton + centralised pin from stripe.ts
  // so this code path doesn't create a new client (+ TCP/TLS handshake)
  // per refund AND can't drift from the pinned API version.
  const { getStripeClient } = await import('@/lib/payments/stripe')
  const client = getStripeClient()
  if (!client) return { ok: false, error: 'stripe_not_configured' }

  // Stripe needs either a PaymentIntent or Charge to refund against. We stored
  // the checkout session id as processorRef; fetch the session to find the PI.
  const sessionId = order.payment?.processorRef
  if (!sessionId) return { ok: false, error: 'missing_session_id' }
  try {
    const session = await client.checkout.sessions.retrieve(sessionId)
    const paymentIntent =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id
    if (!paymentIntent) return { ok: false, error: 'no_payment_intent' }
    // K2 (round-5 C2) — pass a Stripe idempotency key. The auto-issue
    // afterChange hook fires on `failed → processing` retries, and the
    // failed-path may have left the row at `failed` with no
    // `processorRef` because the first call's response was truncated /
    // timed-out (real Stripe-side success, network/socket close before
    // we read the body). Without an idempotency key, retrying calls
    // refunds.create AGAIN and Stripe creates a SECOND refund → customer
    // double-refunded. The refund's `reference` field is already
    // unique-per-refund (B27 enforced unique constraint) so it's a stable
    // key. Stripe caches the result for 24 hours under this key.
    const stripeRefund = await client.refunds.create(
      {
        payment_intent: paymentIntent,
        amount: refund.amountMinor,
        reason:
          refund.reason === 'fraud'
            ? 'fraudulent'
            : refund.reason === 'requested_by_customer'
              ? 'requested_by_customer'
              : undefined,
        metadata: {
          bangarah_refund_id: String(refund.id),
          bangarah_order_id: String(order.id),
        },
      },
      { idempotencyKey: `bangarah_refund_${refund.reference}` },
    )
    return { ok: true, processorRef: stripeRefund.id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function refundViaFlutterwave(
  refund: Refund,
  order: Order,
): Promise<IssueRefundResult> {
  const key = process.env.FLUTTERWAVE_SECRET_KEY
  if (!key) return { ok: false, error: 'flutterwave_not_configured' }
  // Flutterwave needs the original transaction id, not the tx_ref. We stored
  // the tx_ref as processorRef; lookup the id via the verify endpoint.
  const txRef = order.payment?.processorRef
  if (!txRef) return { ok: false, error: 'missing_tx_ref' }
  try {
    // Lookup the transaction id by tx_ref.
    const lookupRes = await fetch(
      `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`,
      {
        headers: { Authorization: `Bearer ${key}` },
        // R7 round-7 reliability C1 — 10s upstream cap.
        signal: AbortSignal.timeout(10_000),
      },
    )
    const lookupJson = (await lookupRes.json()) as { data?: { id?: number | string } }
    const txId = lookupJson?.data?.id
    if (!txId) return { ok: false, error: 'tx_id_not_found' }

    const refundRes = await fetch(
      `https://api.flutterwave.com/v3/transactions/${txId}/refund`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: (refund.amountMinor / 100).toFixed(2),
          comments: refund.description || `Refund for order ${order.orderNumber}`,
        }),
        // R7 round-7 reliability C1 — 10s upstream cap.
        signal: AbortSignal.timeout(10_000),
      },
    )
    if (!refundRes.ok) {
      const text = await refundRes.text().catch(() => '')
      return { ok: false, error: `flutterwave_${refundRes.status}: ${text.slice(0, 200)}` }
    }
    const refundJson = (await refundRes.json()) as { data?: { id?: number | string } }
    return { ok: true, processorRef: String(refundJson?.data?.id ?? '') }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
