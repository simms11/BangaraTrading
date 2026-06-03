/**
 * R11 regression — Refunds.beforeChange must permit partial UPDATEs.
 *
 * The Phase 5.22 (R10) fallback to originalDoc.order, combined with the
 * positivity check using `Number(data.amountMinor ?? 0)`, would throw
 * "Refund amount must be positive" on any UPDATE that omits amountMinor
 * — including the auto-issue afterChange hook's
 * `{status:'completed', processorRef, refundedAt}` patch. That broke the
 * processor-refund pipeline in production but passed CI because the
 * auto-issue hook errors at the Stripe API call BEFORE reaching the
 * broken update in test env.
 *
 * This test exercises the exact failing call shape directly to lock in
 * the fix and catch any future regression.
 */
import { describe, it, expect } from 'vitest'
import { getPayload } from '@/lib/payload'
import { createOrderFromCart, markOrderPaid } from '@/lib/orders'
import { cartFor, createProduct, TEST_ADDRESS } from '../helpers/fixtures'

describe('R11 — Refunds beforeChange permits partial UPDATEs', () => {
  it('a partial UPDATE without amountMinor succeeds on a processing refund', async () => {
    const payload = await getPayload()
    const product = await createProduct({ quantity: 5, priceMinor: 10_000 })
    const order = await createOrderFromCart({
      cart: cartFor([{ product, quantity: 1 }]),
      customerEmail: 'r11-partial@test.local',
      shipping: TEST_ADDRESS,
      billing: TEST_ADDRESS,
      shippingMethodId: 'pickup',
    })
    await markOrderPaid(order.id, {
      processor: 'stripe',
      processorRef: 'cs_r11_partial',
      processorIntentRef: 'pi_r11_partial',
    })
    // Create the refund in 'processing' (mirrors the auto-issue path).
    const refund = (await payload.create({
      collection: 'refunds',
      overrideAccess: true,
      data: {
        reference: `re_r11_partial_${Date.now()}`,
        order: order.id,
        status: 'processing',
        amountMinor: 4_000,
        currency: order.currency,
        reason: 'requested_by_customer',
        processor: 'manual',
      },
    })) as { id: number }

    // Partial UPDATE: just status + processorRef + refundedAt, no
    // amountMinor and no order link. The R10 regression made this throw
    // "Refund amount must be positive."; the R11 fix lets it through.
    await expect(
      payload.update({
        collection: 'refunds',
        id: refund.id,
        overrideAccess: true,
        data: {
          status: 'completed',
          processorRef: 're_r11_partial_proc',
          refundedAt: new Date().toISOString(),
        },
      }),
    ).resolves.toBeTruthy()

    const fresh = (await payload.findByID({
      collection: 'refunds',
      id: refund.id,
      overrideAccess: true,
    })) as { status: string; amountMinor: number; processorRef: string }
    expect(fresh.status).toBe('completed')
    expect(fresh.amountMinor).toBe(4_000) // unchanged by the patch
    expect(fresh.processorRef).toBe('re_r11_partial_proc')
  })

  it('still rejects an explicit amountMinor=0 on update (positivity guard intact)', async () => {
    const payload = await getPayload()
    const product = await createProduct({ quantity: 5, priceMinor: 10_000 })
    const order = await createOrderFromCart({
      cart: cartFor([{ product, quantity: 1 }]),
      customerEmail: 'r11-pos@test.local',
      shipping: TEST_ADDRESS,
      billing: TEST_ADDRESS,
      shippingMethodId: 'pickup',
    })
    await markOrderPaid(order.id, {
      processor: 'stripe',
      processorRef: 'cs_r11_pos',
      processorIntentRef: 'pi_r11_pos',
    })
    const refund = (await payload.create({
      collection: 'refunds',
      overrideAccess: true,
      data: {
        reference: `re_r11_pos_${Date.now()}`,
        order: order.id,
        status: 'pending',
        amountMinor: 1_000,
        currency: order.currency,
        reason: 'requested_by_customer',
        processor: 'manual',
      },
    })) as { id: number }

    let threw = false
    try {
      await payload.update({
        collection: 'refunds',
        id: refund.id,
        overrideAccess: true,
        data: { amountMinor: 0 },
      })
    } catch (e) {
      threw = /amount must be positive/i.test((e as Error).message)
    }
    expect(threw).toBe(true)
  })
})
