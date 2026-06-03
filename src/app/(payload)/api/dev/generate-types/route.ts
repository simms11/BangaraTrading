import { NextResponse } from 'next/server'
import { getPayload } from '@/lib/payload'
import { generateTypes } from 'payload/node'
import { checkDevAuth } from '@/lib/dev-auth'

export const dynamic = 'force-dynamic'

/**
 * Dev-only: regenerates `src/payload-types.ts` in-process.
 *
 *   curl -X POST -H "x-seed-token: $SEED_TOKEN" http://localhost:3000/api/dev/generate-types
 *
 * Lives inside Next.js so the config's extension-less imports resolve via
 * the same bundler the dev server uses, bypassing Payload CLI's tsx ESM
 * strictness. Disabled in production.
 */
export async function POST(req: Request) {
  const auth = checkDevAuth(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status })
  }

  try {
    const payload = await getPayload()
    await generateTypes(payload.config, { log: false })
    return NextResponse.json({ ok: true, path: payload.config.typescript.outputFile })
  } catch (err) {
    console.error('[dev:generate-types]', err)
    return NextResponse.json(
      { ok: false, error: 'Type generation failed. Check server logs.' },
      { status: 500 },
    )
  }
}
