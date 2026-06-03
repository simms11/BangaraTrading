import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { getCurrentUser } from '@/lib/auth'
import { getVendorStats, listVendorPayouts } from '@/lib/queries/vendor-dashboard'
import { formatPrice, formatDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Your payouts',
  robots: { index: false, follow: false },
}

const statusVariant: Record<string, 'default' | 'accent' | 'spice'> = {
  pending: 'accent',
  processing: 'accent',
  paid: 'default',
  cancelled: 'spice',
}

export default async function VendorPayoutsPage() {
  const user = await getCurrentUser()
  if (!user?.vendor) redirect('/sign-in?next=/vendor/payouts')
  const vendorId =
    typeof user.vendor === 'object'
      ? (user.vendor as { id: number | string }).id
      : (user.vendor as number | string)

  const [payouts, stats] = await Promise.all([
    listVendorPayouts(vendorId),
    getVendorStats(vendorId),
  ])

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Payouts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bangarah operates as merchant-of-record. We collect customer payments and pay you out
          via bank transfer on a regular schedule, less the platform commission.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Lifetime sales" value={formatPrice(stats.paidGmvMinor, stats.currency)} />
        <Stat
          label="Paid out to you"
          value={formatPrice(stats.paidOutMinor, stats.currency)}
        />
        <Stat
          label="Outstanding"
          value={formatPrice(stats.outstandingPayoutMinor, stats.currency)}
          accent
        />
      </div>

      {payouts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-white p-10 text-center text-muted-foreground">
          No payouts on record yet. Once Bangarah processes a payout batch you&apos;ll see it
          here.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3" scope="col">Reference</th>
                <th className="px-4 py-3" scope="col">Period</th>
                <th className="px-4 py-3" scope="col">Status</th>
                <th className="px-4 py-3 text-right" scope="col">Gross</th>
                <th className="px-4 py-3 text-right" scope="col">Commission</th>
                <th className="px-4 py-3 text-right" scope="col">Net paid</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {(payouts as any[]).map((p) => (
                <tr key={p.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">{p.reference}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDate(p.periodStart)} –{' '}
                    {formatDate(p.periodEnd)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={statusVariant[p.status] ?? 'default'}>{p.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatPrice(p.totalGrossMinor, p.currency)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {formatPrice(p.totalCommissionMinor, p.currency)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {formatPrice(p.totalPayoutMinor, p.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className={`rounded-2xl border bg-white p-5 shadow-sm ${
        accent ? 'border-accent-300 bg-accent-50/40' : 'border-border'
      }`}
    >
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}
