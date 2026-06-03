import 'server-only'
import { render } from '@react-email/render'
import { Resend } from 'resend'
import {
  OrderConfirmationEmail,
  type OrderConfirmationEmailProps,
} from '@/emails/order-confirmation'
import { NewQuoteEmail, type NewQuoteEmailProps } from '@/emails/new-quote'
import {
  QuoteResponseEmail,
  type QuoteResponseEmailProps,
} from '@/emails/quote-response'
import {
  VendorApplicationEmail,
  type VendorApplicationEmailProps,
} from '@/emails/vendor-application'
import {
  VendorApprovedEmail,
  type VendorApprovedEmailProps,
} from '@/emails/vendor-approved'

let _client: Resend | null = null

function getClient(): Resend | null {
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  if (!_client) _client = new Resend(key)
  return _client
}

const FROM =
  process.env.EMAIL_FROM || 'Bangarah Trading <orders@bangarahtradingenterprises.com>'

export const OPS_EMAIL =
  process.env.OPS_EMAIL || 'enquiry@bangarahtradingenterprises.com'

/**
 * Enqueue an email for retry via the Payload jobs system. Best-effort —
 * if enqueueing itself fails, we log and drop. The original transactional
 * email has already been logged to stdout in dev, so no message is lost
 * silently in non-prod.
 */
async function queueRetry(args: {
  to: string
  subject: string
  html: string
  text: string
  reason: string
}) {
  try {
    const { getPayload } = await import('@/lib/payload')
    const payload = await getPayload()
    // M18 fix: detect missing jobs subsystem explicitly. Previously a
    // misconfigured deploy (jobs disabled, lazy boot race) would silently
    // skip the enqueue and the failed email vanished. Now the failure
    // route logs with high visibility so the operator can rerun the
    // confirmation by hand if needed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queue = (payload as any).jobs?.queue
    if (typeof queue !== 'function') {
      payload.logger?.error?.(
        `[email] CRITICAL: jobs.queue unavailable — email to ${args.to} was NOT scheduled for retry. Original reason: ${args.reason}. Investigate Payload jobs config.`,
      )
      return
    }
    await queue({
      task: 'retryFailedEmail',
      input: { to: args.to, subject: args.subject, html: args.html, text: args.text },
    })
    payload.logger?.warn?.(
      `[email] queued retry for ${args.to} — reason: ${args.reason}`,
    )
  } catch (e) {
    console.error('[email] could not enqueue retry:', e)
  }
}

// Cheap email validation. We don't try to be RFC 5322 compliant — just
// catch obvious problems (empty / no @ / no dot) that would burn retries.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * M10 (Phase 2) — wrap `render(...)` so a template-prop drift / render
 * exception doesn't escape the email pipeline. Without this, a render
 * throw bubbles out of `sendXxx`, past `send()`'s try/catch, into the
 * caller (e.g. the Stripe webhook handler), which 500s. But
 * `claimEvent` may have already committed → Stripe redelivery
 * short-circuits via `hasEvent`, the customer never receives the
 * confirmation. We now catch render errors and queue a retry through
 * the existing failed-email pipeline so the customer is recoverable.
 */
async function safeRender(
  produceHtml: () => Promise<string>,
  produceText: () => Promise<string>,
  fallback: { to: string; subject: string },
): Promise<{ ok: true; html: string; text: string } | { ok: false; error: string }> {
  try {
    const html = await produceHtml()
    const text = await produceText()
    return { ok: true, html, text }
  } catch (e) {
    const reason = `render: ${e instanceof Error ? e.message : String(e)}`
    // Queue with a plain-text fallback so the retry job can still try
    // to send something the next time around (even though render is
    // likely to fail again on retry — the retry queue eventually
    // dead-letters and Sentry-alerts so ops sees the regression).
    await queueRetry({
      to: fallback.to,
      subject: fallback.subject,
      html: `<p>Your transactional email could not be rendered. Reference: ${fallback.subject}. Please contact support.</p>`,
      text: `Your transactional email could not be rendered. Reference: ${fallback.subject}. Please contact support.`,
      reason,
    })
    return { ok: false, error: reason }
  }
}

async function send(args: {
  to: string
  subject: string
  html: string
  text: string
}): Promise<{ ok: true; mocked: boolean } | { ok: false; error: string }> {
  // B44 fix: refuse to queue a retry loop on a recipient we know is bad.
  if (!args.to || !EMAIL_RE.test(args.to)) {
    console.warn(
      `[bangarah:email] refusing to send to invalid address: ${JSON.stringify(args.to)}`,
    )
    return { ok: false, error: 'invalid_recipient' }
  }
  const client = getClient()
  if (!client) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(
        `\n[bangarah:email:dev] To: ${args.to}\nSubject: ${args.subject}\n${args.text}\n`,
      )
    }
    return { ok: true, mocked: true }
  }
  // R7 round-7 reliability C1 + C2 — Resend has no native timeout
  // option. We race the send against an 8s deadline so a hung network
  // can't eat the Vercel function deadline; on timeout OR thrown
  // exception we queue for retry instead of propagating (the retry
  // queue itself is bounded). The previous code only queued retry on
  // `{ error }` shapes — a thrown network exception escaped to the
  // caller and (in the Stripe webhook path) interacted badly with the
  // claim-event ordering, dropping the email permanently.
  // R11 — capture and CLEAR the timeout. The previous Promise.race left
  // the setTimeout pending after a successful send; it then fired ~8s
  // later with no consumer, producing an unhandled-rejection on every
  // successful email (under `--unhandled-rejections=strict` this would
  // crash the worker; otherwise it logs noise and on Vercel keeps the
  // function instance alive ≥8s longer than necessary).
  // m13 (Phase 2) — ABORT the in-flight HTTP request when the deadline
  // fires, don't just abandon the promise. The race alone left the
  // underlying socket holding an HTTP slot until Resend itself timed
  // out — during a Resend outage that's a slow socket leak (soft outage
  // → hard one). Resend 4.8's `post()` spreads the second `send()` arg
  // straight into fetch's RequestInit, so `signal` reaches the socket;
  // the SDK's option types just don't declare it, hence the
  // intersection type below.
  let timerId: ReturnType<typeof setTimeout> | undefined
  const controller = new AbortController()
  try {
    const requestOptions: NonNullable<
      Parameters<typeof client.emails.send>[1]
    > & { signal?: AbortSignal } = { signal: controller.signal }
    const sendPromise = client.emails.send(
      {
        from: FROM,
        to: args.to,
        subject: args.subject,
        html: args.html,
        text: args.text,
      },
      requestOptions,
    )
    const timeoutPromise = new Promise<{ error: { message: string } }>(
      (_, reject) => {
        timerId = setTimeout(() => {
          // Reject FIRST so the race deterministically reports
          // `resend_timeout_8s`, then abort to release the socket. The
          // aborted sendPromise resolves later with Resend's catch-all
          // error shape — already-settled race drops it, no unhandled
          // rejection.
          reject(new Error('resend_timeout_8s'))
          controller.abort()
        }, 8_000)
      },
    )
    // Suppress unhandled-rejection if the timer wins the race after we
    // already resolved on send (defensive belt-and-braces alongside the
    // clearTimeout in the finally).
    timeoutPromise.catch(() => undefined)
    const { error } = (await Promise.race([sendPromise, timeoutPromise])) as {
      error?: { message?: string }
    }
    if (error) {
      await queueRetry({ ...args, reason: error.message ?? 'unknown_error' })
      return { ok: false, error: error.message ?? 'unknown_error' }
    }
    return { ok: true, mocked: false }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await queueRetry({ ...args, reason: msg })
    return { ok: false, error: msg }
  } finally {
    if (timerId) clearTimeout(timerId)
  }
}

export async function sendOrderConfirmation(args: {
  to: string
  props: OrderConfirmationEmailProps
}) {
  const subject = `Your Bangarah order ${args.props.orderNumber} is confirmed`
  const rendered = await safeRender(
    () => render(OrderConfirmationEmail(args.props)),
    () => render(OrderConfirmationEmail(args.props), { plainText: true }),
    { to: args.to, subject },
  )
  if (!rendered.ok) return { ok: false as const, error: rendered.error }
  return send({ to: args.to, subject, html: rendered.html, text: rendered.text })
}

export async function sendNewQuoteCustomer(args: { to: string; props: NewQuoteEmailProps }) {
  const subject = `Bangarah · Quote ${args.props.quoteNumber} received`
  const rendered = await safeRender(
    () => render(NewQuoteEmail({ ...args.props, isOpsAlert: false })),
    () => render(NewQuoteEmail({ ...args.props, isOpsAlert: false }), { plainText: true }),
    { to: args.to, subject },
  )
  if (!rendered.ok) return { ok: false as const, error: rendered.error }
  return send({ to: args.to, subject, html: rendered.html, text: rendered.text })
}

export async function sendNewQuoteOps(args: { to?: string; props: NewQuoteEmailProps }) {
  const to = args.to ?? OPS_EMAIL
  const subject = `New quote request · ${args.props.quoteNumber} from ${args.props.customerName}`
  const rendered = await safeRender(
    () => render(NewQuoteEmail({ ...args.props, isOpsAlert: true })),
    () => render(NewQuoteEmail({ ...args.props, isOpsAlert: true }), { plainText: true }),
    { to, subject },
  )
  if (!rendered.ok) return { ok: false as const, error: rendered.error }
  return send({ to, subject, html: rendered.html, text: rendered.text })
}

export async function sendQuoteResponse(args: { to: string; props: QuoteResponseEmailProps }) {
  const subject = `Your Bangarah quote ${args.props.quoteNumber} is ready`
  const rendered = await safeRender(
    () => render(QuoteResponseEmail(args.props)),
    () => render(QuoteResponseEmail(args.props), { plainText: true }),
    { to: args.to, subject },
  )
  if (!rendered.ok) return { ok: false as const, error: rendered.error }
  return send({ to: args.to, subject, html: rendered.html, text: rendered.text })
}

export async function sendNewVendorOps(args: {
  to?: string
  props: VendorApplicationEmailProps
}) {
  const to = args.to ?? OPS_EMAIL
  const subject = `New vendor application · ${args.props.vendorName}`
  const rendered = await safeRender(
    () => render(VendorApplicationEmail(args.props)),
    () => render(VendorApplicationEmail(args.props), { plainText: true }),
    { to, subject },
  )
  if (!rendered.ok) return { ok: false as const, error: rendered.error }
  return send({ to, subject, html: rendered.html, text: rendered.text })
}

export async function sendVendorApproved(args: { to: string; props: VendorApprovedEmailProps }) {
  const subject = `${args.props.vendorName} is now live on Bangarah`
  const rendered = await safeRender(
    () => render(VendorApprovedEmail(args.props)),
    () => render(VendorApprovedEmail(args.props), { plainText: true }),
    { to: args.to, subject },
  )
  if (!rendered.ok) return { ok: false as const, error: rendered.error }
  return send({ to: args.to, subject, html: rendered.html, text: rendered.text })
}
