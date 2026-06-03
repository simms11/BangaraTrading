import type { ShippingDestination, ShippingMethod, ShippingParcel } from './types'
import { flatProvider, isOversize } from './flat'
import { easypostProvider } from './easypost'

export type ShippingQuote = {
  methods: ShippingMethod[]
  /** True when the parcel is too heavy for our flat tiers — UI nudges to quote */
  oversize: boolean
}

/**
 * Top-level shipping quote. Always returns at least Pickup (free) so checkout
 * is never blocked. When EasyPost is configured, its rates are merged with
 * Pickup so customers see real carrier options.
 */
export async function quoteShipping(args: {
  destination: ShippingDestination
  parcel: ShippingParcel
}): Promise<ShippingQuote> {
  const flatMethods = await flatProvider.quote(args)
  if (easypostProvider.isConfigured()) {
    const epMethods = await easypostProvider.quote(args)
    // M3 fix: EasyPost returns rates in the *carrier's* billing currency
    // (typically USD). Without filtering, we'd record those minor units
    // as if they were the cart's currency (NAD/ZAR/etc) — a ~17×
    // undercharge against the actual shipping cost. Drop any rate whose
    // currency doesn't match the cart parcel currency; if conversion is
    // ever needed it must go through an explicit FX layer, not silent
    // unit reinterpretation.
    const matchingCurrency = epMethods.filter(
      (m) => (m.currency || '').toUpperCase() === args.parcel.currency.toUpperCase(),
    )
    if (epMethods.length > 0 && matchingCurrency.length === 0) {
      console.warn(
        `[shipping:easypost] dropped all ${epMethods.length} rates: none matched cart currency ${args.parcel.currency}. Configure carrier accounts that bill in the cart currency, or add an FX layer.`,
      )
    }
    // Always keep Pickup; merge in EasyPost methods only if at least one
    // currency-matching rate survived.
    const pickup = flatMethods.filter((m) => m.id === 'pickup')
    const merged = matchingCurrency.length ? [...pickup, ...matchingCurrency] : flatMethods
    return { methods: merged, oversize: isOversize(args.destination, args.parcel) }
  }
  return { methods: flatMethods, oversize: isOversize(args.destination, args.parcel) }
}

export type { ShippingDestination, ShippingMethod, ShippingParcel } from './types'
