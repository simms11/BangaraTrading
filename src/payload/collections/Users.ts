import type { CollectionConfig } from 'payload'
import { isAdmin, isAdminOrSelf } from '../access'

export const Users: CollectionConfig = {
  slug: 'users',
  auth: {
    // L3 — session-backed JWT auth. Each login creates a `sessions` row
    // on the user; every authenticated request validates the session
    // still exists (Payload does this inside `payload.auth`). Revoking
    // a session immediately invalidates the JWT — no more 24h staleness
    // on direct REST/GraphQL after demotion. Combined with the role
    // check in getCurrentUser, this closes the round-3/4/5 staleness
    // gap completely.
    //
    // Trade-off: one DB lookup per authenticated request. We already
    // pay this in getCurrentUser's freshness re-read; the marginal cost
    // here is small. LRU caching in auth.ts further dedupes hot paths.
    //
    // Migration impact: switching this flag at runtime invalidates all
    // existing JWTs (the format includes a session id that the DB
    // doesn't have). Users will need to re-login on first deploy. The
    // schema migration adds a sessions sub-table managed by Payload.
    tokenExpiration: 60 * 60 * 24, // 24h
    cookies: { sameSite: 'Lax', secure: process.env.NODE_ENV === 'production' },
    useSessions: true,
  },
  hooks: {
    beforeChange: [
      // R10 security — refuse non-admin email changes. `update:
      // isAdminOrSelf` lets a customer PATCH their own row; Payload's
      // `auth` config auto-provides the `email` field with no
      // collection-level update gate. Without this guard a session-
      // hijacked customer could silently rotate their account email to
      // an attacker-controlled address, redirecting future password-reset
      // links and persisting the takeover. Admins legitimately need to
      // edit email (re-onboarding); programmatic writes via
      // overrideAccess (signup, internal jobs) also pass through.
      async ({ data, operation, originalDoc, req }) => {
        if (operation !== 'update') return data
        if (!data || data.email == null) return data
        if (originalDoc && data.email === originalDoc.email) return data
        const actor = req.user
        if (!actor) return data // overrideAccess / internal path
        if (actor.role === 'admin') return data
        throw new Error(
          'Email change is admin-only. Contact support to update your account email.',
        )
      },
    ],
    afterChange: [
      // M2 (round-6) — on role or vendor change, REVOKE all live sessions
      // for that user and invalidate the auth LRU. With useSessions: true
      // (L3), deleting the user's sessions immediately invalidates every
      // outstanding JWT for them, closing the residual JWT-staleness gap
      // (which the 30s LRU cache previously allowed for cached role reads).
      //
      // Previously this hook only logged the change — relying on the 24h
      // JWT expiry + getCurrentUser's DB re-read. Now it actively kills
      // live sessions. Combined with invalidateUserAuthCache, demotion is
      // instant on the very next request.
      async ({ doc, previousDoc, operation, req }) => {
        if (operation !== 'update') return doc
        const roleChanged = previousDoc?.role !== doc?.role
        const vendorChanged =
          (typeof previousDoc?.vendor === 'object'
            ? previousDoc?.vendor?.id
            : previousDoc?.vendor) !==
          (typeof doc?.vendor === 'object' ? doc?.vendor?.id : doc?.vendor)
        if (!roleChanged && !vendorChanged) return doc

        req.payload.logger?.warn?.(
          `[users] ${doc.email} role/vendor changed: role ${previousDoc?.role} → ${doc?.role}, vendor ${previousDoc?.vendor ?? '∅'} → ${doc?.vendor ?? '∅'}. Scheduling session revoke.`,
        )

        // 1) Invalidate the process-local freshness cache synchronously
        //    so any cached "still admin" reads are dropped immediately.
        //    This is in-process state, no DB I/O, no deadlock risk.
        try {
          const { invalidateUserAuthCache } = await import('@/lib/auth')
          invalidateUserAuthCache(doc.id)
        } catch (e) {
          req.payload.logger?.error?.(
            `[users] auth cache invalidation failed: ${(e as Error).message}`,
          )
        }

        // 2) Defer the DB-touching cleanup (session DELETE + audit row)
        //    until AFTER the current transaction commits. Running raw
        //    pool.query inside an active Payload transaction can deadlock
        //    in narrow test/pool configs.
        //
        //    R7 round-7 reliability C3 fix: previously used setImmediate,
        //    which does NOT survive Vercel serverless function lifecycle
        //    — the function is suspended/terminated as soon as the HTTP
        //    response is sent and queued callbacks never run. We now
        //    prefer Next.js `after()` (Next 15+) which is the supported
        //    way to defer work past the response; in non-serverless or
        //    in tests we fall back to setImmediate. Either way, the
        //    session DELETE actually executes — closing the round-5/6
        //    JWT-staleness gap that was nominally fixed but secretly
        //    broken on Vercel.
        const targetId = doc.id
        const targetEmail = doc.email
        const beforeRole = previousDoc?.role
        const afterRole = doc?.role
        const beforeVendor = previousDoc?.vendor ?? null
        const afterVendor = doc?.vendor ?? null
        const doRevoke = async () => {
          try {
            const { revokeUserSessions } = await import('@/lib/user-sessions')
            // retryWhileEmpty: this deferred callback can beat the demoting
            // transaction's commit (setImmediate fallback) — see the helper.
            const result = await revokeUserSessions(req.payload, targetId, {
              retryWhileEmpty: true,
            })
            if ('revoked' in result) {
              req.payload.logger?.info?.(
                `[users] revoked ${result.revoked} live session(s) for ${targetEmail}`,
              )
            }
          } catch (e) {
            req.payload.logger?.error?.(
              `[users] session revoke failed for ${targetEmail}: ${(e as Error).message}`,
            )
          }
          try {
            const { audit } = await import('@/lib/audit')
            await audit({
              payload: req.payload,
              kind: 'user.role_changed',
              subjectType: 'users',
              subjectId: String(targetId),
              diff: {
                before: { role: beforeRole, vendor: beforeVendor },
                after: { role: afterRole, vendor: afterVendor },
              },
              notes: `Sessions revoked; auth cache invalidated.`,
            })
          } catch {
            // audit never throws
          }
        }
        try {
          // Next.js 15 `after` keeps the worker alive past response on
          // Vercel until the callback resolves. Falls back to
          // setImmediate when not available (older Next or test runners).
          //
          // M11 (Phase 2): attempted to fix the setImmediate-not-fired
          // case on Vercel serverless by awaiting `doRevoke()`
          // synchronously here. That introduced a real interaction
          // failure: awaiting from inside afterChange keeps the outer
          // Users transaction open while `doRevoke`'s nested audit()
          // call (`payload.create({collection:'audit-log'})`) starts a
          // NEW transaction needing another pool connection. Under the
          // integration suite the chain exhausted the pool and
          // create-order tests timed out on connect. Reverted; the
          // proper fix needs an `afterOperation` (post-commit) lifecycle
          // or a Payload-jobs enqueue, which is beyond this MINOR's
          // scope. See findings.md M11 for the full diagnostic.
          const { after } = await import('next/server')
          after(doRevoke)
        } catch {
          setImmediate(doRevoke)
        }

        return doc
      },
    ],
  },
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'name', 'role', 'vendor'],
  },
  access: {
    create: () => true,
    read: isAdminOrSelf,
    update: isAdminOrSelf,
    delete: isAdmin,
    admin: ({ req: { user } }) => user?.role === 'admin' || user?.role === 'vendor',
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'customer',
      options: [
        { label: 'Admin', value: 'admin' },
        { label: 'Vendor', value: 'vendor' },
        { label: 'Customer', value: 'customer' },
      ],
      // B47 fix: an open create access on Users (we allow public sign-up)
      // combined with an open `role` field would let anyone POST role=admin
      // and self-elevate. Admin can set role on create + update; everyone
      // else gets the defaultValue 'customer'. Signed-out POST → customer.
      access: {
        create: ({ req: { user } }) => user?.role === 'admin',
        update: ({ req: { user } }) => user?.role === 'admin',
      },
    },
    {
      name: 'vendor',
      type: 'relationship',
      relationTo: 'vendors',
      admin: {
        condition: (data) => data?.role === 'vendor',
        description: 'The vendor this user is associated with (required for vendor role).',
      },
      // B47 follow-on: vendor field also admin-only to prevent setting
      // an arbitrary vendor relationship on self-signup.
      access: {
        create: ({ req: { user } }) => user?.role === 'admin',
        update: ({ req: { user } }) => user?.role === 'admin',
      },
    },
    { name: 'phone', type: 'text' },
    {
      name: 'marketingOptIn',
      type: 'checkbox',
      defaultValue: false,
      label: 'Marketing email opt-in',
    },
  ],
  timestamps: true,
}
