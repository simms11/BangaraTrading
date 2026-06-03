import type { PaymentProcessor, StartCheckoutInput, StartCheckoutResult } from './types'

/**
 * "Manual" mode: no card processor wired. We mark the order as
 * pending_payment and surface bank-transfer instructions on the
 * confirmation page. Customer pays out-of-band; admin marks order paid
 * once funds clear. Useful as a launch fallback and for dev.
 */
export const manualProcessor: PaymentProcessor = {
  name: 'manual',
  isConfigured() {
    return true
  },
  async startCheckout(input: StartCheckoutInput): Promise<StartCheckoutResult> {
    // M7 fix: guest checkouts already carry `?t=<confirmationToken>` on the
    // successUrl. Appending a fresh `?processor=manual` produced
    // `/orders/…?t=TOKEN?processor=manual`, which makes the second `?` part
    // of the token value — the order-page constant-time compare then fails
    // and the guest sees a 404. Use the same `includes('?') ? '&' : '?'`
    // joiner the Stripe processor uses.
    const sep = input.successUrl.includes('?') ? '&' : '?'
    return {
      processor: 'manual',
      redirectUrl: `${input.successUrl}${sep}processor=manual`,
      processorRef: `manual_${input.orderNumber}`,
    }
  },
}
