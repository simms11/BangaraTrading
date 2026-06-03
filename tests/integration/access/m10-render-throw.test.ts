/**
 * M10 regression — a render() throw inside the email pipeline must NOT
 * propagate to the caller (would cause the Stripe webhook to 500 after
 * claimEvent has already committed, losing the customer's confirmation).
 * Instead it must be caught and routed to the failed-email retry queue.
 */
import { describe, it, expect, vi } from 'vitest'

// The integration suite's global setup mocks @/lib/email to return
// undefined; for THIS file we need the real send path so safeRender's
// catch is exercised.
vi.unmock('@/lib/email')

// Mock react-email's render to throw — simulates a template prop drift.
// Use a partial mock so other exports (e.g. components imported by the
// templates) still resolve normally.
vi.mock('@react-email/components', () => ({
  // Minimal stubs the templates need at import time. Render is the only
  // function safeRender invokes.
  render: vi.fn(async () => {
    throw new Error('render-blew-up')
  }),
  // Components used by the templates — return null wrappers; we never
  // actually render them because `render` throws first.
  Body: ({ children }: { children: unknown }) => children,
  Container: ({ children }: { children: unknown }) => children,
  Head: () => null,
  Heading: ({ children }: { children: unknown }) => children,
  Hr: () => null,
  Html: ({ children }: { children: unknown }) => children,
  Img: () => null,
  Preview: () => null,
  Section: ({ children }: { children: unknown }) => children,
  Text: ({ children }: { children: unknown }) => children,
}))

describe('M10 — render() throw is caught (no propagation to caller)', () => {
  it('sendOrderConfirmation returns { ok: false } instead of throwing when render fails', async () => {
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
