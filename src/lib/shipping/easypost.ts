import type { ShippingMethod, ShippingProvider } from './types'

/**
 * EasyPost rate lookup. Activated when EASYPOST_API_KEY is set.
 *
 * Docs: https://docs.easypost.com/docs/shipments/create-and-buy-a-shipment
 *
 * The shape mirrors the EasyPost v2 REST API directly. We return the cheapest
 * 3 distinct services as ShippingMethod records so the checkout UI can offer
 * named choices ("USPS Priority" vs "DHL Express") with carrier-real ETAs.
 */
export const easypostProvider: ShippingProvider = {
  name: 'easypost',
  isConfigured() {
    return Boolean(process.env.EASYPOST_API_KEY)
  },
  async quote({ destination, parcel }) {
    const key = process.env.EASYPOST_API_KEY
    if (!key) return []

    const auth = `Basic ${Buffer.from(`${key}:`).toString('base64')}`
    const from = {
      // Bangarah's origin — Okahandja, Namibia. Customizable via env later.
      street1: process.env.SHIP_FROM_STREET1 || 'Unit 8, Omumbonde Industrial Park',
      city: process.env.SHIP_FROM_CITY || 'Okahandja',
      country: 'NA',
      zip: process.env.SHIP_FROM_ZIP || '',
      company: 'Bangarah Trading Enterprises CC',
      phone: process.env.SHIP_FROM_PHONE || '+264813416764',
    }
    const to = {
      street1: 'Customer address (rate lookup)',
      city: destination.city || '',
      state: destination.region || '',
      zip: destination.postalCode || '',
      country: destination.country || '',
    }
    const grams = Math.max(50, parcel.weightGrams)

    let res: Response
    try {
      res = await fetch('https://api.easypost.com/v2/shipments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify({
          shipment: {
            from_address: from,
            to_address: to,
            parcel: { weight: grams / 28.3495 }, // EasyPost wants ounces
          },
        }),
        // R7 round-7 reliability C1 — cap shipping quote at 8s. Storefront
        // checkout calls this on every cart update; a stalled EasyPost
        // request would freeze the shipping step.
        signal: AbortSignal.timeout(8_000),
      })
    } catch (e) {
      console.warn('[shipping:easypost] fetch failed', e)
      return []
    }
    if (!res.ok) return []
    const data = (await res.json()) as {
      rates?: Array<{
        id: string
        service: string
        carrier: string
        rate: string
        currency: string
        delivery_days?: number
      }>
    }
    const rates = data.rates ?? []
    rates.sort((a, b) => parseFloat(a.rate) - parseFloat(b.rate))

    // Dedup by carrier+service, keep cheapest 3
    const seen = new Set<string>()
    const out: ShippingMethod[] = []
    for (const r of rates) {
      const k = `${r.carrier}:${r.service}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push({
        id: `easypost:${r.id}`,
        label: `${r.carrier} ${r.service}`,
        description: r.delivery_days ? `Approx ${r.delivery_days} days` : undefined,
        amountMinor: Math.round(parseFloat(r.rate) * 100),
        currency: r.currency.toUpperCase(),
        estimatedDays: r.delivery_days ? { min: r.delivery_days, max: r.delivery_days } : undefined,
        carrierRef: r.id,
      })
      if (out.length >= 3) break
    }
    return out
  },
}
