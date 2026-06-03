/**
 * Integration tests for round-3 audit fixes (I1–I11). Each test reproduces
 * a finding so a future regression on these surfaces fails the suite.
 *
 * - I1: the noControlChars regex must accept realistic names with spaces /
 *   hyphens / digits / unicode and reject only real control characters.
 * - I2: a vendor user cannot create a product attributed to a different
 *   vendor.
 * - I10: admin cannot flip vendor.status to 'active' until a linked User
 *   row exists.
 */
import { describe, it, expect } from 'vitest'
import { getPayload } from '@/lib/payload'
import { createProduct, createVendor } from '../helpers/fixtures'
// M4 (round-6): import the actual predicate that ships in the bundle.
// Re-implementing inline made this test pass even when the production
// `noDangerousChars` regressed (round-3's classic regex-range bug). We
// alias to the legacy name so test bodies don't need to change.
import { noDangerousChars as noControlChars } from '@/lib/utils'

const realistic = [
  'John Smith',
  '+264 81 341 6764',
  'Bangarah Trading',
  'Mary-Anne',
  "O'Brien & Co.",
  'José',
  'Ace 99',
]
const shouldReject = ['x\ry', 'name\nwith newline', 'tab\there', '\x00null']

describe('I1 — noControlChars regex (regression on the regex-range bug)', () => {
  for (const s of realistic) {
    it(`accepts ${JSON.stringify(s)}`, () => {
      expect(noControlChars(s)).toBe(true)
    })
  }
  for (const s of shouldReject) {
    it(`rejects ${JSON.stringify(s)}`, () => {
      expect(noControlChars(s)).toBe(false)
    })
  }
})

describe('I2 — Products.create cannot impersonate another vendor', () => {
  it('rewrites data.vendor to the user’s own vendor on create', async () => {
    const payload = await getPayload()
    const vendorA = await createVendor({ slug: `va-i2-${Date.now()}` })
    const vendorB = await createVendor({ slug: `vb-i2-${Date.now()}` })
    const userA = await payload.create({
      collection: 'users',
      overrideAccess: true,
      data: {
        name: 'Vendor A User',
        email: `va-i2-${Date.now()}@test.local`,
        password: 'integration-test-password',
        role: 'vendor',
        vendor: vendorA.id,
      },
    })

    // Vendor A user tries to create a product attributed to vendor B.
    const created = await payload.create({
      collection: 'products',
      overrideAccess: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      req: { user: { ...userA, collection: 'users' } } as any,
      data: {
        title: 'Impersonation attempt',
        slug: `imp-${Date.now()}`,
        vendor: vendorB.id,
        status: 'draft',
        fulfillmentMode: 'retail',
        priceMinor: 10_000,
        currency: 'NAD',
        images: [],
      },
    })
    const fresh = (await payload.findByID({
      collection: 'products',
      id: created.id,
      overrideAccess: true,
    })) as { vendor?: number | { id: number } }
    const ownerId =
      typeof fresh.vendor === 'object' && fresh.vendor !== null
        ? fresh.vendor.id
        : fresh.vendor
    // Hook forced the vendor back to the caller's own id.
    expect(String(ownerId)).toBe(String(vendorA.id))
  })
})

describe('I10 — vendor activation requires linked user', () => {
  it('refuses status=active until a linked User row exists', async () => {
    const payload = await getPayload()
    const vendor = await createVendor({
      slug: `act-${Date.now()}`,
      status: 'pending',
    })
    let threw = false
    try {
      await payload.update({
        collection: 'vendors',
        id: vendor.id,
        overrideAccess: true,
        data: { status: 'active' },
      })
    } catch (e) {
      threw = /no linked User account/i.test((e as Error).message)
    }
    expect(threw).toBe(true)

    // Now create the user and try again — should succeed.
    await payload.create({
      collection: 'users',
      overrideAccess: true,
      data: {
        name: 'Vendor User',
        email: `act-${Date.now()}@test.local`,
        password: 'integration-test-password',
        role: 'vendor',
        vendor: vendor.id,
      },
    })
    const updated = await payload.update({
      collection: 'vendors',
      id: vendor.id,
      overrideAccess: true,
      data: { status: 'active' },
    })
    expect((updated as { status?: string }).status).toBe('active')
  })
})
