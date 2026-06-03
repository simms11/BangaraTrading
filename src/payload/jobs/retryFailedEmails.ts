import type { TaskConfig } from 'payload'

// Email retry queue. Failed transactional emails are enqueued by
// `queueRetry()` in `src/lib/email.ts`. This handler reads the saved
// payload and replays it through Resend. Payload's standard task-retry
// policy handles exponential backoff; on final failure the job lands in
// the dead-letter state — inspectable at /admin/collections/payload-jobs.
type RetryFailedEmailIO = {
  input: { to: string; subject: string; html: string; text: string }
  output: { sent: boolean; reason?: string }
}

export const retryFailedEmailTask: TaskConfig<RetryFailedEmailIO> = {
  slug: 'retryFailedEmail',
  retries: 5, // ~5 attempts with Payload's default exponential backoff
  inputSchema: [
    { name: 'to', type: 'email', required: true },
    { name: 'subject', type: 'text', required: true },
    { name: 'html', type: 'textarea', required: true },
    { name: 'text', type: 'textarea', required: true },
  ],
  handler: async ({ req, input }) => {
    const { Resend } = await import('resend')
    const key = process.env.RESEND_API_KEY
    if (!key) {
      req.payload.logger?.warn?.(
        '[jobs:retryFailedEmail] RESEND_API_KEY not set; dropping retry',
      )
      return { output: { sent: false, reason: 'no_key' } }
    }
    const client = new Resend(key)
    const FROM =
      process.env.EMAIL_FROM ||
      'Bangarah Trading <orders@bangarahtradingenterprises.com>'
    // Clean-room correctness — the Resend SDK has no client timeout, so a
    // hung connection would block this job worker indefinitely. Race the
    // send against an 8s deadline (mirrors the primary send() path in
    // email.ts); a timeout throws → Payload's retry policy re-queues.
    //
    // R11 — capture + clearTimeout so the pending timer doesn't fire
    // after a successful send (would leak an unhandled rejection).
    // m13 (Phase 2) — abort the in-flight request on deadline so the
    // socket is released, mirroring send() in src/lib/email.ts (see the
    // comment there for why the race alone leaks sockets).
    let timerId: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    const timeoutPromise = new Promise((_, reject) => {
      timerId = setTimeout(() => {
        reject(new Error('resend_timeout_8s'))
        controller.abort()
      }, 8_000)
    })
    timeoutPromise.catch(() => undefined)
    const requestOptions: NonNullable<
      Parameters<typeof client.emails.send>[1]
    > & { signal?: AbortSignal } = { signal: controller.signal }
    let sendResult: { error?: { message?: string } | null }
    try {
      sendResult = (await Promise.race([
        client.emails.send(
          {
            from: FROM,
            to: input.to,
            subject: input.subject,
            html: input.html,
            text: input.text,
          },
          requestOptions,
        ),
        timeoutPromise,
      ])) as { error?: { message?: string } | null }
    } finally {
      if (timerId) clearTimeout(timerId)
    }
    const error = sendResult?.error ?? null
    if (error) {
      // K1.4 (round-5 C4) — on final retry failure (Payload's task runner
      // calls the handler with attempt count; we don't have direct
      // access, but we DO know that throwing here triggers the next
      // retry OR dead-letters after exhaustion). Capture to Sentry with
      // a stable tag so the dead-letter spike is visible on the ops
      // dashboard even when the customer never tells us their email
      // didn't arrive. Subject is logged; recipient is NOT (PII).
      try {
        const Sentry = await import('@sentry/nextjs').catch(() => null)
        Sentry?.captureException(new Error(`Resend retry failed: ${error.message}`), {
          tags: { area: 'email', kind: 'retry_failed', subject_prefix: input.subject.slice(0, 32) },
        })
      } catch {
        // Sentry unavailable — log already captures
      }
      throw new Error(`Resend retry failed: ${error.message}`)
    }
    return { output: { sent: true } }
  },
}
