/**
 * R10 regression — markOrderPaid happy-path tax reconciliation.
 *
 * Setup: sweeper webhook-miss recovery calls markOrderPaid directly on a
 * pending_payment order. The Stripe webhook normally writes tax_minor
 * before flipping status to paid; the sweeper bypasses that write. The
 * R10 fix moves the tax reconcile INSIDE markOrderPaid so both paths
 * (webhook + sweeper) end up with consistent totals on Stripe Tax orders.
 */
import { describe, it, expect } from 'vitest'
import { getPayload } from '@/lib/payload'
import { createOrderFromCart, markOrderPaid } from '@/lib/orders'
import { cartFor, createProduct, TEST_ADDRESS } from '../helpers/fixtures'

describe('R10 regression — happy-path tax reconciliation', () => {
  it('reconciles totalMinor + taxMinor when amountChargedMinor exceeds the order total', async () => {
    const payload = await getPayload()
    const product = await createProduct({ quantity: 5, priceMinor: 10_000 })
    const order = await createOrderFromCart({
      cart: cartFor([{ product, quantity: 1 }]),
      customerEmail: 'r10-sweeper-tax@test.local',
      shipping: TEST_ADDRESS,
      billing: TEST_ADDRESS,
      shippingMethodId: 'pickup',
    })
    // Order created pending_payment, totalMinor=10000, taxMinor=0. Now
    // simulate the sweeper recovering a missed Stripe webhook: pass
    // amountChargedMinor=11500 (customer paid 10000 + 1500 Stripe Tax).
    const updated = await markOrderPaid(order.id, {
      processor: 'stripe',
      processorRef: 'cs_r10_sweeper',
      processorIntentRef: 'pi_r10_sweeper',
      amountChargedMinor: 11_500,
    })
    expect(updated.status).toBe('paid')

    const fresh = (await payload.findByID({
      collection: 'orders',
      id: order.id,
      overrideAccess: true,
    })) as { totalMinor: number; taxMinor?: number }
    // Reconciled — total reflects what the customer actually paid, tax
    // is captured so the platform's ledger matches Stripe.
    expect(fresh.totalMinor).toBe(11_500)
    expect(fresh.taxMinor).toBe(1_500)
  })

  it('no-ops when amountChargedMinor matches the recorded total (Stripe Tax off)', async () => {
    const payload = await getPayload()
    const product = await createProduct({ quantity: 5, priceMinor: 7_500 })
    const order = await createOrderFromCart({
      cart: cartFor([{ product, quantity: 1 }]),
      customerEmail: 'r10-notax@test.local',
      shipping: TEST_ADDRESS,
      billing: TEST_ADDRESS,
      shippingMethodId: 'pickup',
    })
    await markOrderPaid(order.id, {
      processor: 'stripe',
      processorRef: 'cs_r10_notax',
      processorIntentRef: 'pi_r10_notax',
      amountChargedMinor: order.totalMinor,
    })
    const fresh = (await payload.findByID({
      collection: 'orders',
      id: order.id,
      overrideAccess: true,
    })) as { totalMinor: number; taxMinor?: number }
    expect(fresh.totalMinor).toBe(order.totalMinor)
    expect(fresh.taxMinor ?? 0).toBe(0)
  })
})
