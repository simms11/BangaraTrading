/**
 * M6 regression — Vendors.afterChange must paginate the linked-users
 * lookup so >50 vendor staff accounts ALL lose their sessions on ban,
 * not just the first 50 (silent truncation under the old `limit: 50`).
 */
import { describe, it, expect } from 'vitest'
import { getPayload } from '@/lib/payload'
import { createVendor } from '../helpers/fixtures'

describe('M6 — Vendors paginate the linked-users session revoke', () => {
  it('revokes sessions for ALL linked users when the count exceeds the old 50-row cap', async () => {
    const payload = await getPayload()
    const vendor = await createVendor({ slug: `m6-${Date.now()}` })
    const COUNT = 55 // > the old hard limit of 50
    const users: Array<{ id: number | string }> = []
    for (let i = 0; i < COUNT; i++) {
      const u = (await payload.create({
        collection: 'users',
        overrideAccess: true,
        data: {
          name: `M6 ${i}`,
          email: `m6-${i}-${Date.now()}@test.local`,
          password: 'integration-test-password',
          role: 'vendor',
          vendor: vendor.id,
        },
      })) as { id: number | string }
      users.push(u)
    }

    // Insert a live session row for each user so we can observe the
    // delete cascade.
    const pool = (payload.db as unknown as {
      pool: { query: (text: string, params?: unknown[]) => Promise<{ rowCount: number }> }
    }).pool
    for (const u of users) {
      await pool.query(
        `INSERT INTO users_sessions (_order, _parent_id, id, created_at, expires_at)
         VALUES (1, $1, $2, NOW(), NOW() + INTERVAL '24 hours')`,
        [u.id, `sess_m6_${u.id}_${Date.now()}`],
      )
    }

    // Ban the vendor. The deferred revoke is queued via after()/setImmediate.
    await payload.update({
      collection: 'vendors',
      id: vendor.id,
      overrideAccess: true,
      data: { status: 'banned' },
    })

    // Poll for completion (deferred work runs after the response).
    const userIds = users.map((u) => u.id)
    let remaining = users.length
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 50))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const probe = (await pool.query(
        `SELECT COUNT(*)::int AS c FROM users_sessions WHERE _parent_id = ANY($1::int[])`,
        [userIds],
      )) as unknown as { rows: Array<{ c: number }> }
      remaining = probe.rows[0]?.c ?? remaining
      if (remaining === 0) break
    }
    expect(remaining).toBe(0)
  }, 30_000)
})
