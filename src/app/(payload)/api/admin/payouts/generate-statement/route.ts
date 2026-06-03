import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { getPayload } from '@/lib/payload'
import { generateVendorStatement } from '@/lib/payouts'

export const dynamic = 'force-dynamic'

const schema = z.object({
  vendorId: z.union([z.string(), z.number()]),
  periodStart: z.string(),
  periodEnd: z.string(),
})

export async function POST(req: Request) {
  const payload = await getPayload()
  const h = await headers()
  const auth = await payload.auth({ headers: h }).catch(() => null)
  if (!auth?.user || auth.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    )
  }

  const result = await generateVendorStatement(parsed.data)
  if (!result.ok) return NextResponse.json(result, { status: 400 })
  return NextResponse.json(result)
}
