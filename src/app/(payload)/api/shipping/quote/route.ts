import { NextResponse } from 'next/server'
import { z } from 'zod'
import { readCart } from '@/lib/cart/store'
import { quoteShipping } from '@/lib/shipping'

export const dynamic = 'force-dynamic'

const schema = z.object({
  country: z.string().min(2).max(80),
  region: z.string().optional(),
  city: z.string().optional(),
  postalCode: z.string().optional(),
})

/**
 * Returns shipping options for the customer's current cart + destination.
 * Reads the cart cookie server-side so the client never has to compute weight.
 *
 * Cart is the source of truth — clients pass destination only.
 */
export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid destination' }, { status: 400 })
  }
  const cart = await readCart()
  const retailItems = cart.items.filter((i) => i.fulfillmentMode !== 'quote')
  if (retailItems.length === 0) {
    return NextResponse.json({ methods: [], oversize: false })
  }
  // I9 (M21) fix: cap the number of items we'll process per shipping-quote
  // call. The 3500-byte cart cookie limit caps line count to ~25, but a
  // tampered cookie carrying ~hundreds of fabricated product ids would
  // force the legacy-cart fallback below to issue a heavy `id IN (…)` DB
  // scan per request. The middleware rate limit (120/min/IP) bounds RPS
  // but not per-call DB cost; this caps per-call cost.
  const MAX_ITEMS_PER_QUOTE = 50
  if (retailItems.length > MAX_ITEMS_PER_QUOTE) {
    return NextResponse.json({ error: 'Cart too large' }, { status: 400 })
  }

  // Aggregate cart weight. New carts snapshot weightGrams at add-to-cart
  // time; for legacy carts that pre-date that field, fall back to a DB
  // lookup so the client and server agree (otherwise the order action
  // throws shipping_drift due to a mismatched flat-rate tier).
  const itemCount = retailItems.reduce((acc, i) => acc + i.quantity, 0)
  const missingWeights = retailItems.some((i) => i.weightGrams == null)
  let liveWeights = new Map<string, number>()
  if (missingWeights) {
    const { getProductsByIds } = await import('@/lib/queries/products')
    const products = await getProductsByIds(
      retailItems.map((i) => i.productId) as Array<number | string>,
    )
    liveWeights = new Map(
      products.map((p) => [String(p.id), p.shipping?.weightGrams ?? 500]),
    )
  }
  const weightGrams = retailItems.reduce((acc, i) => {
    const live = liveWeights.get(String(i.productId))
    const w = i.weightGrams ?? live ?? 500
    return acc + w * i.quantity
  }, 0)
  const currency = cart.currency || retailItems[0].currency

  const quote = await quoteShipping({
    destination: parsed.data,
    parcel: { weightGrams, itemCount, currency },
  })
  return NextResponse.json(quote)
}
