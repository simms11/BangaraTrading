import 'server-only'
import { headers } from 'next/headers'
import { cache } from 'react'
import { getPayload, safe } from '@/lib/payload'

export type CurrentUser = {
  id: number | string
  email: string
  name?: string | null
  role: 'admin' | 'vendor' | 'customer'
  /** Linked vendor for role=vendor — either the id directly or a populated doc */
  vendor?: number | string | { id: number | string } | null
} | null

/**
 * I8 (M11): short-lived process-local cache of the freshness re-read so
 * we don't pay 2 extra SELECTs per authenticated request on every hot
 * page. TTL is 30s — short enough that admin demotion takes effect
 * "within half a minute" (operators expect that), long enough to absorb
 * a burst of RSC components in the same render cycle. React's `cache()`
 * de-dupes inside one render; this Map de-dupes across renders/requests
 * served by the same Node process.
 *
 * NOT a security boundary — it's a perf cap. A user with a 30s-stale
 * cache entry still has their JWT claims subject to the 24h expiry, so
 * the worst case is "demotion takes 30s instead of being instant" —
 * still vastly tighter than the 7-day window the C3 fix originally
 * closed. Caller paths that need *real-time* role checks (e.g. the
 * Stripe webhook re-running access decisions) don't go through
 * `getCurrentUser` anyway.
 */
// R7 round-7 reliability M1 + concurrency M2 — the cache is per-Node-
// process and the previous 30s TTL meant a demoted admin retained
// their role on N-1 of N Vercel instances for up to 30s after the
// invalidation hook ran on instance #1. Tightened to 5s so the
// cross-instance drift window is small enough that "demotion is near-
// instant" is honest. The remaining drift can only be closed by moving
// to a shared cache (Upstash) — tracked as a follow-up; the 5s window
// is acceptable for production today.
const FRESHNESS_TTL_MS = 5_000
type Cached = { at: number; role: 'admin' | 'vendor' | 'customer'; vendor: number | string | null }
const freshCache = new Map<string, Cached>()
function cacheKey(userId: number | string): string {
  return String(userId)
}

/**
 * M2 (round-6) — invalidate the freshness cache for a single user.
 * Called from Users.afterChange when role/vendor changes so the next
 * authenticated request for that user re-reads the DB immediately
 * instead of waiting up to 30s for the TTL to expire. Pair with
 * `payload.update({ collection: 'users', data: { sessions: [] } })`
 * to invalidate live JWTs and you get an instant cutoff.
 */
export function invalidateUserAuthCache(userId: number | string): void {
  freshCache.delete(cacheKey(userId))
}

export const getCurrentUser = cache(async (): Promise<CurrentUser> => {
  const result = await safe(async () => {
    const payload = await getPayload()
    // Next.js 15 headers() already includes the request's Cookie header.
    // Payload's auth resolver reads the JWT directly off the headers it's given.
    const h = await headers()
    const auth = await payload.auth({ headers: h })
    if (!auth?.user) return null

    // H3 fix (C3): the previous `typeof vendor === 'object'` guard was
    // DEAD CODE — Payload's default `auth.depth` is 0, so `auth.user.vendor`
    // is always the bare id. Banned vendors continued to operate.
    //
    // The role itself is also read from the *signed JWT claim*, not the
    // database, because `useSessions: false`. A demoted admin would keep
    // their old role for up to 7 days. We re-fetch the freshest user row
    // on every request to source role + vendor state from the DB.
    //
    // Cost: one extra SELECT per authenticated request. React's `cache`
    // de-dupes within a single RSC render. If load profile demands it,
    // graduate to a 30s in-memory TTL keyed by user id.
    let role = auth.user.role
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tokenVendor = (auth.user as any).vendor
    let vendor: number | string | { id: number | string } | null =
      tokenVendor && typeof tokenVendor === 'object'
        ? (tokenVendor as { id: number | string })
        : tokenVendor ?? null

    // I8 (M11): check the process-local TTL cache before issuing the DB
    // reads. Hot pages with many authenticated RSC components now do at
    // most 2 SELECTs every 30s instead of 2 per render.
    const key = cacheKey(auth.user.id)
    const hit = freshCache.get(key)
    if (hit && Date.now() - hit.at < FRESHNESS_TTL_MS) {
      // R7 round-7 reliability M1 — true LRU. Delete-then-set bumps the
      // entry to the back of the Map's insertion-order list, so when
      // eviction triggers we drop entries that haven't been READ
      // recently, not entries that haven't been WRITTEN recently. The
      // previous comment claimed LRU but the implementation was FIFO.
      freshCache.delete(key)
      freshCache.set(key, hit)
      role = hit.role
      vendor = hit.vendor
      return {
        id: auth.user.id,
        email: auth.user.email,
        name: auth.user.name,
        role,
        vendor,
      } as CurrentUser
    }

    try {
      const fresh = (await payload.findByID({
        collection: 'users',
        id: auth.user.id,
        depth: 0,
        overrideAccess: true,
      })) as { role?: 'admin' | 'vendor' | 'customer'; vendor?: number | string | null }
      // Trust the DB over the JWT for both role and vendor.
      if (fresh.role) role = fresh.role
      // I6 (M3): always overwrite from DB, even when null. The previous
      // `!= null` guard meant an admin who unlinked a user's vendor
      // relationship would have no effect — the JWT-derived vendor id
      // would be kept until token expiry. Drop the guard so unlink takes
      // effect immediately.
      vendor = fresh.vendor ?? null
      // If the live row says role=vendor, fetch the vendor's status to
      // demote banned/paused vendors (and vendor users with no link) to
      // customer. After the DB overwrite vendor is always a primitive id
      // or null (fresh is depth 0), so the object-id branch isn't needed.
      if (role === 'vendor') {
        if (vendor == null) {
          // role=vendor but link removed — treat as customer until admin re-links.
          role = 'customer'
        } else {
          const vid = vendor
          const v = (await payload.findByID({
            collection: 'vendors',
            id: vid,
            depth: 0,
            overrideAccess: true,
          })) as { status?: string } | null
          if (!v || (v.status && v.status !== 'active')) {
            role = 'customer'
          }
        }
      }
      // Cache the result. We store the *final* role (post-demote) and
      // vendor so a subsequent hit doesn't have to re-evaluate. After the
      // DB overwrite at line 58 vendor is `number | string | null`.
      const v = vendor as number | string | { id: number | string } | null
      const cacheVendor: number | string | null =
        v && typeof v === 'object' ? v.id : (v as number | string | null)
      freshCache.set(key, {
        at: Date.now(),
        role,
        vendor: cacheVendor,
      })
      // Bound the map size to avoid unbounded growth on a long-running
      // node process with high distinct-user churn.
      if (freshCache.size > 5000) {
        // Drop the oldest 1000 entries. Map preserves insertion order.
        let i = 0
        for (const k of freshCache.keys()) {
          if (i++ >= 1000) break
          freshCache.delete(k)
        }
      }
    } catch (e) {
      // Fresh-read failed (deleted user, DB hiccup) — fall back to JWT
      // claims so a transient outage doesn't log everyone out. Log so
      // ops can distinguish "expected anon" from "DB broken".
      console.warn(
        `[auth] getCurrentUser fresh-read failed for user ${auth.user.id}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      )
    }

    return {
      id: auth.user.id,
      email: auth.user.email,
      name: auth.user.name,
      role,
      vendor,
    } as CurrentUser
  })
  return result.ok ? result.data : null
})
