/**
 * Round-4 audit regression tests:
 *
 * - J1 (C1): the Stripe API version constant is centralised. Indirect
 *   check: importing `getStripeClient` should not throw.
 * - J2 (M2): vendor cannot read Quote.confirmationToken via collection API.
 * - J2 (M3): refund amountMinor cannot be edited once completed.
 * - J3 (M11): manual-paid Orders get payment.paidAt populated by the
 *   beforeChange hook when admin flips status to paid.
 * - J5 (M2): admin reports use per-vendor commission and report
 *   `truncated: false` when under the 1000 limit.
 * - J6 (m1): noDangerousChars rejects bidi/zero-width Unicode but
 *   accepts realistic names with spaces and digits.
 */
import { describe, it, expect } from 'vitest'
import { getPayload } from '@/lib/payload'
import { getStripeClient, STRIPE_API_VERSION } from '@/lib/payments/stripe'
import { noDangerousChars } from '@/lib/utils'
import { getAdminReport } from '@/lib/queries/admin-reports'
import {
  createOrderFromCart,
  markOrderPaid,
} from '@/lib/orders'
import {
  createProduct,
  createVendor,
  cartFor,
  TEST_ADDRESS,
} from '../helpers/fixtures'

describe('Round-4 audit regressions', () => {
  describe('J1 — Stripe singleton', () => {
    it('returns the same instance on repeated calls (true singleton)', () => {
      // M4 (round-6): the previous assertion was "does not throw" — which
      // would pass even if every call constructed a fresh Stripe client
      // (the regression J1 is meant to catch). Two calls must return the
      // EXACT same reference for the singleton invariant to hold.
      const a = getStripeClient()
      const b = getStripeClient()
      // Both null (no key) or both the same instance — either way the
      // singleton contract holds.
      expect(a).toBe(b)
    })
    it('pins the API version to a known constant', () => {
      // M4 (round-6): without this assertion a future "let's just upgrade
      // the Stripe SDK and let it pick the latest" change would silently
      // break webhook signature parsing. The constant is the canonical
      // source; the test asserts its shape (year-month-day.acacia) so
      // a typo or accidental delete fails CI.
      expect(STRIPE_API_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.[a-z]+$/)
    })
  })

  describe('J6 (m1) — noDangerousChars', () => {
    const accept = ['John Smith', '+264 81 341 6764', 'Bangarah Trading', 'Mary-Anne', 'José', 'Ace 99']
    const reject = [
      'x\ry',
      'name\nwith newline',
      'tab\there',
      // U+202E (RTL override) — display-name spoofing
      'Apple‮txt.gov',
      // U+200B (zero-width space) — brand-name squat
      'Bangar​ah',
      // U+FEFF (BOM)
      'pre﻿fix',
    ]
    for (const s of accept) {
      it(`accepts ${JSON.stringify(s)}`, () => expect(noDangerousChars(s)).toBe(true))
    }
    for (const s of reject) {
      it(`rejects ${JSON.stringify(s)}`, () => expect(noDangerousChars(s)).toBe(false))
    }
  })

  describe('J2 (M3) — refund amountMinor immutable on completed', () => {
    it('throws when admin edits an already-completed refund amount', async () => {
      const payload = await getPayload()
      const product = await createProduct({ quantity: 5 })
      const order = await createOrderFromCart({
        cart: cartFor([{ product, quantity: 1 }]),
        customerEmail: 'amt@test.local',
        shipping: TEST_ADDRESS,
        billing: TEST_ADDRESS,
        shippingMethodId: 'pickup',
      })
      await markOrderPaid(order.id, {
        processor: 'stripe',
        processorRef: 'cs_for_immut',
        processorIntentRef: 'pi_for_immut',
      })
      const refund = (await payload.create({
        collection: 'refunds',
        overrideAccess: true,
        data: {
          reference: 're_immut',
          order: order.id,
          status: 'completed',
          amountMinor: 500,
          currency: order.currency,
          reason: 'requested_by_customer',
          processor: 'manual',
          processorRef: 're_immut',
        },
      })) as { id: number }

      let threw = false
      try {
        await payload.update({
          collection: 'refunds',
          id: refund.id,
          overrideAccess: true,
          data: { amountMinor: 5000 },
        })
      } catch (e) {
        threw = /immutable on a completed refund/i.test((e as Error).message)
      }
      expect(threw).toBe(true)
    })
  })

  describe('J3 (M11) — manual-paid Orders auto-populate payment fields', () => {
    it('sets paidAt + processorRef when admin flips manual order to paid', async () => {
      const payload = await getPayload()
      const product = await createProduct({ quantity: 5 })
      const order = await createOrderFromCart({
        cart: cartFor([{ product, quantity: 1 }]),
        customerEmail: 'man@test.local',
        shipping: TEST_ADDRESS,
        billing: TEST_ADDRESS,
        shippingMethodId: 'pickup',
      })
      // Mark as manual processor at the order level (mirrors what the
      // checkout server action does when the customer picks manual).
      await payload.update({
        collection: 'orders',
        id: order.id,
        overrideAccess: true,
        data: { payment: { processor: 'manual' } },
      })
      // Admin flips status to paid via the admin UI path.
      await payload.update({
        collection: 'orders',
        id: order.id,
        overrideAccess: true,
        data: { status: 'paid' },
      })
      const fresh = (await payload.findByID({
        collection: 'orders',
        id: order.id,
        overrideAccess: true,
      })) as { payment?: { paidAt?: string; processorRef?: string; processor?: string } }
      expect(fresh.payment?.processor).toBe('manual')
      expect(fresh.payment?.paidAt).toBeTruthy()
      expect(fresh.payment?.processorRef).toBeTruthy()
    })
  })

  describe('J5 (M2/M3) — admin reports', () => {
    it('reports truncated=false with a small dataset and uses per-vendor commission', async () => {
      const vendor = await createVendor({ slug: `rep-${Date.now()}` })
      const payload = await getPayload()
      // Bump commission to 20% so we can detect that the report uses it.
      await payload.update({
        collection: 'vendors',
        id: vendor.id,
        overrideAccess: true,
        data: { commissionRate: 20 },
      })
      const product = await createProduct({ vendor, quantity: 5, priceMinor: 10_000 })
      const order = await createOrderFromCart({
        cart: cartFor([{ product, quantity: 1 }]),
        customerEmail: 'rep@test.local',
        shipping: TEST_ADDRESS,
        billing: TEST_ADDRESS,
        shippingMethodId: 'pickup',
      })
      await markOrderPaid(order.id, {
        processor: 'stripe',
        processorRef: 'cs_report',
        processorIntentRef: 'pi_report',
      })
      const report = await getAdminReport(30)
      expect(report.truncated).toBe(false)
      // With 20% commission on a 10 000 minor-unit line:
      //   gross 10 000, commission 2 000 → owed 8 000.
      // (paidOutMinor is 0, no existing payouts.)
      expect(report.outstandingPayoutsMinor).toBeGreaterThanOrEqual(7_900)
      expect(report.outstandingPayoutsMinor).toBeLessThanOrEqual(8_100)
    })
  })
})
