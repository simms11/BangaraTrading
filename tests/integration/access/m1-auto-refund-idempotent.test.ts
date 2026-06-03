/**
 * m1 — paid-after-cancel auto-refund creation must be idempotent on the
 * `auto_${processor}_${ref}` reference. Two distinct Stripe events for
 * the same order (e.g. retry with a different `event_id`) both hit the
 * cancelled branch; the second create today throws on the unique-
 * reference constraint → markOrderPaid catches and re-throws → webhook
 * 500 → infinite Stripe retry loop.
 *
 * Fix: pre-check `payload.find({ collection: 'refunds', where:
 * { reference: { equals: ref } } })`. If a row already exists for this
 * reference, log and return — the previous attempt already queued the
 * refund.
 */
import { describe, it, expect } from 'vitest'
import { getPayload } from '@/lib/payload'
import {
  cancelOrderAndReleaseInventory,
  createOrderFromCart,
  markOrderPaid,
} from '@/lib/orders'
import { cartFor, createProduct, TEST_ADDRESS } from '../helpers/fixtures'

describe('m1 — auto-refund reference idempotency', () => {
  it('a second markOrderPaid on the same paid-after-cancel scenario does not throw', async () => {
    const payload = await getPayload()
    const product = await createProduct({ quantity: 5 })
    const order = await createOrderFromCart({
      cart: cartFor([{ product, quantity: 1 }]),
      customerEmail: `m1-${Date.now()}@test.local`,
      shipping: TEST_ADDRESS,
      billing: TEST_ADDRESS,
      shippingMethodId: 'pickup',
    })
    const cancel = await cancelOrderAndReleaseInventory(order.id, 'sim:sweeper')
    expect(cancel.cancelled).toBe(true)

    // First paid-after-cancel — should create the auto_-refund row.
    await markOrderPaid(order.id, {
      processor: 'stripe',
      processorRef: 'cs_m1',
      processorIntentRef: 'pi_m1_idempotent',
    })

    // Second call with the SAME processorIntentRef simulates Stripe re-
    // delivering the event. Without the m1 fix, this throws on the
    // unique-reference constraint and the webhook would 500.
    await expect(
      markOrderPaid(order.id, {
        processor: 'stripe',
        processorRef: 'cs_m1',
        processorIntentRef: 'pi_m1_idempotent',
      }),
    ).resolves.toBeTruthy()

    // Still exactly one auto-refund row (the first one).
    const { docs } = await payload.find({
      collection: 'refunds',
      where: { order: { equals: order.id } },
      depth: 0,
      overrideAccess: true,
    })
    const autos = docs.filter((r) =>
      String((r as { reference?: string }).reference ?? '').startsWith('auto_stripe_'),
    )
    expect(autos).toHaveLength(1)
  })
})
