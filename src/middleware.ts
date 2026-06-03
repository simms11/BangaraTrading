import { NextResponse, type NextRequest } from 'next/server'
import { consume, consumeStrict, rateLimitHeaders } from '@/lib/rate-limit'

/**
 * Edge-runtime safe constant-time string compare. Edge can't import
 * `node:crypto`, so we hand-roll the constant-time pattern: XOR every
 * byte (truncating the longer string but always processing the longer
 * length to avoid early-exit on length mismatch).
 */
function timingSafeStrEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return diff === 0
}

/**
 * Edge middleware on every /api/* route.
 *
 * Two layers run on every matching request:
 *   1. CSRF / Origin guard for mutating methods (POST/PATCH/PUT/DELETE).
 *      Webhooks bypass (signature-gated). Bearer/JWT-authenticated callers
 *      bypass (server-to-server programmatic clients don't ride cookies).
 *   2. Rate limiting via @/lib/rate-limit (Upstash Redis in prod, in-memory
 *      fallback locally). Standard RateLimit-* + Retry-After headers.
 *
 * Buckets:
 *   - /api/users/login        10 / 15min   credential stuffing
 *   - /api/users (POST)        5 / 15min   signup spam
 *   - /api/dev/*              30 / 15min   dev endpoints, also token-gated
 *   - /api/shipping/quote    120 / min     cheap, but loopable
 *   - /api/admin/*            60 / min     admin tools
 */

type Rule = {
  match: (req: NextRequest) => boolean
  key: (req: NextRequest, ip: string) => string
  limit: number
  windowMs: number
  /**
   * H4: when true, use the fail-closed `consumeStrict` variant. Reserved
   * for credential-sensitive endpoints (login, forgot-password) where an
   * Upstash outage shouldn't open the door to brute force.
   */
  strict?: boolean
}

const FIFTEEN_MIN = 15 * 60 * 1000
const ONE_MIN = 60 * 1000

const RULES: Rule[] = [
  {
    match: (req) =>
      req.method === 'POST' && req.nextUrl.pathname === '/api/users/login',
    key: (_req, ip) => `login:${ip}`,
    limit: 10,
    windowMs: FIFTEEN_MIN,
    // H4 (C4): fail-closed. During an Upstash outage we'd rather reject
    // legitimate logins than open a credential-stuffing window.
    strict: true,
  },
  {
    match: (req) =>
      req.method === 'POST' && req.nextUrl.pathname === '/api/users',
    key: (_req, ip) => `signup:${ip}`,
    limit: 5,
    windowMs: FIFTEEN_MIN,
    // R7 round-7 reliability M8 — signup must fail closed during an
    // Upstash outage. Previously `consume()` (default) fell back to
    // per-instance in-memory buckets; on multi-instance Vercel deploys
    // an attacker could create N × per-instance accounts during a
    // Redis incident. Mark strict so the bucket refuses on rate-limit
    // backend failure.
    strict: true,
  },
  {
    // H9 (M6): rate-limit Payload's built-in forgot-password endpoint.
    // Without this, an attacker can enumerate accounts via response timing
    // (existing email triggers a Resend call; missing email returns fast)
    // and brute-force the reset token surface. Strict because the same
    // logic that protects login applies here.
    match: (req) =>
      req.method === 'POST' &&
      req.nextUrl.pathname === '/api/users/forgot-password',
    key: (_req, ip) => `forgot:${ip}`,
    limit: 5,
    windowMs: FIFTEEN_MIN,
    strict: true,
  },
  {
    match: (req) =>
      req.method === 'POST' &&
      req.nextUrl.pathname === '/api/users/reset-password',
    key: (_req, ip) => `reset:${ip}`,
    limit: 10,
    windowMs: FIFTEEN_MIN,
    strict: true,
  },
  {
    match: (req) => req.nextUrl.pathname.startsWith('/api/dev/'),
    key: (req, ip) => `dev:${req.nextUrl.pathname}:${ip}`,
    limit: 30,
    windowMs: FIFTEEN_MIN,
  },
  {
    match: (req) =>
      req.method === 'POST' && req.nextUrl.pathname === '/api/shipping/quote',
    key: (_req, ip) => `ship:${ip}`,
    limit: 120,
    windowMs: ONE_MIN,
  },
  {
    match: (req) => req.nextUrl.pathname.startsWith('/api/admin/'),
    key: (req, ip) => `admin:${req.nextUrl.pathname}:${ip}`,
    limit: 60,
    windowMs: ONE_MIN,
  },
  {
    // B75: GraphQL is unauthenticated and accepts arbitrary queries. Depth
    // is already capped (see createDepthLimit), but raw request rate isn't —
    // a hostile client can still hammer the endpoint with O(N) sibling
    // queries. 30/min/IP comfortably covers legitimate dashboard usage
    // while throttling adversarial enumeration.
    match: (req) =>
      req.method === 'POST' && req.nextUrl.pathname === '/api/graphql',
    key: (_req, ip) => `graphql:${ip}`,
    limit: 30,
    windowMs: ONE_MIN,
  },
  {
    // K4 (round-5 M2) — webhooks bypass CSRF (they're signature-gated),
    // but signature *missing* still costs a function invocation. A
    // hostile actor can flood `/api/webhooks/stripe` with no signature
    // header and burn through our Vercel function budget. Apply a
    // generous-but-bounded IP cap that legit Stripe IPs won't hit
    // (Stripe sends from a small pool of fingerprinted IPs at ~1
    // event/sec, vastly below 600/min).
    match: (req) =>
      req.method === 'POST' && req.nextUrl.pathname.startsWith('/api/webhooks/'),
    key: (_req, ip) => `webhook:${ip}`,
    limit: 600,
    windowMs: ONE_MIN,
  },
]

function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return (
    req.headers.get('x-real-ip') ||
    req.headers.get('cf-connecting-ip') ||
    '127.0.0.1'
  )
}

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])
const WEBHOOK_PREFIX = '/api/webhooks/'

function csrfCheck(req: NextRequest): NextResponse | null {
  if (!MUTATING_METHODS.has(req.method)) return null
  if (req.nextUrl.pathname.startsWith(WEBHOOK_PREFIX)) return null // signature-gated

  // Bearer/JWT — programmatic client, not a browser cookie ride.
  const auth = req.headers.get('authorization')
  if (auth && (auth.startsWith('Bearer ') || auth.startsWith('JWT '))) return null
  // x-seed-token — dev-only out-of-band shared secret. /api/dev/* routes
  // double-check it against process.env.SEED_TOKEN; here we trust its
  // VALUE (not just presence) as proof this isn't a browser-cookie ride.
  //
  // J6 (round-4 m9) + R7 round-7 sec M2 — previously this bypass fired
  // on any non-empty header value (CSRF protection turned off for free
  // on staging/preview if attacker knew to send any string). Now we
  // require the exact configured SEED_TOKEN. The dev route still
  // re-validates with its own constant-time compare; the middleware
  // bypass is now also constant-time.
  if (process.env.NODE_ENV !== 'production') {
    const incoming = req.headers.get('x-seed-token')
    const expected = process.env.SEED_TOKEN
    if (incoming && expected && timingSafeStrEqual(incoming, expected)) return null
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '')
  const origin = req.headers.get('origin')
  if (origin) {
    if (siteUrl && origin === siteUrl) return null
    // Allow self-origin when the host header matches (Vercel preview URLs,
    // local dev with non-canonical hostnames).
    const host = req.headers.get('host')
    if (host && origin.endsWith(`://${host}`)) return null
    return new NextResponse(
      JSON.stringify({ error: 'Forbidden — bad origin' }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    )
  }

  // No Origin header — only allow browser-classified same-origin/direct nav.
  const secFetch = req.headers.get('sec-fetch-site')
  if (secFetch === 'same-origin' || secFetch === 'same-site' || secFetch === 'none') {
    return null
  }

  return new NextResponse(
    JSON.stringify({ error: 'Forbidden — missing origin' }),
    { status: 403, headers: { 'content-type': 'application/json' } },
  )
}

export async function middleware(req: NextRequest) {
  const csrf = csrfCheck(req)
  if (csrf) return csrf

  const rule = RULES.find((r) => r.match(req))
  if (!rule) return NextResponse.next()
  const ip = clientIp(req)
  const limiter = rule.strict ? consumeStrict : consume
  const decision = await limiter(rule.key(req, ip), rule.limit, rule.windowMs)
  const headers = rateLimitHeaders(decision, rule.limit)
  if (!decision.ok) {
    headers.set(
      'Retry-After',
      String(Math.max(1, Math.ceil((decision.resetAt - Date.now()) / 1000))),
    )
    return new NextResponse(
      JSON.stringify({ error: 'Too many requests. Slow down and try again shortly.' }),
      {
        status: 429,
        headers: {
          ...Object.fromEntries(headers),
          'content-type': 'application/json',
        },
      },
    )
  }
  const res = NextResponse.next()
  headers.forEach((v, k) => res.headers.set(k, v))
  return res
}

export const config = {
  // CSRF + rate-limit run on every /api route; storefront stays edge-cached.
  matcher: ['/api/:path*'],
}
