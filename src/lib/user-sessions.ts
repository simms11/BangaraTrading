import 'server-only'
import type { Payload } from 'payload'

/**
 * m20 (Phase 2) — shared helper for revoking persisted user sessions.
 *
 * `useSessions: true` on the Users collection means the cookie+JWT is
 * only half the auth: a `users_sessions` row persists until natural
 * expiry, and a captured JWT (XSS, shared device, network capture) lets
 * an attacker keep using a session even after the user signs out or is
 * demoted. The right invalidation is to delete the session rows so the
 * next `payload.auth({ headers })` call returns null.
 *
 * Four sites previously re-implemented this with the same raw SQL:
 *   - Users.afterChange (role/vendor demotion → revoke own)
 *   - Vendors.afterChange (vendor banned → revoke all linked users)
 *   - auth-actions.signOutAction (sign-out → revoke own)
 *   - auth-actions.adminForceLogoutEverywhereAction (admin tool)
 *
 * Each was parameterised today, but four duplicates of a `DELETE FROM`
 * with raw-pool access is a maintenance and future-injection surface.
 * This helper centralises the SQL and the pool-shape interrogation.
 */
export async function revokeUserSessions(
  payload: Payload,
  userId: number | string,
  opts?: { retryWhileEmpty?: boolean },
): Promise<{ revoked: number } | { error: 'no_pool' }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pool = (payload.db as any).pool as
    | { query: (text: string, params?: unknown[]) => Promise<{ rowCount: number | null }> }
    | undefined
  if (!pool) return { error: 'no_pool' }
  // retryWhileEmpty — for the DEFERRED callers (Users/Vendors afterChange).
  // Their setImmediate fallback can fire before the demoting transaction
  // commits, and Payload's update rewrites the users_sessions array rows
  // in-transaction: a DELETE racing the commit matches zero rows while the
  // re-inserted copies survive (observed as a CI-only flake in round6 M2).
  // Re-running the DELETE a few times covers the post-commit rows. Callers
  // on the request path (sign-out) omit it: a user with no session rows is
  // normal there and shouldn't pay 150ms of retries.
  const attempts = opts?.retryWhileEmpty ? 4 : 1
  let revoked = 0
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 50))
    const r = await pool.query(`DELETE FROM users_sessions WHERE _parent_id = $1`, [userId])
    revoked = r.rowCount ?? 0
    if (revoked > 0) break
  }
  return { revoked }
}
