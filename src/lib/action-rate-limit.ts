import 'server-only'
import { headers } from 'next/headers'
import { consume, consumeStrict } from '@/lib/rate-limit'

/**
 * M11/M14: rate limit for Next.js Server Actions.
 *
 * The middleware-based rate limiter in `src/middleware.ts` only matches
 * `/api/:path*`. Server Actions POST to RSC page routes (e.g. `/quote`,
 * `/sell`, `/checkout`) — they bypass the middleware entirely. Without this
 * helper, a script can fire unlimited `submitQuoteFromCartAction` /
 * `submitVendorApplicationAction` / `placeOrderAction` invocations,
 * filling the DB with rows and burning the ops Resend quota.
 *
 * Usage:
 *   const limited = await checkActionRateLimit('vendor-application', { limit: 5, windowMs: FIFTEEN_MIN })
 *   if (!limited.ok) return { error: limited.message }
 *   // …proceed with the action
 *
 * Fail-open intentionally: a rate-limit infra outage (Upstash down,
 * in-memory exhausted) must not break legitimate checkout flow — the
 * memory-fallback in `consume` covers single-node deploys, and Upstash
 * failures fall through to memory inside `consume` itself.
 */
export type ActionRateLimitOpts = {
  /** Max calls per window. */
  limit: number
  /** Window length in ms. */
  windowMs: number
  /** Optional extra key (e.g. user id) to scope per-user instead of per-IP. */
  extra?: string
  /**
   * M7 (Phase 2) — when true, use the fail-closed `consumeStrict` variant.
   * Reserved for money-touching actions (order creation) where an Upstash
   * outage must NOT silently revert to per-instance in-memory state and
   * let a scripted attacker spam past the cap.
   */
  strict?: boolean
}

export type ActionRateLimitDecision =
  | { ok: true }
  | { ok: false; message: string; retryAfterSeconds: number }

export async function checkActionRateLimit(
  bucket: string,
  opts: ActionRateLimitOpts,
): Promise<ActionRateLimitDecision> {
  const h = await headers()
  const xff = h.get('x-forwarded-for') ?? ''
  const ip = xff.split(',')[0]?.trim() || h.get('x-real-ip') || '127.0.0.1'
  const key = `action:${bucket}:${ip}${opts.extra ? `:${opts.extra}` : ''}`
  const decision = opts.strict
    ? await consumeStrict(key, opts.limit, opts.windowMs)
    : await consume(key, opts.limit, opts.windowMs)
  if (decision.ok) return { ok: true }
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((decision.resetAt - Date.now()) / 1000),
  )
  return {
    ok: false,
    message: `Too many requests. Try again in ${retryAfterSeconds}s.`,
    retryAfterSeconds,
  }
}

export const FIFTEEN_MIN = 15 * 60 * 1000
export const ONE_MIN = 60 * 1000
export const ONE_HOUR = 60 * 60 * 1000
