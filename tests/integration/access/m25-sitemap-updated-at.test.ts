/**
 * m25 — sitemap.xml currently emits `lastModified: now` for every URL.
 * That tells Googlebot every URL changed simultaneously on every poll;
 * crawl-priority on real changes is lost.
 *
 * Fix: list helpers return `{ slug, updatedAt }`; sitemap emits
 * `new Date(doc.updatedAt)`.
 *
 * Behavioral test: create a product + vendor + page with controlled
 * `updatedAt` values, call the list helpers, and assert each returned
 * row carries a date AND that the date is not "approximately now"
 * (it should be the actual stored value).
 */
import { describe, it, expect } from 'vitest'
import { getPayload } from '@/lib/payload'
import { listProductSlugs } from '@/lib/queries/products'
import { listVendorSlugs } from '@/lib/queries/vendors'
import { listPageSlugs } from '@/lib/queries/pages'
import { createProduct } from '../helpers/fixtures'

describe('m25 — sitemap list helpers return per-row updatedAt', () => {
  it('all three list helpers return { slug, updatedAt } objects, not bare slug strings', async () => {
    const payload = await getPayload()
    // Create a known product so we have controlled data to assert
    // against (no reliance on prior seed state).
    const product = await createProduct({ quantity: 5 })
    // Active vendor + published page so vendor and page helpers also
    // have something to find.
    const vendor = (await payload.findByID({
      collection: 'vendors',
      id: typeof product.vendor === 'object' ? product.vendor.id : product.vendor,
      depth: 0,
      overrideAccess: true,
    })) as { status?: string }
    expect(vendor.status).toBe('active')
    await payload.create({
      collection: 'pages',
      overrideAccess: true,
      data: {
        title: `m25 page ${Date.now()}`,
        slug: `m25-page-${Date.now()}`,
        status: 'published',
        meta: {},
      },
    })

    const products = (await listProductSlugs()) as Array<unknown>
    expect(products.length).toBeGreaterThan(0)
    const vendors = (await listVendorSlugs()) as Array<unknown>
    expect(vendors.length).toBeGreaterThan(0)
    const pages = (await listPageSlugs()) as Array<unknown>
    expect(pages.length).toBeGreaterThan(0)

    for (const [label, sample] of [
      ['product', products[0]],
      ['vendor', vendors[0]],
      ['page', pages[0]],
    ] as const) {
      // Tripwire: per-row object with both fields. Old helpers returned
      // bare string slugs; the fix returns objects.
      expect(typeof sample, `${label} row is an object`).toBe('object')
      const first = sample as { slug?: unknown; updatedAt?: unknown }
      expect(typeof first.slug, `${label}.slug is a string`).toBe('string')
      expect(typeof first.updatedAt, `${label}.updatedAt is a string`).toBe('string')
      expect(
        Number.isFinite(new Date(first.updatedAt as string).getTime()),
        `${label}.updatedAt parses to a valid Date`,
      ).toBe(true)
    }
  })
})
