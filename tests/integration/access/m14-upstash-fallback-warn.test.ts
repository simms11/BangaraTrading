/**
 * m14 — `consume()` silently falls back from Upstash to in-memory when
 * the Upstash call returns null (network error, malformed response).
 * No Sentry signal is emitted, so a real Upstash incident weakens rate
 * limits with no operator visibility.
 *
 * Fix: when the fallback runs, Sentry.captureMessage with a throttle
 * (at most once per 60s) so an outage shows up exactly once per
 * minute regardless of request volume.
 *
 * Test shape: mock @sentry/nextjs's captureMessage, force the fallback
 * path by clearing the Upstash env vars, call `consume()` twice in
 * quick succession, assert exactly ONE captureMessage. Reset the
 * tracker and call again, assert another captureMessage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const captureMessageMock = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
}))

describe('m14 — Sentry warn on Upstash → memory fallback (throttled)', () => {
  beforeEach(async () => {
    captureMessageMock.mockClear()
    // Point at an unreachable Upstash so `consumeUpstash` returns null
    // (the network call throws and the catch logs + returns null).
    // `upstashEnabled()` still returns true so the m14 warn fires.
    process.env.UPSTASH_REDIS_REST_URL = 'http://127.0.0.1:1' // closed port
    process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token'
    const { __resetUpstashFallbackWarn } = await import('@/lib/rate-limit')
    __resetUpstashFallbackWarn()
  })

  it('fires once per 60s when consume falls back to memory', async () => {
    const { consume } = await import('@/lib/rate-limit')
    await consume('m14:test', 10, 60_000)
    await consume('m14:test', 10, 60_000)
    await consume('m14:test', 10, 60_000)
    // Throttled — exactly one Sentry call across three consume-calls.
    expect(captureMessageMock).toHaveBeenCalledTimes(1)
    expect(captureMessageMock.mock.calls[0][0]).toMatch(/upstash.*fallback/i)
  })
})
