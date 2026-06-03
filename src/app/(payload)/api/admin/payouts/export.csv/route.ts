import { headers } from 'next/headers'
import { getPayload } from '@/lib/payload'

export const dynamic = 'force-dynamic'

/**
 * Defends against CSV "formula injection" — Excel and Sheets interpret a
 * leading =, +, -, @, or \t as a formula. A vendor named "=HYPERLINK(…)"
 * would otherwise become a clickable link in an admin's spreadsheet.
 * Prefix the cell with a single quote so the formula stays inert.
 */
function csvEscape(value: unknown): string {
  if (value == null) return ''
  let s = typeof value === 'string' ? value : String(value)
  // I11 minor: also escape a leading single-quote so an Excel import
  // doesn't strip the prefix and re-evaluate the next cell's content.
  if (/^[=+\-@\t\r']/.test(s)) {
    s = `'${s}`
  }
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function formatMinor(amount: number): string {
  return (amount / 100).toFixed(2)
}

export async function GET(req: Request) {
  const payload = await getPayload()
  const h = await headers()
  const auth = await payload.auth({ headers: h }).catch(() => null)
  if (!auth?.user || auth.user.role !== 'admin') {
    return new Response('Forbidden', { status: 403 })
  }

  const url = new URL(req.url)
  const status = url.searchParams.get('status') ?? undefined
  const vendorId = url.searchParams.get('vendorId') ?? undefined

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {}
  if (status) where.status = { equals: status }
  if (vendorId) where.vendor = { equals: vendorId }

  const { docs } = await payload.find({
    collection: 'payouts',
    where,
    sort: '-periodEnd',
    limit: 1000,
    depth: 1,
    // B53 fix: route is admin-gated above; the Payload instance has no
    // req context so without overrideAccess the find returns 0 rows.
    overrideAccess: true,
  })

  const lines: string[] = []
  lines.push(
    [
      'reference',
      'vendor',
      'status',
      'period_start',
      'period_end',
      'currency',
      'gross',
      'commission',
      'net_payout',
      'paid_at',
      'orders_count',
    ]
      .map(csvEscape)
      .join(','),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const p of docs as any[]) {
    const vendorName = typeof p.vendor === 'object' ? p.vendor?.name : p.vendor
    lines.push(
      [
        p.reference,
        vendorName,
        p.status,
        p.periodStart,
        p.periodEnd,
        p.currency,
        formatMinor(p.totalGrossMinor ?? 0),
        formatMinor(p.totalCommissionMinor ?? 0),
        formatMinor(p.totalPayoutMinor ?? 0),
        p.paidAt ?? '',
        (p.lines ?? []).length,
      ]
        .map(csvEscape)
        .join(','),
    )
  }

  const filename = `bangarah-payouts-${new Date().toISOString().slice(0, 10)}.csv`
  return new Response(lines.join('\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
