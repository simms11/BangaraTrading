/**
 * Round-8 audit regression tests (Phase 5.19).
 *
 *   M1 (money) — refund pro-rata is over GOODS value only. A partial
 *     refund on an order with shipping+tax must not deduct the refunded
 *     shipping/tax from the vendor's goods revenue.
 *
 *   M2 (money) — a manual-processor refund stays in 'processing' (does
 *     NOT auto-complete) so ops confirms the bank transfer.
 *
 *   M3 (business) — a PAUSED vendor's products are NOT archived (pause
 *     is reversible); only BANNED archives. Both are hidden from the
 *     storefront via the vendor-status read filter.
 *
 *   M4 (business) — sending a quote (→ quoted) without validUntil
 *     defaults the expiry instead of leaving the price acceptable
 *     forever.
 */
import { describe, it, expect } from 'vitest'
import { getPayload } from '@/lib/payload'
import { createOrderFromCart, markOrderPaid } from '@/lib/orders'
import { generateVendorStatement } from '@/lib/payouts'
import {
  cartFor,
  createProduct,
  createVendor,
  TEST_ADDRESS,
} from '../helpers/fixtures'

describe('Round-8 audit regressions', () => {
  describe('M1 — refund pro-rata over goods only (shipping/tax excluded)', () => {
    it('does not deduct refunded shipping+tax from the vendor goods payout', async () => {
      const payload = await getPayload()
      const vendor = await createVendor({ slug: `r8-payout-${Date.now()}` })
      await payload.update({
        collection: 'vendors',
        id: vendor.id,
        overrideAccess: true,
        data: { commissionRate: 10 },
      })
      const product = await createProduct({ vendor, quantity: 10, priceMinor: 10_000 })
      const order = await createOrderFromCart({
        cart: cartFor([{ product, quantity: 1 }]),
        customerEmail: 'r8-payout@test.local',
        shipping: TEST_ADDRESS,
        billing: TEST_ADDRESS,
        shippingMethodId: 'pickup',
      })
      await markOrderPaid(order.id, {
        processor: 'stripe',
        processorRef: 'cs_r8_payout',
        processorIntentRef: 'pi_r8_payout',
      })
      // Inject shipping + tax so the order total exceeds the goods
      // subtotal: subtotal 10000, shipping 2000, tax 1000, total 13000.
      await payload.update({
        collection: 'orders',
        id: order.id,
        overrideAccess: true,
        data: { shippingMinor: 2000, taxMinor: 1000, totalMinor: 13_000 },
      })
      // Partial refund of 6500 (half the total).
      await payload.create({
        collection: 'refunds',
        overrideAccess: true,
        data: {
          reference: `re_r8_partial_${Date.now()}`,
          order: order.id,
          status: 'completed',
          amountMinor: 6500,
          currency: order.currency,
          reason: 'requested_by_customer',
          processor: 'manual',
          processorRef: 're_r8_partial_proc',
        },
      })

      const now = Date.now()
      const result = await generateVendorStatement({
        vendorId: vendor.id,
        periodStart: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
        periodEnd: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      // Goods-only allocation: goodsRefund = 6500 - (3000 * 6500/13000)
      //   = 6500 - 1500 = 5000 → vendorRefundShare 5000 → adjustedGross
      //   5000 → commission 500 → payout 4500. The OLD (buggy) formula
      //   deducted the full 6500 from goods → payout ~3150. Assert we're
      //   on the corrected side (>= 4400 to allow rounding slack).
      expect(result.totalPayoutMinor).toBeGreaterThanOrEqual(4_400)
    })
  })

  describe('M2 — manual refund stays processing (no auto-complete)', () => {
    it('a manual refund created in processing is NOT auto-flipped to completed', async () => {
      const payload = await getPayload()
      const product = await createProduct({ quantity: 5 })
      const order = await createOrderFromCart({
        cart: cartFor([{ product, quantity: 1 }]),
        customerEmail: 'r8-manual@test.local',
        shipping: TEST_ADDRESS,
        billing: TEST_ADDRESS,
        shippingMethodId: 'pickup',
      })
      await markOrderPaid(order.id, {
        processor: 'manual',
        processorRef: 'manual_r8',
      })
      const refund = (await payload.create({
        collection: 'refunds',
        overrideAccess: true,
        data: {
          reference: `re_r8_manual_${Date.now()}`,
          order: order.id,
          status: 'processing',
          amountMinor: 1000,
          currency: order.currency,
          reason: 'requested_by_customer',
          processor: 'manual',
        },
      })) as { id: number }
      const fresh = (await payload.findByID({
        collection: 'refunds',
        id: refund.id,
        overrideAccess: true,
      })) as { status: string }
      // Must remain 'processing' — ops confirms the bank transfer.
      expect(fresh.status).toBe('processing')
    })
  })

  describe('M3 — paused vendor is reversible (products not archived)', () => {
    it('pausing a vendor does NOT archive their products; banning does', async () => {
      const payload = await getPayload()
      const pausedVendor = await createVendor({ slug: `r8-paused-${Date.now()}` })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pausedProduct = await createProduct({ vendor: pausedVendor as any, quantity: 5 })
      await payload.update({
        collection: 'vendors',
        id: pausedVendor.id,
        overrideAccess: true,
        data: { status: 'paused' },
      })
      const afterPause = (await payload.findByID({
        collection: 'products',
        id: pausedProduct.id,
        overrideAccess: true,
      })) as { status: string }
      // Reversible — row untouched.
      expect(afterPause.status).toBe('published')

      const bannedVendor = await createVendor({ slug: `r8-banned-${Date.now()}` })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bannedProduct = await createProduct({ vendor: bannedVendor as any, quantity: 5 })
      await payload.update({
        collection: 'vendors',
        id: bannedVendor.id,
        overrideAccess: true,
        data: { status: 'banned' },
      })
      const afterBan = (await payload.findByID({
        collection: 'products',
        id: bannedProduct.id,
        overrideAccess: true,
      })) as { status: string }
      // Permanent — archived.
      expect(afterBan.status).toBe('archived')
    })

    it('storefront listing hides a paused vendor’s products via the read filter', async () => {
      const payload = await getPayload()
      const vendor = await createVendor({ slug: `r8-hide-${Date.now()}` })
      // A linked vendor user is required to re-activate (I10 guard).
      await payload.create({
        collection: 'users',
        overrideAccess: true,
        data: {
          name: 'R8 Hide Vendor User',
          email: `r8-hide-${Date.now()}@test.local`,
          password: 'integration-test-password',
          role: 'vendor',
          vendor: vendor.id,
        },
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const product = await createProduct({ vendor: vendor as any, quantity: 5 })
      const { listProducts } = await import('@/lib/queries/products')
      const before = await listProducts({ vendorSlug: vendor.slug, limit: 10 })
      expect(before.docs.find((d) => String(d.id) === String(product.id))).toBeTruthy()

      await payload.update({
        collection: 'vendors',
        id: vendor.id,
        overrideAccess: true,
        data: { status: 'paused' },
      })
      const after = await listProducts({ vendorSlug: vendor.slug, limit: 10 })
      // Hidden while paused (product row still published, just filtered).
      expect(after.docs.find((d) => String(d.id) === String(product.id))).toBeFalsy()

      // Un-pause restores visibility (reversible).
      await payload.update({
        collection: 'vendors',
        id: vendor.id,
        overrideAccess: true,
        data: { status: 'active' },
      })
      const restored = await listProducts({ vendorSlug: vendor.slug, limit: 10 })
      expect(restored.docs.find((d) => String(d.id) === String(product.id))).toBeTruthy()
    })
  })

  describe('M4 — quote sent without validUntil gets a default expiry', () => {
    it('defaults response.validUntil on the → quoted transition', async () => {
      const payload = await getPayload()
      const product = await createProduct({ fulfillmentMode: 'quote' })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vendorId = typeof (product as any).vendor === 'object'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? ((product as any).vendor as { id: number }).id
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        : (product as any).vendor
      const quote = (await payload.create({
        collection: 'quotes',
        overrideAccess: true,
        data: {
          quoteNumber: `BGQ-R8-${Date.now()}`,
          confirmationToken: 'token-r8-validuntil-default-32chars-a!',
          status: 'submitted',
          customerName: 'R8 Quote',
          customerEmail: 'r8-quote@test.local',
          items: [
            {
              product: product.id,
              vendor: vendorId,
              titleSnapshot: product.title,
              quantity: 1,
              unitPriceQuoteMinor: 5000,
            },
          ],
          currency: 'NAD',
        },
      })) as { id: number }

      // Send the quote (→ quoted) WITHOUT setting response.validUntil.
      await payload.update({
        collection: 'quotes',
        id: quote.id,
        overrideAccess: true,
        data: { status: 'quoted' },
      })
      const fresh = (await payload.findByID({
        collection: 'quotes',
        id: quote.id,
        overrideAccess: true,
      })) as { response?: { validUntil?: string | null } }
      expect(fresh.response?.validUntil).toBeTruthy()
      // Default is ~30 days out.
      const validUntil = new Date(fresh.response!.validUntil!).getTime()
      expect(validUntil).toBeGreaterThan(Date.now() + 20 * 24 * 60 * 60 * 1000)
    })
  })
})
