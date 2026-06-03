/**
 * m13 regression — when the 8s email deadline fires, the in-flight HTTP
 * request to Resend must be ABORTED, not just abandoned by the
 * Promise.race. Pre-m13, the race rejected but the underlying fetch kept
 * holding an HTTP slot until Resend itself timed out — a slow socket
 * leak during a Resend outage.
 *
 * This is a behavioral test, not a source assertion: we stub
 * `globalThis.fetch` with a hung request that records whether its
 * AbortSignal actually fires, drive the deadline with fake timers, and
 * assert (a) the caller gets `resend_timeout_8s`, (b) the abort REALLY
 * reached the socket layer, (c) the failed email was queued for retry.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The integration suite's global setup mocks @/lib/email; this file
// needs the real send path.
vi.unmock('@/lib/email')

// Rendering is out of scope here (m10 covers render failures) and the
// real react-email render needs a JSX runtime this vitest env doesn't
// configure — stub the template + render so the test exercises ONLY the
// send/deadline/abort path.
vi.mock('@react-email/render', () => ({
  render: vi.fn(async () => '<p>m13 stub</p>'),
}))
vi.mock('@/emails/order-confirmation', () => ({
  OrderConfirmationEmail: vi.fn(() => null),
}))

// queueRetry assertion: spy on the REAL payload singleton's jobs.queue
// (email.ts dynamic-imports the same module, so the spy applies). We
// can't vi.mock @/lib/payload here — the suite's global setup needs the
// real payload.db.pool in its beforeAll.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let queueSpy: any

type HungFetchState = {
  calls: number
  sawSignal: boolean
  abortFired: boolean
}

/**
 * A fetch stub that never responds (simulates a hung Resend endpoint)
 * but honours AbortSignal the way undici does: reject with AbortError
 * when the signal fires.
 */
function installHungFetch(): HungFetchState {
  const state: HungFetchState = { calls: 0, sawSignal: false, abortFired: false }
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: unknown, init?: RequestInit) => {
      state.calls += 1
      state.sawSignal = Boolean(init?.signal)
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          state.abortFired = true
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        })
        // otherwise: hang forever
      })
    }),
  )
  return state
}

/**
 * Real event-loop turns (setImmediate is NOT faked — see useFakeTimers
 * toFake below) until the stubbed fetch has actually been entered, so
 * advancing the fake clock is guaranteed to find the deadline timer
 * installed. Bounded so a regression fails fast instead of hanging.
 */
async function waitForRequestInFlight(state: HungFetchState): Promise<void> {
  for (let i = 0; i < 10_000; i++) {
    if (state.calls > 0) return
    await new Promise<void>((r) => setImmediate(r))
  }
  throw new Error('fetch was never called — send path did not reach the network layer')
}

describe('m13 — Resend deadline aborts the in-flight request', () => {
  beforeEach(async () => {
    process.env.RESEND_API_KEY = 're_test_m13_dummy_key'
    const { getPayload } = await import('@/lib/payload')
    const payload = await getPayload()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    queueSpy = vi
      .spyOn((payload as any).jobs, 'queue')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue(undefined as any)
    // Fake ONLY setTimeout/clearTimeout (the deadline mechanism).
    // setImmediate / nextTick / Date stay real so the module loader and
    // DB I/O keep working under the fake clock.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    queueSpy?.mockRestore()
    delete process.env.RESEND_API_KEY
  })

  it('send(): returns resend_timeout_8s, aborts the socket, queues a retry', async () => {
    const fetchState = installHungFetch()
    const { sendOrderConfirmation } = await import('@/lib/email')

    const resultPromise = sendOrderConfirmation({
      to: 'm13@test.local',
      props: {
        orderNumber: 'BGR-M13',
        totalFormatted: '$0.00',
        currency: 'NAD',
        items: [],
        siteUrl: 'http://localhost:3000',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    })
    // Wait (real event loop) until the request is actually in flight,
    // then fire the 8s deadline on the fake clock.
    await waitForRequestInFlight(fetchState)
    await vi.advanceTimersByTimeAsync(8_001)
    const result = await resultPromise

    expect(result.ok).toBe(false)
    expect('error' in result && result.error).toBe('resend_timeout_8s')
    // The behavioral core of m13: the request actually carried a signal
    // and that signal actually fired.
    expect(fetchState.calls).toBe(1)
    expect(fetchState.sawSignal).toBe(true)
    expect(fetchState.abortFired).toBe(true)
    // The timed-out email was routed to the retry queue.
    expect(queueSpy).toHaveBeenCalledTimes(1)
    expect(queueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'retryFailedEmail',
        input: expect.objectContaining({ to: 'm13@test.local' }),
      }),
    )
  })

  it('retryFailedEmail job: deadline throws (re-queues via Payload) and aborts the socket', async () => {
    const fetchState = installHungFetch()
    const { retryFailedEmailTask } = await import(
      '@/payload/jobs/retryFailedEmails'
    )

    // Payload types handler as `string | TaskHandler` (string = path to
    // a handler module); narrow before calling.
    const handler = retryFailedEmailTask.handler
    if (typeof handler !== 'function') {
      throw new Error('retryFailedEmailTask.handler is not a function')
    }
    const handlerPromise = handler({
      req: {
        payload: {
          logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
        },
      },
      input: {
        to: 'm13-retry@test.local',
        subject: 'm13 retry probe',
        html: '<p>m13</p>',
        text: 'm13',
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    // Surface the rejection expectation BEFORE advancing timers so the
    // rejection is consumed (no unhandled-rejection noise).
    const assertion = expect(handlerPromise).rejects.toThrow('resend_timeout_8s')
    await waitForRequestInFlight(fetchState)
    await vi.advanceTimersByTimeAsync(8_001)
    await assertion

    expect(fetchState.calls).toBe(1)
    expect(fetchState.sawSignal).toBe(true)
    expect(fetchState.abortFired).toBe(true)
  })
})