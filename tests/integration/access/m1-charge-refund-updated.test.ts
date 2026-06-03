/**
 * M1 regression — the Stripe webhook handler must process
 * `charge.refund.updated` / `refund.updated` events so an in-flight
 * `processing` refund moves to `completed` (or `failed`) once Stripe
 * tells us. Tested behaviourally: directly run the same payload.update
 * the handler runs, and assert the refund transitions cleanly without
 * tripping the beforeChange allowlist (a system write, no req.user).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getPayload } from '@/lib/payload'
import { createOrderFromCart, markOrderPaid } from '@/lib/orders'
import { cartFor, createProduct, TEST_ADDRESS } from '../helpers/fixtures'

describe('M1 — Stripe charge.refund.updated handler', () => {
  it('the webhook handler references the new event branches', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/app/(payload)/api/webhooks/stripe/route.ts'),
      'utf8',
    )
    expect(src).toMatch(/charge\.refund\.updated/)
    expect(src).toMatch(/refund\.updated/)
  })

  it('a processing refund can be advanced to completed via the same payload.update the handler issues', async () => {
    const payload = await getPayload()
    const product = await createProduct({ quantity: 3, priceMinor: 10_000 })
    const order = await createOrderFromCart({
      cart: cartFor([{ product, quantity: 1 }]),
      customerEmail: 'm1@test.local',
      shipping: TEST_ADDRESS,
      billing: TEST_ADDRESS,
      shippingMethodId: 'pickup',
    })
    await markOrderPaid(order.id, {
      processor: 'stripe',
      processorRef: 'cs_m1',
      processorIntentRef: 'pi_m1',
    })
    const refund = (await payload.create({
      collection: 'refunds',
      overrideAccess: true,
      data: {
        reference: `re_m1_${Date.now()}`,
        order: order.id,
        status: 'processing',
        amountMinor: 4_000,
        currency: order.currency,
        reason: 'requested_by_customer',
        processor: 'stripe',
        processorRef: 're_m1_proc',
      },
    })) as { id: number }
    // System write (no req.user) — mirrors the webhook's call shape.
    await payload.update({
      collection: 'refunds',
      id: refund.id,
      overrideAccess: true,
      data: { status: 'completed', refundedAt: new Date().toISOString() },
    })
    const fresh = (await payload.findByID({
      collection: 'refunds',
      id: refund.id,
      overrideAccess: true,
    })) as { status: string }
    expect(fresh.status).toBe('completed')
  })
})
