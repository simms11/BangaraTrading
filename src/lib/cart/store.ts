import 'server-only'
import { cookies } from 'next/headers'
import { nanoid } from 'nanoid'
import type { Cart, CartLineItem } from './types'
import { EMPTY_CART } from './types'

const COOKIE_NAME = 'bangarah_cart'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 days

/**
 * Concurrency note: the cart cookie is read-modify-written. Two concurrent
 * actions on the same browser can race; last-write-wins. That's acceptable
 * for a per-user cart (a single user issuing parallel cart edits is rare),
 * but be aware if we ever introduce server-mediated cart pre-orders.
 *
 * Also note: prices and titles in the cookie are SNAPSHOTS — they're only
 * used for display. Order creation re-validates against the live DB to
 * prevent price tampering. See createOrderFromCart in src/lib/orders.ts.
 */
/**
 * B71: per-line quantity ceiling. Matches the clamp applied in
 * createOrderFromCart (src/lib/orders.ts) so the cart UI shows the same
 * number we'll actually charge for. The floor of 1 mirrors `readCart()`'s
 * existing drop-on-zero behaviour but as a clamp instead of a filter, so
 * a tampered cookie with quantity: 0.4 still renders as 1 item rather
 * than vanishing.
 */
const MAX_LINE_QUANTITY = 99

export async function readCart(): Promise<Cart> {
  const jar = await cookies()
  const raw = jar.get(COOKIE_NAME)?.value
  if (!raw) return { ...EMPTY_CART }
  try {
    const parsed = JSON.parse(raw) as Cart
    if (!parsed?.id || !Array.isArray(parsed.items)) return { ...EMPTY_CART }
    // Strip obviously-invalid lines (e.g. tampered cookie missing required fields).
    const items = parsed.items
      .filter(
        (i) =>
          i != null &&
          i.productId != null &&
          typeof i.quantity === 'number' &&
          i.quantity > 0 &&
          typeof i.unitPriceMinor === 'number' &&
          typeof i.slug === 'string',
      )
      // B71 fix: clamp upper bound so a tampered cookie with quantity:
      // 1_000_000 doesn't render an absurd total in the UI (and doesn't
      // mismatch what the server will eventually accept at checkout).
      .map((i) => {
        const safeQty = Math.max(
          1,
          Math.min(MAX_LINE_QUANTITY, Math.floor(Number(i.quantity) || 0)),
        )
        return safeQty === i.quantity ? i : { ...i, quantity: safeQty }
      })
    return { ...parsed, items }
  } catch {
    return { ...EMPTY_CART }
  }
}

/**
 * Reads the cart and reconciles it against live product data, dropping any
 * lines whose product no longer exists or has been unpublished. Returns the
 * reconciled cart + the list of dropped slugs so the UI can flash a notice.
 *
 * Use this on cart-display surfaces (/cart, header badge feels free to skip
 * the DB round-trip since the count is informational).
 */
export async function readReconciledCart(): Promise<{
  cart: Cart
  dropped: string[]
  repriced: string[]
}> {
  const cart = await readCart()
  if (cart.items.length === 0) return { cart, dropped: [], repriced: [] }

  // Lazy import to avoid pulling Payload into the header read path.
  const { getProductsByIds } = await import('@/lib/queries/products')
  const ids = Array.from(new Set(cart.items.map((i) => i.productId)))
  const products = await getProductsByIds(ids as Array<number | string>)
  const liveById = new Map(products.map((p) => [String(p.id), p]))

  const dropped: string[] = []
  // R8 frontend M8 / business M9 — price-drift reconciliation. The cart
  // line carries a snapshot `unitPriceMinor` taken at add-to-cart time;
  // createOrderFromCart charges the LIVE DB price. Previously the cart
  // and checkout summary showed the stale snapshot and the customer was
  // silently charged the new price. We now refresh the snapshot to the
  // live price and report which slugs changed so the UI can surface a
  // "price updated" notice before the customer pays.
  const repriced: string[] = []
  let mutated = false
  const liveItems: typeof cart.items = []
  for (const i of cart.items) {
    const live = liveById.get(String(i.productId))
    if (!live || live.status !== 'published') {
      dropped.push(i.slug)
      mutated = true
      continue
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const livePrice = (live as any).priceMinor as number | undefined
    if (typeof livePrice === 'number' && livePrice !== i.unitPriceMinor) {
      repriced.push(i.slug)
      mutated = true
      liveItems.push({ ...i, unitPriceMinor: livePrice, snapshotAt: Date.now() })
    } else {
      liveItems.push(i)
    }
  }

  // Persist the reconciled cart only if something actually changed so we
  // don't bounce the cookie on every request.
  if (mutated) {
    const reconciled: Cart = {
      ...cart,
      items: liveItems,
      currency: liveItems.length ? cart.currency : null,
      updatedAt: Date.now(),
    }
    await writeCart(reconciled)
    return { cart: reconciled, dropped, repriced }
  }
  return { cart, dropped: [], repriced: [] }
}

export class CartTooLargeError extends Error {
  constructor() {
    super(
      'Your cart has too many items to save here. Remove some items, or sign in so we can keep your cart on your account.',
    )
    this.name = 'CartTooLargeError'
  }
}

/** Browsers cap a single cookie at ~4096 bytes; we keep a margin for the
 * cookie name + attributes. The previous 3500-char limit was a reasonable
 * approximation. */
const MAX_CART_COOKIE_BYTES = 3500

export async function writeCart(cart: Cart): Promise<void> {
  const jar = await cookies()
  const value = JSON.stringify(cart)
  // M1 (Phase 2) — measure bytes, not UTF-16 code units. Non-ASCII
  // product titles (accented vendor names, etc.) inflate the byte size
  // beyond `value.length`, so the previous check could let an oversize
  // cookie slip past the 4 KB browser cap; the browser then rejects /
  // truncates and the next readCart returns the empty fallback —
  // customer's cart silently vanishes between navigations.
  if (Buffer.byteLength(value, 'utf8') > MAX_CART_COOKIE_BYTES) {
    // B64 fix: surface a structured error so server actions can convert it
    // into a friendly UI message rather than a 500 page.
    throw new CartTooLargeError()
  }
  jar.set({
    name: COOKIE_NAME,
    value,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  })
}

export async function clearCart(): Promise<void> {
  const jar = await cookies()
  jar.delete(COOKIE_NAME)
}

export function ensureCartId(cart: Cart): Cart {
  if (cart.id) return cart
  return { ...cart, id: nanoid(16) }
}

export function upsertLine(cart: Cart, incoming: CartLineItem): Cart {
  const existing = cart.items.findIndex((i) => i.productId === incoming.productId)
  let items: CartLineItem[]
  if (existing >= 0) {
    items = cart.items.map((i, idx) =>
      idx === existing
        ? {
            ...i,
            // R11 — clamp the sum at upsert so repeated +1 adds (or a
            // single big add against a partially-filled line) can't push
            // the stored quantity past MAX_LINE_QUANTITY. Previously the
            // overflow only surfaced when readCart re-clamped on the
            // NEXT read, silently dropping the difference and producing
            // a "you got fewer items than you added" UX.
            quantity: Math.min(MAX_LINE_QUANTITY, i.quantity + incoming.quantity),
            unitPriceMinor: incoming.unitPriceMinor,
            snapshotAt: incoming.snapshotAt,
          }
        : i,
    )
  } else {
    items = [
      ...cart.items,
      // Also clamp the initial add (defence against an action that
      // bypasses the action-layer clamp).
      { ...incoming, quantity: Math.min(MAX_LINE_QUANTITY, incoming.quantity) },
    ]
  }
  return {
    ...cart,
    items,
    currency: cart.currency ?? incoming.currency,
    updatedAt: Date.now(),
  }
}

export function setLineQuantity(cart: Cart, productId: string | number, qty: number): Cart {
  if (qty <= 0) return removeLine(cart, productId)
  return {
    ...cart,
    items: cart.items.map((i) => (i.productId === productId ? { ...i, quantity: qty } : i)),
    updatedAt: Date.now(),
  }
}

export function removeLine(cart: Cart, productId: string | number): Cart {
  const items = cart.items.filter((i) => i.productId !== productId)
  return {
    ...cart,
    items,
    currency: items.length ? cart.currency : null,
    updatedAt: Date.now(),
  }
}
