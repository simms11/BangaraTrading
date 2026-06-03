/**
 * Common payment processor interface. Each processor (Stripe, Flutterwave,
 * Manual) implements `startCheckout` returning a hosted checkout URL, and
 * exports a webhook handler that marks orders paid.
 */

export type Currency = 'NAD' | 'ZAR' | 'USD' | 'GBP' | 'EUR'

export type ProcessorName = 'stripe' | 'flutterwave' | 'manual'

export type CheckoutLineSummary = {
  title: string
  unitPriceMinor: number
  quantity: number
}

export type StartCheckoutInput = {
  orderId: string | number
  orderNumber: string
  customerEmail: string
  currency: Currency
  amountMinor: number
  lines: CheckoutLineSummary[]
  /**
   * Shipping cost in minor units. B62 fix: this needs to reach Stripe as a
   * separate `shipping_options` entry so the customer is billed the same
   * total we recorded, and so Stripe Tax (when enabled) taxes shipping
   * correctly. Flutterwave uses `amountMinor` directly and ignores this.
   */
  shippingMinor?: number
  /** Human-readable shipping method label, e.g. "Standard delivery" */
  shippingLabel?: string
  successUrl: string
  cancelUrl: string
}

export type StartCheckoutResult = {
  processor: ProcessorName
  /** Hosted URL the customer must be redirected to */
  redirectUrl: string
  /** Identifier to persist on the order for reconciliation */
  processorRef: string
}

export interface PaymentProcessor {
  name: ProcessorName
  isConfigured(): boolean
  startCheckout(input: StartCheckoutInput): Promise<StartCheckoutResult>
}
