import type { CollectionConfig } from 'payload'
import { isAdmin, isAdminFieldAccess, isAdminOrOwnVendor, publicRead } from '../access'
import { vendorApprovalEmailHook } from '../hooks/vendorApprovalEmail'
import { auditVendor } from '../hooks/audit'
import { revalidateVendor } from '../hooks/revalidate'

export const Vendors: CollectionConfig = {
  slug: 'vendors',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'status', 'country', 'createdAt'],
  },
  access: {
    read: publicRead,
    create: isAdmin,
    // SECURITY (C1): identity-scoped, not just role-scoped. The previous
    // `isAdminOrVendor` let vendor A PATCH vendor B's record — rewriting
    // payout destination, slug (storefront URL), name, logo. Now a vendor
    // user can only update the row matching `user.vendor`.
    update: isAdminOrOwnVendor,
    delete: isAdmin,
  },
  hooks: {
    // I10 (M7) gate: don't let admin flip vendor.status to 'active' until
    // a User with role='vendor' linked to this vendor exists. The welcome
    // email + vendor dashboard access both depend on the user row. Without
    // this gate, admin approves a vendor → email silently no-ops → vendor
    // never receives credentials. After this, the admin must create the
    // user first (visible failure with a clear message) and only then can
    // flip status to active.
    beforeChange: [
      async ({ data, operation, originalDoc, req }) => {
        if (operation !== 'update') return data
        const transitioningToActive =
          originalDoc?.status !== 'active' && data?.status === 'active'
        if (!transitioningToActive) return data
        const vendorId = originalDoc?.id ?? data?.id
        if (!vendorId) return data
        const { docs } = await req.payload.find({
          collection: 'users',
          where: {
            and: [{ role: { equals: 'vendor' } }, { vendor: { equals: vendorId } }],
          },
          limit: 1,
          depth: 0,
          overrideAccess: true,
        })
        if (docs.length === 0) {
          throw new Error(
            `Refused: cannot activate vendor "${originalDoc?.name ?? vendorId}" — no linked User account exists. Create the user (Users → New) with role=vendor and link this vendor first.`,
          )
        }
        return data
      },
    ],
    afterChange: [
      vendorApprovalEmailHook,
      auditVendor,
      revalidateVendor,
      // K3 (round-5 M3 + privacy C2) — when a vendor transitions out of
      // `active`, suspend their selling ability. R8 business M4/M5 split
      // the two inactive states:
      //   banned  → PERMANENT. Cascade-archive published products
      //             (tombstone, one-way; admin re-publishes manually).
      //   paused  → REVERSIBLE. Do NOT mutate products. The storefront
      //             product queries (listProducts/getProductBySlug) now
      //             filter `vendor.status = active`, so a paused vendor's
      //             catalog disappears from /shop without touching the
      //             rows — un-pausing restores it instantly. The previous
      //             code archived on pause too, which destroyed the
      //             catalog for a state that reads as temporary.
      // Either way we revoke the linked users' sessions (suspension
      // applies immediately) and the read-time filter is defence in depth
      // for any cascade gap.
      async ({ doc, previousDoc, req, operation }) => {
        if (operation !== 'update') return doc
        const wasActive = previousDoc?.status === 'active'
        const isInactive = doc?.status === 'banned' || doc?.status === 'paused'
        if (!wasActive || !isInactive) return doc

        // R7 round-7 security M3 — when a vendor is banned/paused, the
        // Users.afterChange session-revoke hook only fires on direct
        // user updates. The linked vendor-user rows are untouched here,
        // so their JWTs and `users_sessions` rows persist for up to
        // 24h. During that window the demoted vendor can still PATCH
        // their own Vendor row (bio/tagline/logo/etc — non-admin
        // fields), see their order list, and use any vendor REST/
        // GraphQL endpoint scoped to their vendor id. We must also
        // revoke the linked users' sessions + invalidate their auth
        // cache as part of the vendor status transition.
        //
        // Clean-room correctness — DEFER the session-revoke DELETE past
        // the response via Next.js `after()` (falling back to
        // setImmediate). The previous version ran raw `pool.query(DELETE
        // ...)` on a separate pooled connection WHILE this vendor-update
        // transaction was still open — the exact in-transaction pool
        // deadlock the Users.afterChange hook was rewritten to avoid.
        // The revoke is a side effect that needn't be atomic with the
        // status change, so we run it after commit.
        const vendorId = doc.id
        const vendorStatus = doc.status
        const revokeLinkedSessions = async () => {
          try {
            // M6 (Phase 2) — paginate so a vendor org with > 50 linked
            // staff accounts doesn't keep stale JWTs alive on the
            // silently-truncated tail. id cursor mirrors the sweeper /
            // expire-quotes pattern.
            const PAGE = 100
            const linkedUsers: Array<{ id: number | string; email?: string }> = []
            let lastUserId: number | string | null = null
            for (let p = 0; p < 50; p++) {
              const cursorClause: import('payload').Where[] =
                lastUserId != null ? [{ id: { greater_than: lastUserId } }] : []
              const { docs } = await req.payload.find({
                collection: 'users',
                where: {
                  and: [
                    { role: { equals: 'vendor' } },
                    { vendor: { equals: vendorId } },
                    ...cursorClause,
                  ],
                },
                sort: 'id',
                limit: PAGE,
                depth: 0,
                overrideAccess: true,
              })
              if (docs.length === 0) break
              for (const d of docs) {
                linkedUsers.push(d as { id: number | string; email?: string })
              }
              lastUserId = docs[docs.length - 1]!.id
              if (docs.length < PAGE) break
            }
            if (linkedUsers.length > 0) {
              const { revokeUserSessions } = await import('@/lib/user-sessions')
              for (const u of linkedUsers as Array<{ id: number | string; email?: string }>) {
                try {
                  await revokeUserSessions(req.payload, u.id)
                  const { invalidateUserAuthCache } = await import('@/lib/auth')
                  invalidateUserAuthCache(u.id)
                  req.payload.logger?.info?.(
                    `[vendor] revoked sessions for linked user ${u.email ?? u.id} (vendor ${vendorId} → ${vendorStatus})`,
                  )
                } catch (e) {
                  req.payload.logger?.error?.(
                    `[vendor] session revoke failed for user ${u.id}: ${(e as Error).message}`,
                  )
                }
              }
            }
          } catch (e) {
            req.payload.logger?.error?.(
              `[vendor] linked-user lookup failed for vendor ${vendorId}: ${(e as Error).message}`,
            )
          }
        }
        // M11 (Phase 2): see Users.ts equivalent — sync-await fix was
        // reverted because it deadlocked the connection pool under the
        // integration suite. Best-effort `setImmediate` retained until
        // a post-commit lifecycle / jobs-enqueue fix lands.
        try {
          const { after } = await import('next/server')
          after(revokeLinkedSessions)
        } catch {
          setImmediate(revokeLinkedSessions)
        }
        // R8 business M4 — only BANNED permanently archives the catalog.
        // Paused vendors are hidden via the read-time vendor-status
        // filter in listProducts/getProductBySlug, leaving their product
        // rows untouched so un-pausing restores them.
        if (doc?.status !== 'banned') return doc

        // M2 (round-6) — per-row try/catch. The previous bulk update was
        // all-or-nothing: a single product whose afterChange hook (e.g.
        // revalidate, vendor-payout snapshot) threw would abort the
        // cascade and leave the rest of the catalog visible. We now
        // iterate, archive one row at a time, and audit any failures so
        // ops can finish the cascade manually. With a banned-vendor flow
        // the worst case must be "all products archived"; a partial
        // success is far worse than the slightly slower path.
        let succeeded = 0
        let failed = 0
        const failures: Array<{ id: number | string; reason: string }> = []
        try {
          // M6 (Phase 2) — paginate so a vendor with >1000 published
          // products doesn't leave the truncated tail live after a ban.
          const PAGE = 200
          const docs: Array<{ id: number | string }> = []
          let lastProductId: number | string | null = null
          for (let p = 0; p < 50; p++) {
            const cursorClause: import('payload').Where[] =
              lastProductId != null ? [{ id: { greater_than: lastProductId } }] : []
            const page = await req.payload.find({
              collection: 'products',
              where: {
                and: [
                  { vendor: { equals: doc.id } },
                  { status: { equals: 'published' } },
                  ...cursorClause,
                ],
              },
              sort: 'id',
              limit: PAGE,
              depth: 0,
              overrideAccess: true,
            })
            if (page.docs.length === 0) break
            for (const d of page.docs) docs.push(d as { id: number | string })
            lastProductId = page.docs[page.docs.length - 1]!.id
            if (page.docs.length < PAGE) break
          }
          for (const p of docs) {
            try {
              await req.payload.update({
                collection: 'products',
                id: p.id,
                overrideAccess: true,
                data: { status: 'archived' },
              })
              succeeded += 1
            } catch (e) {
              failed += 1
              failures.push({ id: p.id, reason: (e as Error).message })
              req.payload.logger?.error?.(
                `[vendor] cascade-archive failed for product ${p.id} (vendor ${doc.id}): ${(e as Error).message}`,
              )
            }
          }
          req.payload.logger?.info?.(
            `[vendor] ${doc.name} → ${doc.status}: archived ${succeeded}/${succeeded + failed} published products.`,
          )
          if (failed > 0) {
            try {
              const { audit } = await import('@/lib/audit')
              await audit({
                payload: req.payload,
                req,
                kind: 'vendor.status_changed',
                subjectType: 'vendors',
                subjectId: String(doc.id),
                diff: {
                  before: { status: previousDoc?.status },
                  after: { status: doc.status },
                },
                notes: `Cascade-archive partial: ${failed} products failed to archive. Manual reconciliation required. Failures: ${JSON.stringify(failures.slice(0, 10))}`,
              })
            } catch {
              // audit never throws
            }
            try {
              const Sentry = await import('@sentry/nextjs').catch(() => null)
              Sentry?.captureMessage(
                `Vendor ${doc.id} cascade-archive partial: ${failed} products failed (vendor went ${previousDoc?.status} → ${doc.status})`,
                'error',
              )
            } catch {
              // Sentry not configured
            }
          }
        } catch (e) {
          req.payload.logger?.error?.(
            `[vendor] failed to enumerate products for cascade-archive (vendor ${doc.id}): ${(e as Error).message}`,
          )
        }
        return doc
      },
    ],
  },
  fields: [
    // Vendor display name. Admin-only writes so a vendor can't impersonate
    // another brand by renaming their own row (or rebranding mid-launch).
    {
      name: 'name',
      type: 'text',
      required: true,
      access: { update: isAdminFieldAccess },
    },
    // Slug is part of the public storefront URL; renaming breaks SEO and
    // anyone holding old links. Admin-only.
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      access: { update: isAdminFieldAccess },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      options: [
        { label: 'Pending review', value: 'pending' },
        { label: 'Active', value: 'active' },
        { label: 'Paused', value: 'paused' },
        { label: 'Banned', value: 'banned' },
      ],
      access: { update: ({ req: { user } }) => user?.role === 'admin' },
    },
    {
      name: 'tagline',
      type: 'text',
      admin: { description: 'Short one-line description shown on storefront card.' },
    },
    { name: 'bio', type: 'textarea' },
    {
      name: 'logo',
      type: 'upload',
      relationTo: 'media',
    },
    { name: 'country', type: 'text', defaultValue: 'NA' },
    { name: 'city', type: 'text' },
    {
      name: 'commissionRate',
      type: 'number',
      defaultValue: 10,
      min: 0,
      max: 100,
      admin: {
        description: 'Platform commission % on this vendor\'s sales. Admin-only.',
      },
      access: { update: ({ req: { user } }) => user?.role === 'admin' },
    },
    {
      name: 'payout',
      type: 'group',
      label: 'Payout details (encrypted at rest)',
      fields: [
        {
          name: 'method',
          type: 'select',
          options: [
            { label: 'Bank transfer', value: 'bank' },
            { label: 'Stripe Connect', value: 'stripe_connect' },
            { label: 'Flutterwave sub-account', value: 'flutterwave_sub' },
          ],
        },
        { name: 'bankName', type: 'text' },
        { name: 'accountHolder', type: 'text' },
        { name: 'accountNumber', type: 'text' },
        { name: 'swiftBic', type: 'text' },
        { name: 'stripeConnectAccountId', type: 'text' },
        { name: 'flutterwaveSubAccountId', type: 'text' },
      ],
      // SECURITY (C1 defense-in-depth): even if the collection-level scoping
      // regresses, payout fields are admin-only on both read AND write.
      // Vendors update payout out-of-band (email, signed form) and admin
      // enters it. This prevents a session-hijacked vendor account from
      // redirecting payouts to an attacker bank account in one PATCH.
      access: {
        read: isAdminFieldAccess,
        update: isAdminFieldAccess,
      },
    },
  ],
  timestamps: true,
}
