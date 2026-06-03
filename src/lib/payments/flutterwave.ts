import type { PaymentProcessor, StartCheckoutInput, StartCheckoutResult } from './types'

/**
 * Flutterwave Standard (hosted-checkout) integration.
 * Docs: https://developer.flutterwave.com/reference/initiate-payment
 *
 * NAD merchants are supported. We use the v3 payments endpoint and surface
 * the returned hosted-link URL. Webhook verification uses the
 * verif-hash header against FLUTTERWAVE_WEBHOOK_SECRET.
 */
export const flutterwaveProcessor: PaymentProcessor = {
  name: 'flutterwave',
  isConfigured() {
    return Boolean(process.env.FLUTTERWAVE_SECRET_KEY)
  },
  async startCheckout(input: StartCheckoutInput): Promise<StartCheckoutResult> {
    const secret = process.env.FLUTTERWAVE_SECRET_KEY
    if (!secret) throw new Error('Flutterwave is not configured (FLUTTERWAVE_SECRET_KEY missing).')

    const txRef = `bgr_${input.orderNumber}_${Date.now()}`
    // R7 round-7 reliability C1 — cap external HTTP at 10s so a slow
    // upstream can't eat the Vercel function deadline.
    const res = await fetch('https://api.flutterwave.com/v3/payments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        tx_ref: txRef,
        amount: (input.amountMinor / 100).toFixed(2),
        currency: input.currency,
        customer: { email: input.customerEmail },
        redirect_url: input.successUrl,
        meta: {
          orderId: String(input.orderId),
          orderNumber: input.orderNumber,
        },
        customizations: {
          title: 'Bangarah Trading',
          description: `Order ${input.orderNumber}`,
        },
      }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Flutterwave payment init failed: ${res.status} ${text}`)
    }
    const json = (await res.json()) as {
      status: string
      data?: { link?: string }
    }
    const link = json?.data?.link
    if (!link) throw new Error('Flutterwave did not return a payment link.')

    return {
      processor: 'flutterwave',
      redirectUrl: link,
      processorRef: txRef,
    }
  },
}

/**
 * K4 (round-5 M3) — distinguish "transaction is not successful" from
 * "the verify endpoint failed / was unreachable". The old behaviour
 * returned `null` for both, and the webhook treated null as "ignored,
 * claim the event and move on" — so a real payment for which the verify
 * endpoint 5xx'd once at the wrong moment got silently dropped (event
 * idempotently claimed, order stays pending_payment forever, customer
 * paid but never sees confirmation).
 *
 * We now **throw** on non-2xx from the verify endpoint so the webhook
 * handler returns 500 → Flutterwave retries. The webhook still treats
 * a *successful* verify with non-successful status as "ignored, claim".
 */
export async function verifyFlutterwaveTransaction(transactionId: string): Promise<{
  status: 'successful' | 'failed' | 'pending' | string
  amount: number
  currency: string
  txRef: string
} | null> {
  const secret = process.env.FLUTTERWAVE_SECRET_KEY
  if (!secret) return null
  const res = await fetch(`https://api.flutterwave.com/v3/transactions/${transactionId}/verify`, {
    headers: { Authorization: `Bearer ${secret}` },
    // R7 round-7 reliability C1 — 10s upstream cap.
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) {
    // Throw — caller catches and returns 500 → Flutterwave retries.
    const text = await res.text().catch(() => '')
    throw new Error(
      `Flutterwave verify failed: ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 200)}` : ''}`,
    )
  }
  const json = (await res.json().catch(() => null)) as {
    data?: { status: string; amount: number; currency: string; tx_ref: string }
  } | null
  if (!json?.data) {
    // Malformed but 2xx — treat as "couldn't verify" and throw too.
    throw new Error('Flutterwave verify: 2xx but no data payload')
  }
  return {
    status: json.data.status,
    amount: json.data.amount,
    currency: json.data.currency,
    txRef: json.data.tx_ref,
  }
}
