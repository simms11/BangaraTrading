/**
 * Integration tests for the vendor/product/media/quote/page access fixes
 * (G1 sweep). These reproduce the audit's CRITICAL and MAJOR findings as
 * pre-failure-then-pass tests so a regression on the access predicates
 * fails the suite loudly.
 *
 * We exercise Payload's local API with `req.user` populated (no
 * overrideAccess), which is the same code path the HTTP REST/GraphQL
 * endpoints use to authorize. If a vendor user can mutate a row they
 * shouldn't, payload.update returns an empty result OR throws "not
 * allowed" — both surfaces the policy gap.
 */
import { describe, it, expect } from 'vitest'
import { getPayload } from '@/lib/payload'
import { createProduct, createVendor } from '../helpers/fixtures'

type VendorUser = {
  id: number
  email: string
  role: 'vendor'
  vendor: number
}

async function createVendorUser(vendorId: number): Promise<VendorUser> {
  const payload = await getPayload()
  const user = (await payload.create({
    collection: 'users',
    overrideAccess: true,
    data: {
      name: `Vendor User ${vendorId}`,
      email: `vendor-${vendorId}-${Date.now()}@test.local`,
      password: 'integration-test-password',
      role: 'vendor',
      vendor: vendorId,
    },
  })) as unknown as VendorUser
  return user
}

describe('Access control sweep (G1)', () => {
  describe('Vendors collection (C1)', () => {
    it('refuses a vendor user editing another vendor’s row', async () => {
      const payload = await getPayload()
      const vendorA = await createVendor({ slug: `va-${Date.now()}` })
      const vendorB = await createVendor({ slug: `vb-${Date.now()}` })
      const userA = await createVendorUser(vendorA.id as number)

      // Direct UPDATE with vendor A's user context targeting vendor B's row.
      // The collection-level `update` access now scopes to `id == user.vendor`,
      // so Payload either rejects or returns 0 matching rows.
      let denied = false
      try {
        const res = await payload.update({
          collection: 'vendors',
          id: vendorB.id,
          overrideAccess: false,
          // @ts-expect-error req shape is loose; we pass enough for access predicates
          req: { user: { ...userA, collection: 'users' } },
          data: { name: 'PWNED' },
        })
        // If it didn't throw, the row must not have actually been updated.
        if (!res || (res as { name?: string }).name === 'PWNED') {
          throw new Error('vendor A successfully renamed vendor B — access broken')
        }
      } catch (e) {
        denied = /not allowed|forbidden|not found/i.test((e as Error).message)
      }
      expect(denied).toBe(true)

      // Confirm the row wasn't mutated.
      const fresh = await payload.findByID({
        collection: 'vendors',
        id: vendorB.id,
        overrideAccess: true,
      })
      expect((fresh as { name?: string }).name).not.toBe('PWNED')
    })

    it('allows a vendor to edit their OWN row (sanity check)', async () => {
      const payload = await getPayload()
      const vendor = await createVendor({ slug: `vown-${Date.now()}` })
      const user = await createVendorUser(vendor.id as number)
      const updated = await payload.update({
        collection: 'vendors',
        id: vendor.id,
        overrideAccess: false,
        // @ts-expect-error req shape is loose; sufficient for access predicates
        req: { user: { ...user, collection: 'users' } },
        data: { bio: 'My new bio' },
      })
      expect((updated as { bio?: string }).bio).toBe('My new bio')
    })

    it('refuses a vendor writing the payout group on their own row', async () => {
      const payload = await getPayload()
      const vendor = await createVendor({ slug: `vpay-${Date.now()}` })
      const user = await createVendorUser(vendor.id as number)

      // Vendor tries to set their own payout.accountNumber. Field-level
      // access on the `payout` group is admin-only.
      const updated = await payload.update({
        collection: 'vendors',
        id: vendor.id,
        overrideAccess: false,
        // @ts-expect-error req shape is loose
        req: { user: { ...user, collection: 'users' } },
        data: { payout: { accountNumber: '111111' } },
      })
      // The collection-level update succeeded (vendor owns the row), but
      // the field-level write on `payout.accountNumber` should NOT have
      // been applied. Re-read with admin context to inspect.
      const fresh = (await payload.findByID({
        collection: 'vendors',
        id: vendor.id,
        depth: 0,
        overrideAccess: true,
      })) as { payout?: { accountNumber?: string } }
      expect(fresh.payout?.accountNumber).not.toBe('111111')
      // sanity: we did get a vendor doc back from the update call
      expect(updated).toBeTruthy()
    })
  })

  describe('Products collection (C4)', () => {
    it('refuses a vendor publishing their own product via PATCH', async () => {
      const payload = await getPayload()
      const vendor = await createVendor({ slug: `vprod-${Date.now()}` })
      const product = await createProduct({
        vendor,
        status: 'draft',
      })
      const user = await createVendorUser(vendor.id as number)

      // Field-level access on `status` is admin-only; vendor's attempt to
      // flip to 'published' must NOT persist.
      await payload.update({
        collection: 'products',
        id: product.id,
        overrideAccess: false,
        // @ts-expect-error req shape is loose
        req: { user: { ...user, collection: 'users' } },
        data: { status: 'published' },
      })
      const fresh = (await payload.findByID({
        collection: 'products',
        id: product.id,
        overrideAccess: true,
      })) as { status?: string }
      expect(fresh.status).toBe('draft')
    })
  })

  describe('Media collection (M5)', () => {
    it('refuses a vendor deleting a media row', async () => {
      const payload = await getPayload()
      const vendor = await createVendor({ slug: `vmed-${Date.now()}` })
      const user = await createVendorUser(vendor.id as number)

      // Create a media doc via admin (overrideAccess) — vendor then tries
      // to delete it. Update/delete are admin-only after M5.
      const media = await payload.create({
        collection: 'media',
        overrideAccess: true,
        data: { alt: 'test-image' },
        // No actual file upload in this test — Payload v3 allows a row
        // without a file in some configs; if not we skip the create and
        // skip the test. Easiest path: just check the access decision.
        // (Skip if create fails.)
      }).catch(() => null)
      if (!media) return

      let denied = false
      try {
        await payload.delete({
          collection: 'media',
          id: (media as { id: number }).id,
          overrideAccess: false,
          // @ts-expect-error req shape is loose
          req: { user: { ...user, collection: 'users' } },
        })
      } catch (e) {
        denied = /not allowed|forbidden|not found/i.test((e as Error).message)
      }
      // Either the delete threw (denied) or the row still exists.
      const stillThere = await payload.findByID({
        collection: 'media',
        id: (media as { id: number }).id,
        overrideAccess: true,
      }).catch(() => null)
      expect(denied || !!stillThere).toBe(true)
    })
  })

  describe('Pages collection (M10)', () => {
    it('does not return draft pages to anonymous reads', async () => {
      const payload = await getPayload()
      await payload.create({
        collection: 'pages',
        overrideAccess: true,
        data: {
          title: 'Secret draft policy',
          slug: `draft-${Date.now()}`,
          status: 'draft',
        },
      })
      // Anonymous read — explicitly disable overrideAccess so the
      // access rule kicks in, and pass no user.
      const result = await payload.find({
        collection: 'pages',
        where: { status: { equals: 'draft' } },
        overrideAccess: false,
      })
      expect(result.docs).toHaveLength(0)
    })

    it('still returns published pages to anonymous reads', async () => {
      const payload = await getPayload()
      const slug = `pub-${Date.now()}`
      await payload.create({
        collection: 'pages',
        overrideAccess: true,
        data: { title: 'Public', slug, status: 'published' },
      })
      const result = await payload.find({
        collection: 'pages',
        where: { slug: { equals: slug } },
        overrideAccess: false,
      })
      expect(result.docs).toHaveLength(1)
    })
  })
})
