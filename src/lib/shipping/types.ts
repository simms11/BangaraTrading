export type ShippingDestination = {
  country: string // ISO-2 preferred, but tolerates "Namibia" etc.
  region?: string
  postalCode?: string
  city?: string
}

export type ShippingParcel = {
  /** Total cart weight in grams. */
  weightGrams: number
  /** Number of items — useful for tiered carriers. */
  itemCount: number
  currency: string
}

export type ShippingMethod = {
  /** Stable id used as form value + persisted to Order */
  id: string
  /** Carrier or method label (Pickup, Standard NA, EasyPost: DHL …) */
  label: string
  description?: string
  amountMinor: number
  currency: string
  estimatedDays?: { min: number; max: number }
  /** Carrier reference for fulfillment (rate id from EasyPost, etc.). */
  carrierRef?: string
}

export interface ShippingProvider {
  name: 'pickup' | 'flat' | 'easypost'
  isConfigured(): boolean
  quote(args: {
    destination: ShippingDestination
    parcel: ShippingParcel
  }): Promise<ShippingMethod[]>
}
