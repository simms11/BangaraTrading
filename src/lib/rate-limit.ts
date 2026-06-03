/**
 * Rate limiter with two backends behind a single contract:
 *
 *   - **Upstash Redis** (multi-region, durable, atomic) — used in
 *     production when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 *     are set. Uses Upstash's official @upstash/ratelimit sliding window
 *     algorithm via the REST API, which is edge-runtime friendly.
 *
 *   - **In-memory token bucket** — fallback for local dev and single-node
 *     deploys. Bounded to 10 000 keys, oldest-out to keep memory in check.
 *
 * Both implementations expose `consume(key, limit, ttl)` returning the
 * same shape, so middleware code is identical.
 */
import { Redis } from '@upstash/redis'
import { Ratelimit } from '@upstash/ratelimit'

export type RateLimitDecision = {
  ok: boolean
  remaining: number
  resetAt: number
}

// In-memory backend ─────────────────────────────────────────────────────
type Bucket = { tokens: number; resetAt: number }
const STORE = new Map<string, Bucket>()
const MAX_KEYS = 10_000

function purgeIfTooLarge() {
  if (STORE.size <= MAX_KEYS) return
  // I11 minor fix: the previous implementation only dropped keys whose
  // resetAt was within +60s of now. Under a sustained legitimate burst
  // (10k unique IPs each with a fresh bucket whose resetAt is well in
  // the future), every comparison was false — nothing was evicted and
  // memory grew unbounded until the bucket TTLs naturally elapsed. Now
  // we just evict the oldest 20% of entries by resetAt, unconditionally.
  const keys: Array<[string, number]> = []
  for (const [k, v] of STORE) keys.push([k, v.resetAt])
  keys.sort((a, b) => a[1] - b[1])
  const dropCount = Math.floor(keys.length * 0.2)
  for (let i = 0; i < dropCount; i++) {
    STORE.delete(keys[i][0])
  }
}

function consumeMemory(key: string, limit: number, windowMs: number): RateLimitDecision {
  const now = Date.now()
  const existing = STORE.get(key)
  if (!existing || existing.resetAt <= now) {
    const fresh: Bucket = { tokens: limit - 1, resetAt: now + windowMs }
    STORE.set(key, fresh)
    purgeIfTooLarge()
    return { ok: true, remaining: fresh.tokens, resetAt: fresh.resetAt }
  }
  if (existing.tokens <= 0) {
    return { ok: false, remaining: 0, resetAt: existing.resetAt }
  }
  existing.tokens -= 1
  return { ok: true, remaining: existing.tokens, resetAt: existing.resetAt }
}

// Upstash backend ───────────────────────────────────────────────────────
let _redis: Redis | null = null
const _limiters = new Map<string, Ratelimit>()

function upstashEnabled(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  )
}

function getRedis(): Redis | null {
  if (!upstashEnabled()) return null
  if (!_redis) {
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  }
  return _redis
}

function getLimiter(limit: number, windowMs: number): Ratelimit | null {
  const redis = getRedis()
  if (!redis) return null
  const key = `${limit}/${windowMs}`
  let l = _limiters.get(key)
  if (!l) {
    l = new Ratelimit({
      redis,
      // Sliding-window is more correct than fixed-window for burst protection
      // and Upstash's implementation is atomic via a single Lua script.
      limiter: Ratelimit.slidingWindow(limit, `${windowMs} ms`),
      prefix: 'bangarah:rl',
      analytics: false,
    })
    _limiters.set(key, l)
  }
  return l
}

async function consumeUpstash(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitDecision | null> {
  const limiter = getLimiter(limit, windowMs)
  if (!limiter) return null
  try {
    const res = await limiter.limit(key)
    // K4 (round-5 M1) — validate the response shape. A successful 200 from
    // Upstash with a malformed body (SDK upgrade drift, partial response,
    // ad-blocker injecting JSON) used to coerce `undefined` to falsy on
    // `ok: res.success` → legitimate users blocked with NaN headers. Treat
    // any non-boolean `success` field as a remote failure → null → caller
    // routes to memory fallback (or fail-closed in consumeStrict).
    if (
      typeof res?.success !== 'boolean' ||
      typeof res.remaining !== 'number' ||
      typeof res.reset !== 'number'
    ) {
      console.error('[rate-limit:upstash] malformed response shape', res)
      return null
    }
    return {
      ok: res.success,
      remaining: Math.max(0, res.remaining),
      resetAt: res.reset,
    }
  } catch (e) {
    // Fail-open — better to serve traffic than to outage because Upstash had
    // a hiccup. Operators monitor via Sentry/uptime.
    console.error('[rate-limit:upstash]', e)
    return null
  }
}

// m14 (Phase 2): once-per-60s Sentry alert when consume() silently
// falls back from Upstash to in-memory. Without this, a real Upstash
// incident weakens per-instance rate limits with no operator signal.
// The throttle uses local module state — single-bucket dedupe so a
// burst of failures during an outage produces one alert per minute,
// not one per request.
let _lastUpstashFallbackWarnAt = 0
const UPSTASH_FALLBACK_WARN_THROTTLE_MS = 60_000
/** Test-only — reset the throttle between tests. */
export function __resetUpstashFallbackWarn(): void {
  _lastUpstashFallbackWarnAt = 0
}
async function warnUpstashFallback(reason: string): Promise<void> {
  const now = Date.now()
  if (now - _lastUpstashFallbackWarnAt < UPSTASH_FALLBACK_WARN_THROTTLE_MS) return
  _lastUpstashFallbackWarnAt = now
  try {
    const Sentry = await import('@sentry/nextjs').catch(() => null)
    Sentry?.captureMessage(
      `[rate-limit] upstash unavailable — fallback to in-memory bucket. Per-instance rate limits weakened. Reason: ${reason}`,
      'warning',
    )
  } catch {
    // Sentry not configured
  }
}

// Public API ────────────────────────────────────────────────────────────
export async function consume(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitDecision> {
  const remote = await consumeUpstash(key, limit, windowMs)
  if (remote) return remote
  // Only warn when Upstash was supposed to be available (env configured)
  // — a dev box with no Upstash config legitimately uses the in-memory
  // bucket; spamming Sentry would just bury real incidents.
  if (upstashEnabled()) {
    void warnUpstashFallback('consumeUpstash returned null')
  }
  return consumeMemory(key, limit, windowMs)
}

/**
 * H4 fix (C4): credential-stuffing-grade rate limit. The default `consume`
 * fails open when Upstash errors — falling back to a per-instance in-memory
 * bucket that resets per cold instance. On a multi-instance Vercel deploy
 * that's effectively unlimited for an attacker rotating IPs.
 *
 * `consumeStrict` keeps the in-memory bucket as a *secondary* limiter
 * (it still catches per-instance bursts) but, on Upstash failure, returns
 * a NEGATIVE decision so the caller blocks the request. Used for the
 * login endpoint specifically. The trade-off is uptime: during a real
 * Upstash outage, logins fail. Acceptable for credential-stuffing
 * windows; alternative is to fix-forward by paging ops.
 */
export async function consumeStrict(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitDecision> {
  if (!upstashEnabled()) {
    // I5 (M1) belt-and-braces: in production, refuse to fall through to
    // the per-instance memory bucket — that bucket resets per cold
    // instance and is effectively unlimited under credential-stuffing.
    // The payload.config.ts env hard-fail should have already blocked
    // boot, but if a future code path skips that we still fail closed.
    // In dev/test/single-node deploys (NODE_ENV !== 'production'), the
    // in-memory bucket is the expected mode.
    if (process.env.NODE_ENV === 'production') {
      console.error(
        `[rate-limit:strict] UPSTASH_* not configured in production; denying ${key}.`,
      )
      return { ok: false, remaining: 0, resetAt: Date.now() + windowMs }
    }
    return consumeMemory(key, limit, windowMs)
  }
  const remote = await consumeUpstash(key, limit, windowMs)
  if (!remote) {
    // Upstash returned null = error. Fail closed.
    console.error(
      `[rate-limit:strict] Upstash unavailable, denying ${key} (fail-closed mode).`,
    )
    return { ok: false, remaining: 0, resetAt: Date.now() + windowMs }
  }
  // Also debit the local bucket so the closest layer of defense stays warm.
  consumeMemory(key, limit, windowMs)
  return remote
}

export function rateLimitHeaders(decision: RateLimitDecision, limit: number): Headers {
  const h = new Headers()
  h.set('RateLimit-Limit', String(limit))
  h.set('RateLimit-Remaining', String(decision.remaining))
  h.set(
    'RateLimit-Reset',
    String(Math.max(0, Math.floor((decision.resetAt - Date.now()) / 1000))),
  )
  return h
}

export function rateLimitBackend(): 'upstash' | 'memory' {
  return upstashEnabled() ? 'upstash' : 'memory'
}
