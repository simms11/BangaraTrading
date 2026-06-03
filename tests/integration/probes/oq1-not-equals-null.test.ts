/**
 * Phase 2 prep — probe test for OQ1 (findings.md C1).
 *
 * Question: does Payload's `not_equals` operator on a NULL column include
 * or exclude rows where the column IS NULL? The static-analysis finding
 * assumed standard SQL three-valued logic (excludes NULL); the
 * @payloadcms/drizzle source shows the adapter explicitly emits
 * `OR(isNull(col), col <> value)`, which INCLUDES NULL rows. This probe
 * verifies the observable behaviour against the real test DB.
 */
import { describe, it, expect } from 'vitest'
import { getPayload } from '@/lib/payload'
import { createOrderFromCart } from '@/lib/orders'
import { cartFor, createProduct, TEST_ADDRESS } from '../helpers/fixtures'

describe('OQ1 probe — Payload not_equals on a NULL column', () => {
  it('includes NULL-processor pending orders in a not_equals=manual filter', async () => {
    const product = await createProduct({ quantity: 3 })
    // createOrderFromCart leaves payment.processor NULL.
    const order = await createOrderFromCart({
      cart: cartFor([{ product, quantity: 1 }]),
      customerEmail: 'oq1@test.local',
      shipping: TEST_ADDRESS,
      billing: TEST_ADDRESS,
      shippingMethodId: 'pickup',
    })
    const payload = await getPayload()
    const fresh = (await payload.findByID({
      collection: 'orders',
      id: order.id,
      depth: 0,
      overrideAccess: true,
    })) as { payment?: { processor?: string | null } }
    // Confirm the precondition: processor is null at creation.
    expect(fresh.payment?.processor ?? null).toBeNull()

    // The exact filter the sweeper uses.
    const { docs } = await payload.find({
      collection: 'orders',
      where: {
        and: [
          { status: { equals: 'pending_payment' } },
          { 'payment.processor': { not_equals: 'manual' } },
        ],
      },
      limit: 10,
      depth: 0,
      overrideAccess: true,
    })
    // The verdict: this MUST include the null-processor order. If it
    // doesn't, C1 is real (CRITICAL). If it does, C1 is a false positive.
    const found = docs.find((d) => String(d.id) === String(order.id))
    expect(found).toBeTruthy()
  })
})
