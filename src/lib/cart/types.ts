/**
 * Cart types.
 *
 * The cart is stored in a single httpOnly cookie. Line items snapshot
 * everything we need to re-price and to fan out to vendors at order
 * creation time — by id, by vendor id, plus a price and title snapshot
 * to make stale carts visible to customers if the vendor changes price.
 */

export type CartLineItem = {
  productId: number | string
  vendorId: number | string
  slug: string
  title: string
  imageUrl?: string
  unitPriceMinor: number
  currency: string
  quantity: number
  fulfillmentMode: 'retail' | 'quote' | 'hybrid'
  /**
   * Captured from product.shipping.weightGrams at add-to-cart time. Used
   * by the shipping-quote API so the client's quote matches what
   * createOrderFromCart will compute server-side — otherwise the client
   * sees one shipping price and the server rejects with shipping_drift.
   */
  weightGrams?: number
  /** Added so we can later detect price drift between cart and live product */
  snapshotAt: number
}

export type Cart = {
  /** Cart id — useful when migrating to DB-backed carts later */
  id: string
  items: CartLineItem[]
  /** Currency is set on first add and locked thereafter to avoid mixed-currency math */
  currency: string | null
  updatedAt: number
}

export const EMPTY_CART: Cart = {
  id: '',
  items: [],
  currency: null,
  updatedAt: 0,
}

export type CartTotals = {
  itemCount: number
  retailSubtotalMinor: number
  quoteSubtotalMinor: number
  totalMinor: number
  currency: string | null
}

export function computeTotals(cart: Cart): CartTotals {
  const itemCount = cart.items.reduce((acc, i) => acc + i.quantity, 0)
  const retailSubtotalMinor = cart.items
    .filter((i) => i.fulfillmentMode !== 'quote')
    .reduce((acc, i) => acc + i.unitPriceMinor * i.quantity, 0)
  const quoteSubtotalMinor = cart.items
    .filter((i) => i.fulfillmentMode === 'quote')
    .reduce((acc, i) => acc + i.unitPriceMinor * i.quantity, 0)
  return {
    itemCount,
    retailSubtotalMinor,
    quoteSubtotalMinor,
    totalMinor: retailSubtotalMinor + quoteSubtotalMinor,
    currency: cart.currency,
  }
}
