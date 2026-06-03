/**
 * Integration tests for createOrderFromCart.
 *
 * Covers:
 *   - happy path: order persisted, inventory decremented atomically
 *   - oversell guard: a quantity-larger-than-stock cart is rejected before
 *     inventory is touched (pre-validation)
 *   - race loss: concurrent orders for the last unit — only one survives
 *   - decrement revert: if payload.create throws after decrements succeed,
 *     all decrements are reversed (B74 compensation)
 *   - quantity tampering: cart with qty > 99 is rejected with cart_drift
 *   - mixed currency rejection
 *   - allow_backorder lets inventory go negative
 */
import { describe, it, expect, vi } from 'vitest'
import {
  createOrderFromCart,
  OrderValidationError,
} from '@/lib/orders'
import {
  createProduct,
  createVendor,
  cartFor,
  getInventory,
  TEST_ADDRESS,
} from '../helpers/fixtures'
import { getPayload } from '@/lib/payload'

describe('createOrderFromCart', () => {
  it('persists the order and atomically decrements inventory', async () => {
    const product = await createProduct({ priceMinor: 5_000, quantity: 10 })

    const order = await createOrderFromCart({
      cart: cartFor([{ product, quantity: 3 }]),
      customerEmail: 'buyer@test.local',
      shipping: TEST_ADDRESS,
      billing: TEST_ADDRESS,
      shippingMethodId: 'pickup',
    })

    expect(order.status).toBe('pending_payment')
    expect(order.subtotalMinor).toBe(15_000)
    expect(order.lineItems?.[0]?.quantity).toBe(3)
    expect(await getInventory(product.id)).toBe(7)
  })

  it('rejects a cart that exceeds available stock before touching inventory', async () => {
    const product = await createProduct({ quantity: 2 })

    await expect(
      createOrderFromCart({
        cart: cartFor([{ product, quantity: 5 }]),
        customerEmail: 'buyer@test.local',
        shipping: TEST_ADDRESS,
        billing: TEST_ADDRESS,
        shippingMethodId: 'pickup',
      }),
    ).rejects.toBeInstanceOf(OrderValidationError)
    // Inventory must not have been moved.
    expect(await getInventory(product.id)).toBe(2)
  })

  it('serializes two concurrent orders for the last unit — only one wins', async () => {
    // Stock of exactly 1. Two callers race; we expect exactly one to succeed
    // and the other to fail with out_of_stock_race. Without B68/B74 both
    // could succeed (oversell).
    const product = await createProduct({ quantity: 1 })

    const cartA = cartFor([{ product, quantity: 1 }])
    const cartB = cartFor([{ product, quantity: 1 }])

    const results = await Promise.allSettled([
      createOrderFromCart({
        cart: cartA,
        customerEmail: 'a@test.local',
        shipping: TEST_ADDRESS,
        billing: TEST_ADDRESS,
        shippingMethodId: 'pickup',
      }),
      createOrderFromCart({
        cart: cartB,
        customerEmail: 'b@test.local',
        shipping: TEST_ADDRESS,
        billing: TEST_ADDRESS,
        shippingMethodId: 'pickup',
      }),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    const err = (rejected[0] as PromiseRejectedResult).reason
    expect(err).toBeInstanceOf(OrderValidationError)
    // Either gate is acceptable proof that we didn't oversell:
    //   - cart_drift = pre-validation caught the stale stock first
    //   - out_of_stock_race = atomic SQL decrement caught the race
    // The critical invariant is that exactly one order succeeded and
    // inventory ended at 0.
    expect(['out_of_stock_race', 'cart_drift']).toContain(
      (err as OrderValidationError).code,
    )
    expect(await getInventory(product.id)).toBe(0)
  })

  it('reverts inventory if payload.create throws after the decrement succeeds', async () => {
    const product = await createProduct({ quantity: 8 })
    const startStock = await getInventory(product.id)

    // Spy on payload.create and make it throw on the orders collection so we
    // exercise the compensation path in createOrderFromCart.
    const payload = await getPayload()
    const realCreate = payload.create.bind(payload)
    const spy = vi.spyOn(payload, 'create').mockImplementation(async (args) => {
      if (args.collection === 'orders') {
        throw new Error('simulated DB write failure')
      }
      return realCreate(args)
    })

    try {
      await expect(
        createOrderFromCart({
          cart: cartFor([{ product, quantity: 3 }]),
          customerEmail: 'buyer@test.local',
          shipping: TEST_ADDRESS,
          billing: TEST_ADDRESS,
          shippingMethodId: 'pickup',
        }),
      ).rejects.toThrow(/simulated DB write failure/)
      expect(await getInventory(product.id)).toBe(startStock)
    } finally {
      spy.mockRestore()
    }
  })

  it('rejects a tampered quantity > 99 as cart drift', async () => {
    const product = await createProduct({ quantity: 1_000 })

    const cart = cartFor([{ product, quantity: 500 }])

    await expect(
      createOrderFromCart({
        cart,
        customerEmail: 'buyer@test.local',
        shipping: TEST_ADDRESS,
        billing: TEST_ADDRESS,
        shippingMethodId: 'pickup',
      }),
    ).rejects.toMatchObject({ code: 'cart_drift' })
    expect(await getInventory(product.id)).toBe(1_000)
  })

  it('refuses a cart that mixes currencies', async () => {
    const vendor = await createVendor()
    const nadProduct = await createProduct({
      currency: 'NAD',
      vendor,
      quantity: 5,
    })
    const usdProduct = await createProduct({
      currency: 'USD',
      vendor,
      quantity: 5,
    })

    await expect(
      createOrderFromCart({
        cart: cartFor([
          { product: nadProduct, quantity: 1 },
          { product: usdProduct, quantity: 1 },
        ]),
        customerEmail: 'buyer@test.local',
        shipping: TEST_ADDRESS,
        billing: TEST_ADDRESS,
        shippingMethodId: 'pickup',
      }),
    ).rejects.toMatchObject({ code: 'mixed_currency' })
  })

  it('allows inventory to go negative when allowBackorder is set', async () => {
    const product = await createProduct({
      quantity: 1,
      allowBackorder: true,
    })

    const order = await createOrderFromCart({
      cart: cartFor([{ product, quantity: 5 }]),
      customerEmail: 'buyer@test.local',
      shipping: TEST_ADDRESS,
      billing: TEST_ADDRESS,
      shippingMethodId: 'pickup',
    })

    expect(order.status).toBe('pending_payment')
    expect(await getInventory(product.id)).toBe(-4)
  })
})
