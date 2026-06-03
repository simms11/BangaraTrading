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
): Promise<{ revoked: number } | { error: 'no_pool' }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pool = (payload.db as any).pool as
    | { query: (text: string, params?: unknown[]) => Promise<{ rowCount: number | null }> }
    | undefined
  if (!pool) return { error: 'no_pool' }
  const r = await pool.query(`DELETE FROM users_sessions WHERE _parent_id = $1`, [userId])
  return { revoked: r.rowCount ?? 0 }
}
