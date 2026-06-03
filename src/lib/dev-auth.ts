/**
 * Shared dev-endpoint authorization. /api/dev/* routes use this to gate
 * access by SEED_TOKEN with a constant-time comparison so the token can't
 * be probed via response-timing.
 *
 * NEVER use the returned helper in production endpoints — they short-circuit
 * if NODE_ENV is 'production' regardless of token.
 */

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

export type DevAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 403; reason: string }

export function checkDevAuth(req: Request): DevAuthResult {
  if (process.env.NODE_ENV === 'production') {
    return { ok: false, status: 403, reason: 'Disabled in production.' }
  }
  const token = req.headers.get('x-seed-token') ?? ''
  const expected = process.env.SEED_TOKEN ?? ''
  if (!expected) {
    return { ok: false, status: 401, reason: 'SEED_TOKEN not configured.' }
  }
  if (!timingSafeEqual(token, expected)) {
    return { ok: false, status: 401, reason: 'Unauthorized' }
  }
  return { ok: true }
}
