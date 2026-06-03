/**
 * M4 regression — vendor users must NOT see `Order.confirmationToken`
 * via the API. Before the fix, role:'vendor' was in the read predicate;
 * a vendor with one line on a multi-line order could read the token and
 * hit the guest URL.
 */
import { describe, it, expect } from 'vitest'
import { getPayload } from '@/lib/payload'
import { createOrderFromCart } from '@/lib/orders'
import {
  cartFor,
  createProduct,
  createVendor,
  TEST_ADDRESS,
} from '../helpers/fixtures'

describe('M4 — Order.confirmationToken admin-only on read', () => {
  it('does NOT expose the token to a vendor user who has a line on the order', async () => {
    const payload = await getPayload()
    const vendor = await createVendor({ slug: `m4-${Date.now()}` })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const product = await createProduct({ vendor: vendor as any, quantity: 3 })
    const order = await createOrderFromCart({
      cart: cartFor([{ product, quantity: 1 }]),
      customerEmail: 'm4@test.local',
      shipping: TEST_ADDRESS,
      billing: TEST_ADDRESS,
      shippingMethodId: 'pickup',
    })
    const vendorUser = await payload.create({
      collection: 'users',
      overrideAccess: true,
      data: {
        name: 'M4 Vendor',
        email: `m4-vendor-${Date.now()}@test.local`,
        password: 'integration-test-password',
        role: 'vendor',
        vendor: vendor.id,
      },
    })
    // Read the order with the vendor user's request (NOT overrideAccess).
    const fetched = (await payload.findByID({
      collection: 'orders',
      id: order.id,
      depth: 0,
      overrideAccess: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      user: { ...vendorUser, collection: 'users' } as any,
    })) as { confirmationToken?: string | null }
    // Vendor must still see the order (collection-level access intact),
    // but the token field must be stripped/absent.
    expect(fetched).toBeTruthy()
    expect(fetched.confirmationToken ?? null).toBeNull()
  })

  it('admin still sees the token', async () => {
    const payload = await getPayload()
    const product = await createProduct({ quantity: 3 })
    const order = await createOrderFromCart({
      cart: cartFor([{ product, quantity: 1 }]),
      customerEmail: 'm4-admin@test.local',
      shipping: TEST_ADDRESS,
      billing: TEST_ADDRESS,
      shippingMethodId: 'pickup',
    })
    const adminUser = await payload.create({
      collection: 'users',
      overrideAccess: true,
      data: {
        name: 'M4 Admin',
        email: `m4-admin-${Date.now()}@test.local`,
        password: 'integration-test-password',
        role: 'admin',
      },
    })
    const fetched = (await payload.findByID({
      collection: 'orders',
      id: order.id,
      depth: 0,
      overrideAccess: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      user: { ...adminUser, collection: 'users' } as any,
    })) as { confirmationToken?: string | null }
    expect(fetched.confirmationToken).toBeTruthy()
  })
})
