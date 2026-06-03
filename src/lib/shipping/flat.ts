import type { ShippingDestination, ShippingMethod, ShippingProvider } from './types'

const NA_COUNTRIES = new Set(['NA', 'NAM', 'NAMIBIA', 'namibia', 'Namibia'])
const ZA_COUNTRIES = new Set(['ZA', 'ZAF', 'SOUTH AFRICA', 'south africa', 'South Africa'])

function tierForGrams(weightGrams: number): {
  na: number
  za: number
  intl: number
} {
  // Minor units (NAD cents).
  // Tiers are deliberately conservative — these are realistic ranges for
  // sauce/honey shipments out of Okahandja. Override per route in admin.
  if (weightGrams <= 500) return { na: 4500, za: 9000, intl: 35000 }
  if (weightGrams <= 1500) return { na: 7500, za: 14500, intl: 55000 }
  if (weightGrams <= 5000) return { na: 12500, za: 22500, intl: 95000 }
  if (weightGrams <= 10000) return { na: 22500, za: 38000, intl: 165000 }
  // > 10kg — treat as bulk; checkout forces a quote.
  return { na: 0, za: 0, intl: 0 }
}

function routeFor(country: string): 'na' | 'za' | 'intl' {
  const c = (country || '').toUpperCase().trim()
  if (NA_COUNTRIES.has(c) || NA_COUNTRIES.has(country)) return 'na'
  if (ZA_COUNTRIES.has(c) || ZA_COUNTRIES.has(country)) return 'za'
  return 'intl'
}

/**
 * Pickup + flat-rate provider. Always configured.
 *
 * - Pickup is always offered (free) — collected from Omumbonde Industrial Park.
 * - Standard / international rates use a weight-tier table.
 * - Over 10kg the flat provider returns ONLY pickup + a 'quote' marker so the
 *   checkout UI can suggest a bulk quote.
 */
export const flatProvider: ShippingProvider = {
  name: 'flat',
  isConfigured() {
    return true
  },
  async quote({ destination, parcel }) {
    const tiers = tierForGrams(parcel.weightGrams)
    const route = routeFor(destination.country)
    const methods: ShippingMethod[] = []

    methods.push({
      id: 'pickup',
      label: 'Pickup from warehouse',
      description: 'Free. Collect from Omumbonde Industrial Park, Okahandja.',
      amountMinor: 0,
      currency: parcel.currency,
      estimatedDays: { min: 0, max: 2 },
    })

    if (parcel.weightGrams > 10000) {
      // Too heavy for the flat tiers — offer pickup only; UI suggests a quote.
      return methods
    }

    const amountMinor =
      route === 'na' ? tiers.na : route === 'za' ? tiers.za : tiers.intl
    const label =
      route === 'na'
        ? 'Standard delivery (Namibia)'
        : route === 'za'
          ? 'Cross-border (South Africa)'
          : 'International shipping'
    const eta =
      route === 'na'
        ? { min: 2, max: 5 }
        : route === 'za'
          ? { min: 4, max: 8 }
          : { min: 7, max: 21 }

    methods.push({
      id: `flat_${route}`,
      label,
      description: `Tracked delivery via partner carrier.`,
      amountMinor,
      currency: parcel.currency,
      estimatedDays: eta,
    })

    return methods
  },
}

export { routeFor as _routeFor }
export function isOversize(destination: ShippingDestination, parcel: { weightGrams: number }) {
  // Used by the UI to nudge customers to a bulk quote.
  void destination
  return parcel.weightGrams > 10000
}
