import { NextResponse } from 'next/server'
import { getPayload } from '@/lib/payload'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Lightweight liveness + readiness probe.
 *
 * - liveness: process is up — always 200 unless this handler can't run.
 * - readiness: Postgres is reachable via a SELECT 1 round-trip.
 *
 * For Vercel deploys this is hit by uptime monitors (or `vercel logs`).
 * Keep it under 100ms — no joins, no auth.
 */
export async function GET() {
  const startedAt = Date.now()
  const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {}

  // Postgres readiness via Payload's pool
  try {
    const t0 = Date.now()
    const payload = await getPayload()
    await payload.find({
      collection: 'users',
      limit: 0,
      depth: 0,
      overrideAccess: true,
    })
    checks.db = { ok: true, latencyMs: Date.now() - t0 }
  } catch (e) {
    // Clean-room security — this endpoint is unauthenticated; do NOT
    // echo raw DB error strings (they leak connection host / schema
    // details to anyone hitting /api/health). Log full detail
    // server-side; return a generic marker so monitors still page.
    console.error('[health] db check failed:', e instanceof Error ? e.message : String(e))
    checks.db = { ok: false, error: 'db_unreachable' }
  }

  // K1.4 (round-5 C4) — surface the email dead-letter backlog so the
  // operator can detect silent email loss (Resend outage, bad API key)
  // before customers start complaining. >5 failed retries in 24h flips
  // ok=false so uptime monitors page on it.
  // Use raw SQL so we don't bind to a typed slug that may shift across
  // Payload minors. payload_jobs table is auto-created by Payload's
  // jobs runtime — soft-fail if it doesn't exist yet.
  try {
    const payload = await getPayload()
    const pool = (payload.db as unknown as { pool: import('pg').Pool }).pool
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM payload_jobs
       WHERE task_slug = 'retryFailedEmail'
         AND has_error = true
         AND completed_at >= $1::timestamptz`,
      [since],
    )
    const count = parseInt(result.rows[0]?.count ?? '0', 10)
    checks.emailDeadLetter = { ok: count <= 5 }
    if (count > 5) {
      checks.emailDeadLetter.error = `${count} dead-letter emails in last 24h`
    }
  } catch (e) {
    // R7 round-7 reliability M3 — previously swallowed ALL errors and
    // reported ok=true, so a Payload minor that renamed the task_slug/
    // has_error/completed_at columns would silently disable dead-letter
    // monitoring without anyone noticing. Now only soft-fail on
    // undefined_table (42P01); any other SQL error (column missing,
    // permissions, etc.) flips ok=false so uptime monitors page on it.
    const code = (e as { code?: string })?.code
    if (code === '42P01') {
      checks.emailDeadLetter = { ok: true }
    } else {
      // Clean-room security — log full detail, return a generic marker
      // (no raw SQL error in the unauthenticated response).
      console.error(
        '[health] payload_jobs query failed:',
        e instanceof Error ? e.message : String(e),
      )
      checks.emailDeadLetter = { ok: false, error: 'jobs_query_failed' }
    }
  }

  const ok = Object.values(checks).every((c) => c.ok)
  return NextResponse.json(
    {
      ok,
      version: process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev',
      uptime: Math.floor(process.uptime()),
      checks,
      latencyMs: Date.now() - startedAt,
    },
    {
      status: ok ? 200 : 503,
      headers: { 'cache-control': 'no-store' },
    },
  )
}
