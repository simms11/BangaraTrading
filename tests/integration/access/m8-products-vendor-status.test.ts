/**
 * M8 regression — Payload's auto-exposed Products read endpoint must
 * filter by vendor.status === 'active' so direct REST/GraphQL hits
 * never surface paused/banned vendors' products. Before the fix only
 * `status: 'published'` was enforced; storefront helpers added the
 * vendor-status filter but the REST surface didn't.
 */
import { describe, it, expect } from 'vitest'
import { getPayload } from '@/lib/payload'
import { createProduct, createVendor } from '../helpers/fixtures'

describe('M8 — Products.read filters by vendor.status', () => {
  it('an anonymous read does NOT return products of a paused vendor', async () => {
    const payload = await getPayload()
    const v = await createVendor({ slug: `m8-paused-${Date.now()}` })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const product = await createProduct({ vendor: v as any, quantity: 5 })

    // Visible before the pause.
    const before = await payload.find({
      collection: 'products',
      where: { id: { equals: product.id } },
      overrideAccess: false, // anonymous read
    })
    expect(before.docs.find((d) => String(d.id) === String(product.id))).toBeTruthy()

    // Pause the vendor.
    await payload.update({
      collection: 'vendors',
      id: v.id,
      overrideAccess: true,
      data: { status: 'paused' },
    })

    // Anonymous read after pause — product must be filtered out.
    const after = await payload.find({
      collection: 'products',
      where: { id: { equals: product.id } },
      overrideAccess: false,
    })
    expect(after.docs.find((d) => String(d.id) === String(product.id))).toBeFalsy()
  })
})
