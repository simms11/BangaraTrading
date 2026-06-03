/**
 * Dev-only seed endpoint.
 *
 * Auth: requires header  x-seed-token: $SEED_TOKEN  (env)
 *       AND  NODE_ENV !== 'production'
 *
 * Invoke from terminal:
 *   curl -X POST -H "x-seed-token: $SEED_TOKEN" http://localhost:3000/api/dev/seed
 */
import { NextResponse } from 'next/server'
import { getPayload } from '@/lib/payload'
import { seed } from '@/payload/seed'
import { checkDevAuth } from '@/lib/dev-auth'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const auth = checkDevAuth(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status })
  }

  try {
    const payload = await getPayload()
    const report = await seed(payload)
    return NextResponse.json({ ok: true, report })
  } catch (err) {
    // Dev endpoint — log full error to console; respond with a redacted
    // message so we don't bake DB internals into curl-friendly output.
    console.error('[dev:seed]', err)
    return NextResponse.json(
      { ok: false, error: 'Seed failed. Check server logs.' },
      { status: 500 },
    )
  }
}
