import Stripe from 'stripe'
import type { PaymentProcessor, StartCheckoutInput, StartCheckoutResult } from './types'

/**
 * J1 (round-4 C1): Stripe API version pin.
 *
 * Previously hard-coded to '2024-12-18.acacia' in three call sites with
 * `as Stripe.LatestApiVersion`. SDK 17.7 ships `LatestApiVersion =
 * '2025-02-24.acacia'`, so the older pin worked at runtime but the cast
 * silenced any drift between SDK shape and our pin. We centralise it to
 * a single constant + export the singleton accessor so other modules
 * (refund.ts, the charge.refunded fallback in the webhook) reuse the
 * same client and don't create extra Stripe clients per call.
 */
export const STRIPE_API_VERSION = '2025-02-24.acacia' as Stripe.LatestApiVersion

let _client: Stripe | null = null

function getClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  if (!_client) {
    // R7 round-7 reliability C1 — set timeout + maxNetworkRetries on
    // the Stripe SDK. The default 80s timeout would let a single hung
    // Stripe call eat the Vercel function deadline (30s for webhooks,
    // 60s default). 10s is plenty for normal calls and gives Vercel
    // headroom to surface a 5xx so the upstream caller (Stripe webhook
    // retry, Refunds auto-issue) gets a clean retry signal rather than
    // a hard kill mid-flight. maxNetworkRetries=2 covers transient
    // 502/504s without amplifying our outbound rate.
    _client = new Stripe(key, {
      apiVersion: STRIPE_API_VERSION,
      timeout: 10_000,
      maxNetworkRetries: 2,
    })
  }
  return _client
}

export function getStripeClient(): Stripe | null {
  return getClient()
}

export const stripeProcessor: PaymentProcessor = {
  name: 'stripe',
  isConfigured() {
    return Boolean(process.env.STRIPE_SECRET_KEY)
  },
  async startCheckout(input: StartCheckoutInput): Promise<StartCheckoutResult> {
    const client = getClient()
    if (!client) throw new Error('Stripe is not configured (STRIPE_SECRET_KEY missing).')

    // Stripe Tax: opt-in via STRIPE_TAX_ENABLED. Stripe computes VAT/sales
    // tax inclusive of the shipping country and surfaces the total on the
    // Checkout page. Requires `automatic_tax.enabled` and a stripe Tax
    // settings configuration. When off (the default), prices are passed
    // through as-is — appropriate for NA-domestic flow without VAT registration.
    const taxEnabled = process.env.STRIPE_TAX_ENABLED === 'true'

    // B62 fix: pass shipping via shipping_options so Stripe charges the
    // customer the same total we recorded on the order (subtotal + shipping
    // + Stripe Tax). Previously only product line_items were sent, leaving
    // the customer charged for subtotal alone — the webhook then rejected
    // every order with shipping > 0 as an amount mismatch.
    const shippingMinor = input.shippingMinor ?? 0
    const shippingOptions =
      shippingMinor > 0
        ? [
            {
              shipping_rate_data: {
                type: 'fixed_amount' as const,
                fixed_amount: {
                  amount: shippingMinor,
                  currency: input.currency.toLowerCase(),
                },
                display_name: input.shippingLabel ?? 'Shipping',
                ...(taxEnabled ? { tax_behavior: 'exclusive' as const } : {}),
              },
            },
          ]
        : undefined

    const session = await client.checkout.sessions.create({
      mode: 'payment',
      customer_email: input.customerEmail,
      currency: input.currency.toLowerCase(),
      // B1 fix: use & if successUrl already has a query string (e.g. guest
      // checkout token ?t=…). Stripe substitutes {CHECKOUT_SESSION_ID} at
      // its end, so we can't pre-build via URL().
      success_url: `${input.successUrl}${input.successUrl.includes('?') ? '&' : '?'}processor=stripe&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: input.cancelUrl,
      client_reference_id: String(input.orderId),
      // R8 business M2 — align the Stripe session expiry with the
      // 30-min abandoned-order sweeper. Stripe's default session TTL is
      // 24h; the sweeper cancels + releases inventory at 30 min. That
      // mismatch meant a customer could complete payment on a still-open
      // session long after the sweeper had cancelled the order, forcing
      // the paid-after-cancel auto-refund (customer charged then
      // refunded, item lost). Setting expires_at to ~30 min makes the
      // session and sweeper agree, and the `checkout.session.expired`
      // webhook fires near the sweeper window for clean inventory
      // release. Stripe's minimum is 30 min (1800s); we use exactly that.
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      metadata: {
        orderId: String(input.orderId),
        orderNumber: input.orderNumber,
      },
      // B72: propagate identifiers to the underlying PaymentIntent so the
      // payment_intent.payment_failed webhook (which carries the PI, not the
      // Session) can resolve back to our order and trigger inventory release.
      payment_intent_data: {
        metadata: {
          orderId: String(input.orderId),
          orderNumber: input.orderNumber,
        },
      },
      // Stripe Tax needs an address; collect during checkout.
      ...(taxEnabled
        ? {
            automatic_tax: { enabled: true },
            // Required for Stripe Tax to compute correctly.
            billing_address_collection: 'required' as const,
          }
        : {}),
      ...(shippingOptions ? { shipping_options: shippingOptions } : {}),
      line_items: input.lines.map((l) => ({
        quantity: l.quantity,
        price_data: {
          currency: input.currency.toLowerCase(),
          unit_amount: l.unitPriceMinor,
          product_data: { name: l.title },
          // Tax behaviour on each line — when Stripe Tax is enabled, treat
          // prices as exclusive (tax added on top). For internal-only flows,
          // change to 'inclusive' if your DB prices already contain VAT.
          ...(taxEnabled ? { tax_behavior: 'exclusive' as const } : {}),
        },
      })),
    })

    if (!session.url) throw new Error('Stripe did not return a checkout URL.')

    return {
      processor: 'stripe',
      redirectUrl: session.url,
      processorRef: session.id,
    }
  },
}

export function verifyStripeWebhook(payload: string, signature: string): Stripe.Event {
  const client = getClient()
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!client) throw new Error('Stripe not configured.')
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET missing.')
  return client.webhooks.constructEvent(payload, signature, secret)
}
