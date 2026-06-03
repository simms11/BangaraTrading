/**
 * Integration tests for the Stripe webhook route handler.
 *
 * We mock verifyStripeWebhook so tests can hand-craft Stripe.Event objects
 * without computing real HMAC signatures, but every other layer is real:
 * Payload writes hit the test DB, the idempotency table is enforced, the
 * order/inventory mutation paths run end-to-end, and the email layer is
 * the only mock other than verify (set up globally in setup.ts).
 *
 * Covers:
 *   - missing signature → 400
 *   - signature verification failure → 400
 *   - checkout.session.completed → markOrderPaid + email queued
 *   - amount mismatch → 400 and no claim recorded (Stripe retries)
 *   - idempotency: same event delivered twice → second call no-ops
 *   - checkout.session.expired → cancelOrderAndReleaseInventory
 *   - payment_intent.payment_failed → cancelOrderAndReleaseInventory
 *   - charge.refunded → refund row recorded
 *   - charge.refunded → idempotent against duplicate refund ids
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type Stripe from 'stripe'

import { createOrderFromCart, markOrderPaid } from '@/lib/orders'
import { getPayload } from '@/lib/payload'
import {
  createProduct,
  cartFor,
  getInventory,
  getOrderStatus,
  TEST_ADDRESS,
} from '../helpers/fixtures'

// Module-level mock: replace verifyStripeWebhook with a vi.fn() that returns
// whatever Stripe.Event the test feeds it. Stripe SDK client construction is
// left intact since the route doesn't use it.
vi.mock('@/lib/payments/stripe', async (orig) => {
  const real = (await orig()) as Record<string, unknown>
  return {
    ...real,
    verifyStripeWebhook: vi.fn(),
  }
})

import { verifyStripeWebhook } from '@/lib/payments/stripe'
import { POST as stripeWebhookPOST } from '@/app/(payload)/api/webhooks/stripe/route'

const verifyMock = verifyStripeWebhook as unknown as ReturnType<typeof vi.fn>

function postWebhook(event: Stripe.Event | null, opts: { signature?: string | null } = {}) {
  const body = JSON.stringify(event ?? { id: 'evt_invalid' })
  const headers = new Headers()
  if (opts.signature !== null) {
    headers.set('stripe-signature', opts.signature ?? 't=1,v1=stub')
  }
  return stripeWebhookPOST(
    new Request('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      headers,
      body,
    }),
  )
}

async function seedPaidableOrder(opts: { quantity?: number; stock?: number } = {}) {
  const product = await createProduct({ quantity: opts.stock ?? 5 })
  const order = await createOrderFromCart({
    cart: cartFor([{ product, quantity: opts.quantity ?? 2 }]),
    customerEmail: 'buyer@test.local',
    shipping: TEST_ADDRESS,
    billing: TEST_ADDRESS,
    shippingMethodId: 'pickup',
  })
  return { order, product }
}

describe('POST /api/webhooks/stripe', () => {
  beforeEach(() => {
    verifyMock.mockReset()
  })

  it('returns 400 when the signature header is missing', async () => {
    const res = await postWebhook(null, { signature: null })
    expect(res.status).toBe(400)
    expect(verifyMock).not.toHaveBeenCalled()
  })

  it('returns 400 when signature verification throws', async () => {
    verifyMock.mockImplementation(() => {
      throw new Error('bad signature')
    })
    const res = await postWebhook({ id: 'evt_bad' } as Stripe.Event)
    expect(res.status).toBe(400)
  })

  it('marks an order paid when checkout.session.completed verifies', async () => {
    const { order } = await seedPaidableOrder({ stock: 5, quantity: 2 })
    const event = {
      id: 'evt_completed_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_completed',
          amount_total: order.totalMinor,
          total_details: { amount_tax: 0 },
          client_reference_id: String(order.id),
          metadata: { orderId: String(order.id) },
          customer_details: { email: 'buyer@test.local' },
        },
      },
    } as unknown as Stripe.Event
    verifyMock.mockReturnValue(event)

    const res = await postWebhook(event)
    expect(res.status).toBe(200)
    expect(await getOrderStatus(order.id)).toBe('paid')
  })

  it('rejects checkout.session.completed when paid amount doesn’t match the recorded total', async () => {
    const { order } = await seedPaidableOrder()
    const event = {
      id: 'evt_mismatch',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_mismatch',
          amount_total: order.totalMinor + 100, // tampered upward
          total_details: { amount_tax: 0 },
          client_reference_id: String(order.id),
          metadata: { orderId: String(order.id) },
          customer_details: { email: 'buyer@test.local' },
        },
      },
    } as unknown as Stripe.Event
    verifyMock.mockReturnValue(event)

    const res = await postWebhook(event)
    expect(res.status).toBe(400)
    // Order stays pending so the operator can investigate; the event must
    // NOT be claimed (Stripe should retry if it was a transient bug).
    expect(await getOrderStatus(order.id)).toBe('pending_payment')

    const payload = await getPayload()
    const claimed = await payload.find({
      collection: 'processed-events',
      where: { key: { equals: 'stripe:evt_mismatch' } },
      overrideAccess: true,
    })
    expect(claimed.docs).toHaveLength(0)
  })

  it('is idempotent against duplicate event deliveries (Stripe at-least-once)', async () => {
    const { order } = await seedPaidableOrder({ stock: 5, quantity: 2 })
    const event = {
      id: 'evt_duplicate',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_dup',
          amount_total: order.totalMinor,
          total_details: { amount_tax: 0 },
          client_reference_id: String(order.id),
          metadata: { orderId: String(order.id) },
          customer_details: { email: 'buyer@test.local' },
        },
      },
    } as unknown as Stripe.Event
    verifyMock.mockReturnValue(event)

    const first = await postWebhook(event)
    const second = await postWebhook(event)
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    const secondBody = (await second.json()) as { idempotent?: boolean }
    expect(secondBody.idempotent).toBe(true)
  })

  it('cancels the order and releases inventory on checkout.session.expired', async () => {
    const { order, product } = await seedPaidableOrder({ stock: 10, quantity: 3 })
    expect(await getInventory(product.id)).toBe(7)

    const event = {
      id: 'evt_expired',
      type: 'checkout.session.expired',
      data: {
        object: {
          id: 'cs_test_expired',
          metadata: { orderId: String(order.id) },
          client_reference_id: String(order.id),
        },
      },
    } as unknown as Stripe.Event
    verifyMock.mockReturnValue(event)

    const res = await postWebhook(event)
    expect(res.status).toBe(200)
    expect(await getOrderStatus(order.id)).toBe('cancelled')
    expect(await getInventory(product.id)).toBe(10)
  })

  it('cancels the order and releases inventory on payment_intent.payment_failed', async () => {
    const { order, product } = await seedPaidableOrder({ stock: 8, quantity: 2 })

    const event = {
      id: 'evt_pi_failed',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: 'pi_test_failed',
          metadata: { orderId: String(order.id) },
        },
      },
    } as unknown as Stripe.Event
    verifyMock.mockReturnValue(event)

    const res = await postWebhook(event)
    expect(res.status).toBe(200)
    expect(await getOrderStatus(order.id)).toBe('cancelled')
    expect(await getInventory(product.id)).toBe(8)
  })

  it('records a refund row on charge.refunded and is idempotent on replay', async () => {
    // Seed a paid order first so the refund has something to attach to.
    // C3 fix: the webhook looks up by `payment.processorIntentRef`, so we
    // populate that explicitly here. `processorRef` stays the session id
    // (cs_…) like the real flow; the PaymentIntent (pi_…) is what the
    // refund event carries and what the lookup uses.
    const { order } = await seedPaidableOrder({ stock: 5, quantity: 1 })
    await markOrderPaid(order.id, {
      processor: 'stripe',
      processorRef: 'cs_test_paid_for_refund',
      processorIntentRef: 'pi_charged',
    })

    const event = {
      id: 'evt_refund_1',
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_test',
          payment_intent: 'pi_charged',
          refunds: {
            data: [
              {
                id: 're_test_1',
                amount: 500,
                currency: 'nad',
                reason: 'requested_by_customer',
                created: Math.floor(Date.now() / 1000),
              },
            ],
          },
        },
      },
    } as unknown as Stripe.Event
    verifyMock.mockReturnValue(event)

    expect((await postWebhook(event)).status).toBe(200)
    // Replay with a different event id (Stripe redelivery) but same refund id:
    // the route must NOT create a second refund row.
    const replay = {
      ...event,
      id: 'evt_refund_1_replay',
    } as unknown as Stripe.Event
    verifyMock.mockReturnValue(replay)
    expect((await postWebhook(replay)).status).toBe(200)

    const payload = await getPayload()
    const refunds = await payload.find({
      collection: 'refunds',
      where: { processorRef: { equals: 're_test_1' } },
      overrideAccess: true,
    })
    expect(refunds.docs).toHaveLength(1)
  })
})
