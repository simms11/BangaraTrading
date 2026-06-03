/**
 * m20 — `revokeUserSessions` helper exists in src/lib/user-sessions.ts
 * and the 4 raw-DELETE sites use it instead of repeating the SQL.
 *
 * Behavioural test on the helper: create a user, insert a session row
 * via the raw pool, call `revokeUserSessions`, verify the row is gone
 * and the return shape carries `revoked: 1`.
 *
 * Static-source assertions for the 4 sites confirm the duplicated raw
 * SQL has been replaced.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getPayload } from '@/lib/payload'
import { revokeUserSessions } from '@/lib/user-sessions'

describe('m20 — revokeUserSessions helper', () => {
  it('deletes the session row and reports rowCount', async () => {
    const payload = await getPayload()
    const u = (await payload.create({
      collection: 'users',
      overrideAccess: true,
      data: {
        email: `m20-${Date.now()}@test.local`,
        password: 'TestPassword123!',
        role: 'customer',
        name: 'm20 user',
      },
    })) as { id: number | string }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pool = (payload.db as any).pool as {
      query: (text: string, params?: unknown[]) => Promise<{ rowCount: number | null }>
    }
    // Insert a session row directly so we have something to revoke. We
    // mirror the schema (id, _order, _parent_id, expires_at, created_at,
    // updated_at). Payload's session rows usually carry an _order index;
    // any positive integer is fine for the test.
    await pool.query(
      `INSERT INTO users_sessions (id, _order, _parent_id, expires_at, created_at)
       VALUES ($1, 1, $2, NOW() + INTERVAL '24 hours', NOW())`,
      [`m20-${Date.now()}-sess`, u.id],
    )

    const before = await pool.query(
      `SELECT COUNT(*)::int AS c FROM users_sessions WHERE _parent_id = $1`,
      [u.id],
    )
    expect((before as unknown as { rows: Array<{ c: number }> }).rows[0].c).toBe(1)

    const result = await revokeUserSessions(payload, u.id)
    expect('revoked' in result && result.revoked === 1).toBe(true)

    const after = await pool.query(
      `SELECT COUNT(*)::int AS c FROM users_sessions WHERE _parent_id = $1`,
      [u.id],
    )
    expect((after as unknown as { rows: Array<{ c: number }> }).rows[0].c).toBe(0)
  })

  it('all 4 call sites use the helper instead of raw DELETE SQL', () => {
    const sites = [
      'src/payload/collections/Users.ts',
      'src/payload/collections/Vendors.ts',
      'src/lib/auth-actions.ts',
    ]
    for (const f of sites) {
      const src = readFileSync(resolve(process.cwd(), f), 'utf8')
      // The bare `DELETE FROM users_sessions WHERE _parent_id` SQL must
      // be gone from these files. Any remaining occurrences are
      // immediate regressions.
      const rawHits = src.match(/DELETE FROM users_sessions WHERE _parent_id/g) ?? []
      expect(rawHits.length, `${f} still uses the raw SQL`).toBe(0)
      // And the file references the helper at least once.
      expect(src, `${f} does not import or call revokeUserSessions`).toMatch(
        /revokeUserSessions/,
      )
    }
  })
})
