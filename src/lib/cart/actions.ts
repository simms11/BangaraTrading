'use server'

import { revalidatePath } from 'next/cache'
import { getProductBySlug } from '@/lib/queries/products'
import { readCart, writeCart, clearCart, ensureCartId, upsertLine, setLineQuantity, removeLine, CartTooLargeError } from './store'
import type { Cart, CartLineItem } from './types'

/** B64: callers go through this wrapper so the cookie-too-large error
 * becomes a typed UI response instead of a 500. */
async function safeWrite(cart: Cart): Promise<CartActionResult | null> {
  try {
    await writeCart(cart)
    return null
  } catch (e) {
    if (e instanceof CartTooLargeError) {
      return { ok: false, error: e.message }
    }
    throw e
  }
}

export type CartActionResult =
  | { ok: true; itemCount: number; totalMinor: number }
  | { ok: false; error: string }

const MAX_QTY_PER_LINE = 99

export async function addToCartBySlug(slug: string, quantity = 1): Promise<CartActionResult> {
  if (!slug) return { ok: false, error: 'Missing product.' }
  const qty = Math.max(1, Math.min(MAX_QTY_PER_LINE, Math.floor(quantity)))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const product = (await getProductBySlug(slug)) as any
  if (!product) return { ok: false, error: 'Product not available.' }

  let cart = await readCart()
  cart = ensureCartId(cart)

  if (cart.currency && cart.currency !== product.currency) {
    return {
      ok: false,
      error: `Cart is in ${cart.currency}. Cannot mix ${product.currency} products. Clear cart first.`,
    }
  }

  // R8 frontend M3 — re-check stock at add-to-cart. The product page
  // hides the button when OOS, but that gate is computed at RSC render
  // time under `revalidate=300`, so for up to 5 min after stock hits 0
  // the button stays live; the action is also directly callable. Adding
  // a sold-out item used to succeed and only fail at checkout with a
  // generic error. We reject here unless the product allows backorder.
  // Quote-mode items skip the check (no inventory commitment at add).
  if (product.fulfillmentMode !== 'quote') {
    const inv = product.inventory ?? {}
    const tracks = inv.trackQuantity !== false
    const allowBackorder = inv.allowBackorder === true
    const available = typeof inv.quantity === 'number' ? inv.quantity : 0
    if (tracks && !allowBackorder) {
      // Account for what's already in the cart for this product.
      const existing = cart.items.find((i) => String(i.productId) === String(product.id))
      const alreadyInCart = existing?.quantity ?? 0
      if (available <= 0) {
        return { ok: false, error: 'This item is out of stock.' }
      }
      if (alreadyInCart + qty > available) {
        return {
          ok: false,
          error:
            available - alreadyInCart > 0
              ? `Only ${available - alreadyInCart} more of this item available.`
              : 'You already have the maximum available quantity in your cart.',
        }
      }
    }
  }

  const vendorId = typeof product.vendor === 'object' ? product.vendor.id : product.vendor

  const line: CartLineItem = {
    productId: product.id,
    vendorId,
    slug: product.slug,
    title: product.title,
    imageUrl: product.images?.[0]?.image?.url,
    unitPriceMinor: product.priceMinor,
    currency: product.currency,
    quantity: qty,
    fulfillmentMode: product.fulfillmentMode,
    // B11 fix: snapshot weight so the shipping quote API matches what
    // createOrderFromCart will compute server-side. Falls back to live
    // DB lookup for legacy carts that pre-date this field.
    weightGrams: product.shipping?.weightGrams ?? undefined,
    snapshotAt: Date.now(),
  }

  cart = upsertLine(cart, line)
  const writeErr = await safeWrite(cart)
  if (writeErr) return writeErr
  revalidatePath('/cart')
  // B13 fix: don't revalidate the whole homepage on every add-to-cart.
  // Header cart count is read via readCart() on each request anyway.
  return {
    ok: true,
    itemCount: cart.items.reduce((acc, i) => acc + i.quantity, 0),
    totalMinor: cart.items.reduce((acc, i) => acc + i.unitPriceMinor * i.quantity, 0),
  }
}

export async function updateCartLine(productId: string | number, quantity: number): Promise<CartActionResult> {
  const qty = Math.max(0, Math.min(MAX_QTY_PER_LINE, Math.floor(quantity)))
  let cart = await readCart()

  // Clean-room frontend — re-check stock on quantity increase, mirroring
  // addToCartBySlug. Previously the cart could be set above available
  // stock and only failed at order creation with a generic cart_drift
  // error; now we reject inline. Only applies to stock-tracked,
  // non-backorder, non-quote products and only when raising the qty.
  if (qty > 0) {
    const existing = cart.items.find((i) => String(i.productId) === String(productId))
    if (existing && existing.fulfillmentMode !== 'quote' && qty > existing.quantity) {
      try {
        const { getProductBySlug } = await import('@/lib/queries/products')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const product = (await getProductBySlug(existing.slug)) as any
        const inv = product?.inventory ?? {}
        const tracks = inv.trackQuantity !== false
        const allowBackorder = inv.allowBackorder === true
        const available = typeof inv.quantity === 'number' ? inv.quantity : 0
        if (product && tracks && !allowBackorder && qty > available) {
          return {
            ok: false,
            error:
              available > 0
                ? `Only ${available} of this item available.`
                : 'This item is out of stock.',
          }
        }
      } catch {
        // Stock lookup failed — fall through; order creation still re-checks.
      }
    }
  }

  cart = setLineQuantity(cart, productId, qty)
  const writeErr = await safeWrite(cart)
  if (writeErr) return writeErr
  revalidatePath('/cart')
  return {
    ok: true,
    itemCount: cart.items.reduce((acc, i) => acc + i.quantity, 0),
    totalMinor: cart.items.reduce((acc, i) => acc + i.unitPriceMinor * i.quantity, 0),
  }
}

export async function removeCartLine(productId: string | number): Promise<CartActionResult> {
  let cart = await readCart()
  cart = removeLine(cart, productId)
  const writeErr = await safeWrite(cart)
  if (writeErr) return writeErr
  revalidatePath('/cart')
  return {
    ok: true,
    itemCount: cart.items.reduce((acc, i) => acc + i.quantity, 0),
    totalMinor: cart.items.reduce((acc, i) => acc + i.unitPriceMinor * i.quantity, 0),
  }
}

export async function emptyCart(): Promise<CartActionResult> {
  await clearCart()
  revalidatePath('/cart')
  return { ok: true, itemCount: 0, totalMinor: 0 }
}
