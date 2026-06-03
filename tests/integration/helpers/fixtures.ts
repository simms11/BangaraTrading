/**
 * Factory helpers that produce minimal valid Payload documents for tests.
 * Every helper bypasses access via `overrideAccess: true` because tests run
 * outside an HTTP context with no authenticated user.
 */
import { nanoid } from 'nanoid'
import { getPayload } from '@/lib/payload'
import type { Cart, CartLineItem } from '@/lib/cart/types'
import type { Product, Vendor } from '@/payload-types'

export async function createVendor(
  overrides: Partial<{ name: string; slug: string; status: Vendor['status'] }> = {},
): Promise<Vendor> {
  const payload = await getPayload()
  const slug = overrides.slug ?? `vendor-${nanoid(6)}`
  return (await payload.create({
    collection: 'vendors',
    overrideAccess: true,
    data: {
      name: overrides.name ?? `Test Vendor ${slug}`,
      slug,
      status: overrides.status ?? 'active',
    },
  })) as unknown as Vendor
}

export type ProductOverrides = {
  title?: string
  slug?: string
  priceMinor?: number
  currency?: Product['currency']
  trackQuantity?: boolean
  quantity?: number
  allowBackorder?: boolean
  status?: Product['status']
  vendor?: Vendor
  fulfillmentMode?: Product['fulfillmentMode']
}

export async function createProduct(o: ProductOverrides = {}): Promise<Product> {
  const payload = await getPayload()
  const vendor = o.vendor ?? (await createVendor())
  const slug = o.slug ?? `product-${nanoid(6)}`
  return (await payload.create({
    collection: 'products',
    overrideAccess: true,
    data: {
      title: o.title ?? `Test Product ${slug}`,
      slug,
      vendor: vendor.id,
      status: o.status ?? 'published',
      fulfillmentMode: o.fulfillmentMode ?? 'retail',
      priceMinor: o.priceMinor ?? 10_000,
      currency: o.currency ?? 'NAD',
      images: [],
      inventory: {
        trackQuantity: o.trackQuantity ?? true,
        quantity: o.quantity ?? 10,
        allowBackorder: o.allowBackorder ?? false,
        lowStockThreshold: 5,
      },
      shipping: {
        weightGrams: 500,
        requiresShipping: true,
      },
    },
  })) as unknown as Product
}

/**
 * Build a Cart in the shape readCart() would have produced. Tests pass this
 * straight into createOrderFromCart so we never have to wrangle cookies.
 */
export function cartFor(
  products: Array<{ product: Product; quantity: number }>,
): Cart {
  const items: CartLineItem[] = products.map(({ product, quantity }) => {
    const vendorId =
      typeof product.vendor === 'object'
        ? (product.vendor as { id: number }).id
        : (product.vendor as number)
    return {
      productId: product.id as number,
      vendorId,
      slug: product.slug,
      title: product.title,
      quantity,
      unitPriceMinor: product.priceMinor,
      currency: product.currency,
      snapshotAt: Date.now(),
      fulfillmentMode: product.fulfillmentMode as 'retail' | 'quote' | 'hybrid',
      weightGrams: 500,
    }
  })
  return {
    id: nanoid(16),
    items,
    currency: items[0]?.currency ?? null,
    updatedAt: Date.now(),
  }
}

export const TEST_ADDRESS = {
  name: 'Test Buyer',
  line1: '1 Test Street',
  city: 'Windhoek',
  postalCode: '10001',
  country: 'NA',
}

export async function getInventory(productId: number | string): Promise<number> {
  const payload = await getPayload()
  const product = (await payload.findByID({
    collection: 'products',
    id: productId,
    depth: 0,
    overrideAccess: true,
  })) as Product
  return product.inventory?.quantity ?? 0
}

export async function getOrderStatus(
  orderId: number | string,
): Promise<string> {
  const payload = await getPayload()
  const order = (await payload.findByID({
    collection: 'orders',
    id: orderId,
    depth: 0,
    overrideAccess: true,
  })) as { status: string }
  return order.status
}
