/**
 * Clean-room final-pass regression tests.
 *
 *   M1 (money major) — paid-after-cancel auto-refund must refund what the
 *     customer was ACTUALLY charged (incl. Stripe Tax), not order.totalMinor.
 *     When Stripe Tax is enabled the tax is only written to totalMinor on
 *     the pending→paid path; an order cancelled before that write keeps a
 *     tax-free total, so refunding totalMinor would leave the customer
 *     short by the tax. markOrderPaid now accepts amountChargedMinor and
 *     reconciles the order total so the full charged amount is refunded.
 */
import { describe, it, expect } from 'vitest'
import { getPayload } from '@/lib/payload'
import {
  cancelOrderAndReleaseInventory,
  createOrderFromCart,
  markOrderPaid,
} from '@/lib/orders'
import { cartFor, createProduct, TEST_ADDRESS } from '../helpers/fixtures'

describe('Clean-room final regressions', () => {
  describe('M1 — paid-after-cancel refunds the actual charged amount (incl. tax)', () => {
    it('auto-refund equals amountChargedMinor when it exceeds order.totalMinor', async () => {
      const payload = await getPayload()
      const product = await createProduct({ quantity: 5, priceMinor: 10_000 })
      const order = await createOrderFromCart({
        cart: cartFor([{ product, quantity: 1 }]),
        customerEmail: 'r9-tax@test.local',
        shipping: TEST_ADDRESS,
        billing: TEST_ADDRESS,
        shippingMethodId: 'pickup',
      })
      // order.totalMinor == subtotal (10000), tax not yet written.
      await cancelOrderAndReleaseInventory(order.id, 'sim:sweeper')

      // Late checkout.session.completed: customer was charged 11500
      // (10000 goods + 1500 Stripe Tax). Order total is still 10000.
      await markOrderPaid(order.id, {
        processor: 'stripe',
        processorRef: 'cs_r9_tax',
        processorIntentRef: 'pi_r9_tax',
        amountChargedMinor: 11_500,
      })

      const { docs: refunds } = await payload.find({
        collection: 'refunds',
        where: { order: { equals: order.id } },
        overrideAccess: true,
      })
      const auto = refunds.find((r) =>
        String((r as { reference?: string }).reference ?? '').startsWith('auto_'),
      ) as { amountMinor?: number } | undefined
      expect(auto).toBeTruthy()
      // Must refund the full 11500 charged, NOT the 10000 recorded total.
      expect(auto?.amountMinor).toBe(11_500)

      // The order total was reconciled to the charged amount.
      const fresh = (await payload.findByID({
        collection: 'orders',
        id: order.id,
        overrideAccess: true,
      })) as { totalMinor: number; taxMinor?: number }
      expect(fresh.totalMinor).toBe(11_500)
      expect(fresh.taxMinor).toBe(1_500)
    })

    it('without amountChargedMinor, refunds the order total (no Stripe Tax case)', async () => {
      const payload = await getPayload()
      const product = await createProduct({ quantity: 5, priceMinor: 8_000 })
      const order = await createOrderFromCart({
        cart: cartFor([{ product, quantity: 1 }]),
        customerEmail: 'r9-notax@test.local',
        shipping: TEST_ADDRESS,
        billing: TEST_ADDRESS,
        shippingMethodId: 'pickup',
      })
      await cancelOrderAndReleaseInventory(order.id, 'sim:sweeper')
      await markOrderPaid(order.id, {
        processor: 'stripe',
        processorRef: 'cs_r9_notax',
        processorIntentRef: 'pi_r9_notax',
      })
      const { docs: refunds } = await payload.find({
        collection: 'refunds',
        where: { order: { equals: order.id } },
        overrideAccess: true,
      })
      const auto = refunds.find((r) =>
        String((r as { reference?: string }).reference ?? '').startsWith('auto_'),
      ) as { amountMinor?: number } | undefined
      expect(auto?.amountMinor).toBe(order.totalMinor)
    })
  })
})
