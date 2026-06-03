/**
 * M3 regression — the Refunds transition allowlist must reject system
 * writes that DON'T set the explicit `req.context.systemRefundUpdate`
 * marker. Previously it bypassed on `!req.user`, so any overrideAccess
 * call from outside a request context (jobs, scripts) bypassed.
 *
 * Strategy: issue a `payload.update` that flips a completed refund back
 * to `pending` with `overrideAccess: true` and NO req — this should now
 * be REJECTED by the allowlist (under the old code it was allowed).
 */
import { describe, it, expect } from 'vitest'
import { getPayload } from '@/lib/payload'
import { createOrderFromCart, markOrderPaid } from '@/lib/orders'
import { cartFor, createProduct, TEST_ADDRESS } from '../helpers/fixtures'

describe('M3 — refund transition allowlist gated on req.context.systemRefundUpdate', () => {
  it('rejects a system write that tries completed → pending without the marker', async () => {
    const payload = await getPayload()
    const product = await createProduct({ quantity: 3, priceMinor: 10_000 })
    const order = await createOrderFromCart({
      cart: cartFor([{ product, quantity: 1 }]),
      customerEmail: 'm3@test.local',
      shipping: TEST_ADDRESS,
      billing: TEST_ADDRESS,
      shippingMethodId: 'pickup',
    })
    await markOrderPaid(order.id, {
      processor: 'stripe',
      processorRef: 'cs_m3',
      processorIntentRef: 'pi_m3',
    })
    const refund = (await payload.create({
      collection: 'refunds',
      overrideAccess: true,
      data: {
        reference: `re_m3_${Date.now()}`,
        order: order.id,
        status: 'completed',
        amountMinor: 1_000,
        currency: order.currency,
        reason: 'requested_by_customer',
        processor: 'manual',
        processorRef: 're_m3_proc',
      },
    })) as { id: number }

    let threw = false
    try {
      // System write (no req → no req.context.systemRefundUpdate marker)
      // attempting a forbidden transition. Must be rejected by the
      // allowlist now; the old `!req.user` predicate would have let it
      // through.
      await payload.update({
        collection: 'refunds',
        id: refund.id,
        overrideAccess: true,
        data: { status: 'pending' },
      })
    } catch (e) {
      threw = /transition .* not allowed/i.test((e as Error).message)
    }
    expect(threw).toBe(true)
  })
})
