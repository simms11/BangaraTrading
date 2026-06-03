/**
 * Integration tests for cancelOrderAndReleaseInventory (B72).
 *
 * Covers:
 *   - happy cancel: pending_payment → cancelled, inventory released
 *   - idempotent re-cancel: second call no-ops, doesn't double-release
 *   - already-paid no-op: out-of-order webhook arrives after `completed`
 *     for the same order — must NOT cancel or release the now-paid order
 *   - non-tracked products skip the release SQL (no negative inventory)
 */
import { describe, it, expect } from 'vitest'
import {
  createOrderFromCart,
  cancelOrderAndReleaseInventory,
  markOrderPaid,
} from '@/lib/orders'
import {
  createProduct,
  cartFor,
  getInventory,
  getOrderStatus,
  TEST_ADDRESS,
} from '../helpers/fixtures'

describe('cancelOrderAndReleaseInventory', () => {
  it('cancels a pending order and releases the inventory that was decremented', async () => {
    const product = await createProduct({ quantity: 10 })
    const order = await createOrderFromCart({
      cart: cartFor([{ product, quantity: 4 }]),
      customerEmail: 'buyer@test.local',
      shipping: TEST_ADDRESS,
      billing: TEST_ADDRESS,
      shippingMethodId: 'pickup',
    })
    expect(await getInventory(product.id)).toBe(6)

    const result = await cancelOrderAndReleaseInventory(
      order.id,
      'stripe:checkout.session.expired',
    )

    expect(result.cancelled).toBe(true)
    expect(await getOrderStatus(order.id)).toBe('cancelled')
    expect(await getInventory(product.id)).toBe(10)
  })

  it('is idempotent: a second cancel call does not double-release inventory', async () => {
    const product = await createProduct({ quantity: 10 })
    const order = await createOrderFromCart({
      cart: cartFor([{ product, quantity: 4 }]),
      customerEmail: 'buyer@test.local',
      shipping: TEST_ADDRESS,
      billing: TEST_ADDRESS,
      shippingMethodId: 'pickup',
    })

    const first = await cancelOrderAndReleaseInventory(order.id, 'first')
    const second = await cancelOrderAndReleaseInventory(order.id, 'second')

    expect(first.cancelled).toBe(true)
    expect(second.cancelled).toBe(false)
    // Stock back to 10, not 14.
    expect(await getInventory(product.id)).toBe(10)
  })

  it('refuses to cancel an already-paid order (out-of-order webhook delivery)', async () => {
    // Real-world scenario: completed arrives, then expired arrives later
    // for the same session. Without the conditional UPDATE, the late expired
    // event would flip a paid order to cancelled and release stock that's
    // legitimately committed.
    const product = await createProduct({ quantity: 10 })
    const order = await createOrderFromCart({
      cart: cartFor([{ product, quantity: 3 }]),
      customerEmail: 'buyer@test.local',
      shipping: TEST_ADDRESS,
      billing: TEST_ADDRESS,
      shippingMethodId: 'pickup',
    })
    await markOrderPaid(order.id, {
      processor: 'stripe',
      processorRef: 'cs_test_paid',
    })

    const result = await cancelOrderAndReleaseInventory(
      order.id,
      'stripe:checkout.session.expired (late)',
    )

    expect(result.cancelled).toBe(false)
    expect(await getOrderStatus(order.id)).toBe('paid')
    // Inventory must still be 7 — the paid order legitimately holds 3 units.
    expect(await getInventory(product.id)).toBe(7)
  })

  it('does not touch inventory for products that don’t track quantity', async () => {
    const product = await createProduct({ trackQuantity: false, quantity: 0 })
    const order = await createOrderFromCart({
      cart: cartFor([{ product, quantity: 2 }]),
      customerEmail: 'buyer@test.local',
      shipping: TEST_ADDRESS,
      billing: TEST_ADDRESS,
      shippingMethodId: 'pickup',
    })
    expect(await getInventory(product.id)).toBe(0)

    await cancelOrderAndReleaseInventory(order.id, 'test')

    // Still 0 — release SQL has a WHERE inventory_track_quantity = true guard.
    expect(await getInventory(product.id)).toBe(0)
    expect(await getOrderStatus(order.id)).toBe('cancelled')
  })
})
