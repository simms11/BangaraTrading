/**
 * m17 — Flutterwave env vars must be on the prod hard-fail list.
 *
 * Reason this is highest-priority in the Phase 2 cleanup batch: a prod
 * deploy missing FLUTTERWAVE_SECRET_KEY / FLUTTERWAVE_WEBHOOK_SECRET
 * results in payments silently half-dead — Bangarah's primary market
 * (African card processors) loses checkout with no boot-time signal,
 * while Stripe paths look fine. Already documented for Stripe with the
 * R7 round-7 M4 fix; symmetry was forgotten for Flutterwave.
 *
 * Static-source assertion is the right shape: the guard runs once at
 * module import in prod NODE_ENV, and triggering it inside a test
 * subprocess would cross-contaminate other tests' Payload boot. The
 * fail-before/pass-after contract is satisfied because the file
 * literally did not name either var before this fix.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('m17 — Flutterwave keys in prod env-fail-fast list', () => {
  it('payload.config.ts checks both FLUTTERWAVE_SECRET_KEY and FLUTTERWAVE_WEBHOOK_SECRET in the prod block', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/payload.config.ts'),
      'utf8',
    )
    // Find the prod guard block (already exists for the Stripe pair).
    const prodBlockMatch = src.match(
      /if \(process\.env\.NODE_ENV === 'production'\) \{[\s\S]*?\n\}/m,
    )
    expect(prodBlockMatch, 'prod env guard block must exist').toBeTruthy()
    const block = prodBlockMatch![0]
    expect(block).toMatch(/FLUTTERWAVE_SECRET_KEY/)
    expect(block).toMatch(/FLUTTERWAVE_WEBHOOK_SECRET/)
  })
})
