/**
 * M10 regression — a render() throw inside the email pipeline must NOT
 * propagate to the caller (would cause the Stripe webhook to 500 after
 * claimEvent has already committed, losing the customer's confirmation).
 * Instead it must be caught and routed to the failed-email retry queue.
 */
import { describe, it, expect, vi, afterAll } from 'vitest'

// The integration suite's global setup mocks @/lib/email to return
// undefined; for THIS file we need the real send path so safeRender's
// catch is exercised.
vi.unmock('@/lib/email')

// Mock react-email's render to throw — simulates a template prop drift.
// NOTE: @/lib/email imports `render` from '@react-email/render' (NOT from
// '@react-email/components', which merely re-exports it) — mock the module
// the production code actually resolves, or the real render runs and the
// failure path is never exercised. The templates' component imports stay
// real; the mocked render throws before any of them would be evaluated.
vi.mock('@react-email/render', () => ({
  render: vi.fn(async () => {
    throw new Error('render-blew-up')
  }),
}))

// This file evaluates @/lib/email against a render mock that THROWS; with
// isolate: false that tainted copy stays in the shared module cache and
// would leak into later files that unmock @/lib/email (m13). Drop it.
afterAll(() => {
  vi.resetModules()
})

describe('M10 — render() throw is caught (no propagation to caller)', () => {
  it('sendOrderConfirmation returns { ok: false } instead of throwing when render fails', async () => {
    // The suite runs with isolate: false (one shared module cache across
    // files), so by the time this file runs, '@react-email/render' may
    // already be cached un-mocked by an earlier file. Clear the cache so
    // the import below re-evaluates @/lib/email against THIS file's mock.
    // (Mock registrations survive resetModules; only the cache is cleared.)
    vi.resetModules()
    const { sendOrderConfirmation } = await import('@/lib/email')
    let threw = false
    let result: { ok?: boolean } = {}
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result = (await sendOrderConfirmation({
        to: 'm10@test.local',
        props: {
          orderNumber: 'BGR-M10',
          totalFormatted: '$0.00',
          currency: 'NAD',
          items: [],
          siteUrl: 'http://localhost:3000',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      })) as { ok?: boolean }
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
    expect(result.ok).toBe(false)
  })
})
