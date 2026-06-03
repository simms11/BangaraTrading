/**
 * M7 regression — `checkActionRateLimit({ strict: true })` must call
 * consumeStrict (fail-closed) rather than consume (fail-open).
 */
import { describe, it, expect, vi } from 'vitest'

const consumeMock = vi.fn()
const consumeStrictMock = vi.fn()

vi.mock('@/lib/rate-limit', () => ({
  consume: (...args: unknown[]) => consumeMock(...args),
  consumeStrict: (...args: unknown[]) => consumeStrictMock(...args),
}))
vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (h: string) =>
      h === 'x-forwarded-for' ? '1.2.3.4' : h === 'x-real-ip' ? '1.2.3.4' : null,
  }),
}))

describe('M7 — checkActionRateLimit honours `strict`', () => {
  it('uses consumeStrict when strict: true', async () => {
    consumeMock.mockResolvedValue({ ok: true })
    consumeStrictMock.mockResolvedValue({ ok: true })
    const { checkActionRateLimit } = await import('@/lib/action-rate-limit')
    await checkActionRateLimit('test-bucket', {
      limit: 5,
      windowMs: 60_000,
      strict: true,
    })
    expect(consumeStrictMock).toHaveBeenCalledOnce()
    expect(consumeMock).not.toHaveBeenCalled()
  })

  it('uses consume (fail-open) when strict is omitted', async () => {
    consumeMock.mockReset().mockResolvedValue({ ok: true })
    consumeStrictMock.mockReset().mockResolvedValue({ ok: true })
    const { checkActionRateLimit } = await import('@/lib/action-rate-limit')
    await checkActionRateLimit('test-bucket-2', { limit: 5, windowMs: 60_000 })
    expect(consumeMock).toHaveBeenCalledOnce()
    expect(consumeStrictMock).not.toHaveBeenCalled()
  })
})
