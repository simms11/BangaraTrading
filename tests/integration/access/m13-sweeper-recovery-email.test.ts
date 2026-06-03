/**
 * M13 regression — sweeper recovery branch must send the confirmation
 * email and claim a synthetic event id so a delayed real Stripe webhook
 * becomes idempotent.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('M13 — sweeper recovery sends confirmation + claims synthetic event', () => {
  const src = readFileSync(
    resolve(process.cwd(), 'src/payload/jobs/sweepAbandonedOrders.ts'),
    'utf8',
  )

  it('calls sendOrderConfirmation in the complete-session recovery branch', () => {
    expect(src).toMatch(/sendOrderConfirmation\(/)
  })

  it('claims a synthetic event id keyed to the session id', () => {
    expect(src).toMatch(/sweeper:\$\{session\.id\}/)
    expect(src).toMatch(/claimEvent\(\{/)
  })
})
