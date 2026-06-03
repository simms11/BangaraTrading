/**
 * Integration tests for round-2 audit fixes (H1–H11).
 * Each test reproduces a finding so future regressions on the same
 * surface fail loudly.
 */
import { describe, it, expect } from 'vitest'
import { getPayload } from '@/lib/payload'
import {
  cancelOrderAndReleaseInventory,
  createOrderFromCart,
  markOrderPaid,
} from '@/lib/orders'
import {
  createProduct,
  cartFor,
  getInventory,
  getOrderStatus,
  TEST_ADDRESS,
} from '../helpers/fixtures'

describe('Round-2 audit regressions', () => {
  describe('H2 — JSON-LD escape against script-tag breakout', () => {
    it('safeStringify escapes < > & + U+2028/U+2029 so a </script> payload cannot break out', async () => {
      // M4 (round-6): the previous test asserted the VULNERABLE baseline
      // (`JSON.stringify(...)` contains `</script>`) instead of testing
      // that the production helper neutralises it. Now we call the actual
      // exported `safeStringify` and verify the rendered string is
      // injection-safe: angle brackets, ampersand, and the two line
      // separators are all unicode-escaped.
      const { safeStringify } = await import('@/components/seo/json-ld')
      const malicious = {
        title: 'Hello </script><script>alert(1)</script>',
        amp: 'a&b',
        ls: `line1${String.fromCharCode(0x2028)}line2`,
        ps: `para1${String.fromCharCode(0x2029)}para2`,
      }
      const out = safeStringify(malicious)
      // No raw script-breakout tokens survive.
      expect(out).not.toContain('</script>')
      expect(out).not.toContain('<script>')
      expect(out).not.toContain('<')
      expect(out).not.toContain('>')
      expect(out).not.toContain('&')
      expect(out).not.toContain(String.fromCharCode(0x2028))
      expect(out).not.toContain(String.fromCharCode(0x2029))
      // Confirm the escape sequences are present (proof we passed through
      // the helper, not a coincidence).
      expect(out).toContain('\\u003c') // <
      expect(out).toContain('\\u003e') // >
      expect(out).toContain('\\u0026') // &
      expect(out).toContain('\\u2028')
      expect(out).toContain('\\u2029')
    })
  })

  describe('H5 — inventory leak on processor failure', () => {
    it('cancelOrderAndReleaseInventory restores stock that createOrderFromCart deducted', async () => {
      const product = await createProduct({ quantity: 12 })
      const order = await createOrderFromCart({
        cart: cartFor([{ product, quantity: 4 }]),
        customerEmail: 'leak@test.local',
        shipping: TEST_ADDRESS,
        billing: TEST_ADDRESS,
        shippingMethodId: 'pickup',
      })
      expect(await getInventory(product.id)).toBe(8)
      const result = await cancelOrderAndReleaseInventory(
        order.id,
        'processor session-create failed (simulated)',
      )
      expect(result.cancelled).toBe(true)
      expect(await getInventory(product.id)).toBe(12)
      expect(await getOrderStatus(order.id)).toBe('cancelled')
    })
  })

  describe('H3 — banned vendor product cannot be queried via listProducts', () => {
    it('a banned vendor’s published products do not appear in storefront listings', async () => {
      // M4 (round-6): the previous test was a SQL round-trip tautology
      // ("create vendor with status=banned, read it back, status=banned").
      // The real invariant we care about is that listProducts (the
      // storefront query) tombstones products belonging to banned vendors.
      // The cascade-archive afterChange in Vendors.ts flips their
      // products to status='archived' which listProducts filters out.
      const payload = await getPayload()
      const vendor = await payload.create({
        collection: 'vendors',
        overrideAccess: true,
        data: {
          name: 'BanCascade',
          slug: `bancascade-${Date.now()}`,
          status: 'active',
        },
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const product = await createProduct({ vendor: vendor as any, quantity: 5 })

      // Visible before the ban.
      const { listProducts } = await import('@/lib/queries/products')
      const before = await listProducts({ vendorSlug: vendor.slug, limit: 10 })
      expect(before.docs.find((d) => String(d.id) === String(product.id))).toBeTruthy()

      // Ban the vendor — cascade archives published products.
      await payload.update({
        collection: 'vendors',
        id: vendor.id,
        overrideAccess: true,
        data: { status: 'banned' },
      })

      const after = await listProducts({ vendorSlug: vendor.slug, limit: 10 })
      expect(after.docs.find((d) => String(d.id) === String(product.id))).toBeFalsy()
    })
  })

  describe('H6 — vendor cross-line tampering on Quotes', () => {
    it('rejects a vendor write that mutates another vendor’s line price', async () => {
      const payload = await getPayload()
      // Create two vendors, a product per vendor, one quote with both lines.
      const vendorA = await payload.create({
        collection: 'vendors',
        overrideAccess: true,
        data: { name: 'VendorA', slug: `va-${Date.now()}`, status: 'active' },
      })
      const vendorB = await payload.create({
        collection: 'vendors',
        overrideAccess: true,
        data: { name: 'VendorB', slug: `vb-${Date.now()}`, status: 'active' },
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prodA = await createProduct({
        vendor: vendorA as any,
        fulfillmentMode: 'quote',
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prodB = await createProduct({
        vendor: vendorB as any,
        fulfillmentMode: 'quote',
      })

      const quote = await payload.create({
        collection: 'quotes',
        overrideAccess: true,
        data: {
          quoteNumber: `BGQ-TEST-${Date.now()}`,
          confirmationToken: 'token-for-test-only-not-a-real-secret',
          status: 'quoted',
          customerName: 'Quote Buyer',
          customerEmail: 'buyer@test.local',
          items: [
            {
              product: prodA.id,
              vendor: vendorA.id,
              titleSnapshot: prodA.title,
              quantity: 1,
              unitPriceQuoteMinor: 1000,
            },
            {
              product: prodB.id,
              vendor: vendorB.id,
              titleSnapshot: prodB.title,
              quantity: 1,
              unitPriceQuoteMinor: 2000,
            },
          ],
          currency: 'NAD',
        },
      })

      // Create a vendor-A user, then attempt to mutate vendor-B's line.
      const userA = await payload.create({
        collection: 'users',
        overrideAccess: true,
        data: {
          name: 'VendorA User',
          email: `va-user-${Date.now()}@test.local`,
          password: 'integration-test-password',
          role: 'vendor',
          vendor: vendorA.id,
        },
      })

      let threw = false
      try {
        await payload.update({
          collection: 'quotes',
          id: quote.id,
          overrideAccess: false,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          req: { user: { ...userA, collection: 'users' } } as any,
          data: {
            // Echo vendor A's line, but inflate vendor B's price.
            items: [
              {
                product: prodA.id,
                vendor: vendorA.id,
                titleSnapshot: prodA.title,
                quantity: 1,
                unitPriceQuoteMinor: 1000,
              },
              {
                product: prodB.id,
                vendor: vendorB.id,
                titleSnapshot: prodB.title,
                quantity: 1,
                unitPriceQuoteMinor: 5_000_000, // tampered
              },
            ],
          },
        })
      } catch (e) {
        // Both error wordings indicate the hook rejected the cross-line write.
        threw = /(own quote lines|another vendor)/i.test((e as Error).message)
      }
      expect(threw).toBe(true)
    })
  })

  describe('H4 — markOrderPaid + new processorIntentRef field', () => {
    it('round-trips processorIntentRef so refund lookups can resolve back', async () => {
      const product = await createProduct({ quantity: 5 })
      const order = await createOrderFromCart({
        cart: cartFor([{ product, quantity: 1 }]),
        customerEmail: 'pi@test.local',
        shipping: TEST_ADDRESS,
        billing: TEST_ADDRESS,
        shippingMethodId: 'pickup',
      })
      await markOrderPaid(order.id, {
        processor: 'stripe',
        processorRef: 'cs_test_pi_roundtrip',
        processorIntentRef: 'pi_test_roundtrip',
      })
      const payload = await getPayload()
      const fresh = (await payload.findByID({
        collection: 'orders',
        id: order.id,
        overrideAccess: true,
      })) as { payment?: { processorIntentRef?: string; processorRef?: string } }
      expect(fresh.payment?.processorIntentRef).toBe('pi_test_roundtrip')
      expect(fresh.payment?.processorRef).toBe('cs_test_pi_roundtrip')
    })
  })
})
