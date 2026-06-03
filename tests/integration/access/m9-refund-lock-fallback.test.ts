/**
 * M9 regression — when the refund-cap advisory lock can't run on the
 * transaction's drizzle session (no req.transactionID), the fallback
 * must take a real pool-level pg_advisory_lock rather than the previous
 * warn-only no-op. Static-source check.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('M9 — refund-cap lock has a pool-level fallback', () => {
  it('the Refunds.beforeChange fallback path takes pg_advisory_lock on a pool client', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/payload/collections/Refunds.ts'),
      'utf8',
    )
    // Verify the pool-fallback block exists and uses pg_advisory_lock
    // (session-scoped, with explicit unlock — distinct from the in-tx
    // pg_advisory_xact_lock path on the happy branch).
    expect(src).toMatch(/pool\.connect\(\)/)
    expect(src).toMatch(/pg_advisory_lock\(hashtext/)
    expect(src).toMatch(/pg_advisory_unlock\(hashtext/)
  })
})
