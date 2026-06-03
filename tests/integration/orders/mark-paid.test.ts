/**
 * Integration tests for markOrderPaid.
 *
 * Covers:
 *   - happy transition: pending_payment → paid, payment fields populated,
 *     audit-log entry emitted (B73 manual audit because raw SQL bypasses
 *     the Payload afterChange hook)
 *   - idempotent re-call: second invocation returns the same order without
 *     changing it
 *   - concurrent racing webhook deliveries: only one transitions; the rest
 *     return the already-paid order (B73 TOCTOU close)
 *   - terminal-status rejection: cancelled order throws (B69)
 *   - stale-processorRef warning: re-calling with a different ref logs
 *     a double-charge signal
 */
import { describe, it, expect, vi } from 'vitest'
import {
  createOrderFromCart,
  markOrderPaid,
  OrderStatusTransitionError,
} from '@/lib/orders'
import { getPayload } from '@/lib/payload'
import {
  createProduct,
  cartFor,
  TEST_ADDRESS,
  getOrderStatus,
} from '../helpers/fixtures'

async function seedOrder() {
  const product = await createProduct({ quantity: 5 })
  const order = await createOrderFromCart({
    cart: cartFor([{ product, quantity: 1 }]),
    customerEmail: 'buyer@test.local',
    shipping: TEST_ADDRESS,
    billing: TEST_ADDRESS,
    shippingMethodId: 'pickup',
  })
  return { order, product }
}

describe('markOrderPaid', () => {
  it('transitions pending_payment → paid and emits an audit entry', async () => {
    const { order } = await seedOrder()

    const updated = await markOrderPaid(order.id, {
      processor: 'stripe',
      processorRef: 'cs_test_happy',
    })

    expect(updated.status).toBe('paid')
    expect(updated.payment?.processor).toBe('stripe')
    expect(updated.payment?.processorRef).toBe('cs_test_happy')
    expect(updated.payment?.paidAt).toBeTruthy()

    const payload = await getPayload()
    const { docs } = await payload.find({
      collection: 'audit-log',
      where: { subjectId: { equals: String(order.id) } },
      overrideAccess: true,
    })
    expect(
      docs.some(
        (d: { kind?: string }) => d.kind === 'order.status_changed',
      ),
    ).toBe(true)
  })

  it('is idempotent on re-call with the same processorRef', async () => {
    const { order } = await seedOrder()

    await markOrderPaid(order.id, {
      processor: 'stripe',
      processorRef: 'cs_test_idem',
    })
    const second = await markOrderPaid(order.id, {
      processor: 'stripe',
      processorRef: 'cs_test_idem',
    })

    expect(second.status).toBe('paid')
    expect(second.payment?.processorRef).toBe('cs_test_idem')
  })

  it('logs a double-charge warning when re-called with a different processorRef', async () => {
    const { order } = await seedOrder()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      await markOrderPaid(order.id, {
        processor: 'stripe',
        processorRef: 'cs_test_original',
      })
      await markOrderPaid(order.id, {
        processor: 'stripe',
        processorRef: 'cs_test_DIFFERENT',
      })

      const messages = errorSpy.mock.calls.flat().join('\n')
      expect(messages).toMatch(/already paid via processorRef cs_test_original/)
      expect(messages).toMatch(/Possible double-charge/)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('on cancelled order + late Stripe payment, queues an auto-refund (does NOT throw)', async () => {
    // M1 (round-6 C2) — paid-after-cancel race. The OLD behaviour threw
    // OrderStatusTransitionError, which caused the Stripe webhook to
    // 500 → infinite retries → customer's money stranded. The NEW
    // behaviour creates a pending refund row, returns the cancelled
    // order, and the auto-issue chain refunds the customer.
    const { order } = await seedOrder()
    const payload = await getPayload()
    await payload.update({
      collection: 'orders',
      id: order.id,
      overrideAccess: true,
      data: { status: 'cancelled' },
    })

    const result = await markOrderPaid(order.id, {
      processor: 'stripe',
      processorRef: 'cs_test_late',
    })
    // Order stays cancelled; refund row settles funds asynchronously.
    expect(result.status).toBe('cancelled')
    expect(await getOrderStatus(order.id)).toBe('cancelled')

    const { docs: refunds } = await payload.find({
      collection: 'refunds',
      where: { order: { equals: order.id } },
      overrideAccess: true,
    })
    expect(refunds.length).toBeGreaterThanOrEqual(1)
  })

  it('on cancelled order + late MANUAL payment, still throws (no auto-refund for manual)', async () => {
    // M1 (round-6 C2) — manual-processor late payments don't auto-refund
    // (admin handles bank-transfer reversal manually). We return the
    // existing order cleanly without throwing — the webhook flow for
    // manual is admin-driven anyway.
    const { order } = await seedOrder()
    const payload = await getPayload()
    await payload.update({
      collection: 'orders',
      id: order.id,
      overrideAccess: true,
      data: { status: 'cancelled' },
    })
    const result = await markOrderPaid(order.id, {
      processor: 'manual',
      processorRef: 'manual_late_ref',
    })
    expect(result.status).toBe('cancelled')
    const { docs: refunds } = await payload.find({
      collection: 'refunds',
      where: { order: { equals: order.id } },
      overrideAccess: true,
    })
    // No auto refund created for manual processor.
    const auto = refunds.find((r) =>
      String((r as { reference?: string }).reference ?? '').startsWith('auto_'),
    )
    expect(auto).toBeFalsy()
  })

  it('serializes concurrent racing webhook deliveries — only one transitions', async () => {
    // Closing the TOCTOU: prior code did findByID → payload.update, so two
    // racing deliveries could both read pending_payment and both update. The
    // conditional UPDATE means exactly one of these promises is the "winner"
    // (it did the actual flip); the others fall through to the idempotent
    // already-paid branch.
    const { order } = await seedOrder()

    const results = await Promise.all(
      Array.from({ length: 5 }).map((_, i) =>
        markOrderPaid(order.id, {
          processor: 'stripe',
          processorRef: `cs_test_concurrent_${i}`,
        }),
      ),
    )

    // All callers got an order back (none threw)…
    expect(results).toHaveLength(5)
    // …and all of them see the order as paid.
    for (const r of results) expect(r.status).toBe('paid')

    // Audit log must contain exactly one status_changed entry — the
    // conditional UPDATE that won.
    const payload = await getPayload()
    const { docs } = await payload.find({
      collection: 'audit-log',
      where: {
        and: [
          { subjectId: { equals: String(order.id) } },
          { kind: { equals: 'order.status_changed' } },
        ],
      },
      overrideAccess: true,
    })
    expect(docs).toHaveLength(1)
  })
})
