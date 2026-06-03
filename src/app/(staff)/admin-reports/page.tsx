import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { TrendingUp, ShoppingBag, Wallet, RotateCcw } from 'lucide-react'

import { Card, CardContent, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getCurrentUser } from '@/lib/auth'
import { getAdminReport } from '@/lib/queries/admin-reports'
import { formatPrice } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Admin reports',
  robots: { index: false, follow: false },
}

type SearchParams = Promise<{ window?: string }>

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/sign-in?next=/admin-reports')
  if (user.role !== 'admin') redirect('/')

  const sp = await searchParams
  const windowDays = Math.max(7, Math.min(365, Number(sp.window) || 30))
  const report = await getAdminReport(windowDays)

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Bangarah-wide overview. Currency: {report.currency}.
          </p>
        </div>
        <nav aria-label="Window" className="flex gap-1">
          {[7, 30, 90, 365].map((d) => (
            <Link
              key={d}
              href={`/admin-reports?window=${d}`}
              className={`rounded-full border px-3 py-1.5 text-xs ${
                windowDays === d
                  ? 'border-brand-900 bg-brand-900 text-white'
                  : 'border-border bg-white hover:border-brand-300'
              }`}
            >
              {d === 7 ? '7d' : d === 30 ? '30d' : d === 90 ? '90d' : '1y'}
            </Link>
          ))}
        </nav>
      </header>

      {report.truncated && (
        // M16 (Phase 2) — getAdminReport sets truncated=true when any of
        // its 4 underlying queries hit the 1000-row cap. Without this
        // banner, scaling past 1000 orders/payouts/refunds silently
        // under-reports lifetime GMV and outstanding payouts.
        <div
          role="status"
          className="rounded-2xl border border-spice-200 bg-spice-50 p-4 text-sm text-spice-900"
        >
          <strong>Data truncated.</strong> One or more underlying queries hit the
          1000-row cap; the figures below are partial. Contact engineering to lift the cap.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={<TrendingUp className="h-5 w-5" aria-hidden />}
          label={`GMV (last ${windowDays}d)`}
          value={formatPrice(report.paidGmvWindowMinor, report.currency)}
          sub={`Lifetime: ${formatPrice(report.paidGmvMinor, report.currency)}`}
        />
        <Stat
          icon={<ShoppingBag className="h-5 w-5" aria-hidden />}
          label="Orders"
          value={`${report.orderCountInWindow}`}
          sub={`Lifetime: ${report.orderCountTotal}`}
        />
        <Stat
          icon={<Wallet className="h-5 w-5" aria-hidden />}
          label="Outstanding payouts"
          value={formatPrice(report.outstandingPayoutsMinor, report.currency)}
          accent={report.outstandingPayoutsMinor > 0}
        />
        <Stat
          icon={<RotateCcw className="h-5 w-5" aria-hidden />}
          label="Refunded"
          value={formatPrice(report.refundedMinor, report.currency)}
          sub={`${report.pendingOrders} pending payment`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-4 pt-6">
            <CardTitle>Orders by status</CardTitle>
            {report.ordersByStatus.length === 0 ? (
              <p className="text-sm text-muted-foreground">No orders yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {report.ordersByStatus.map((s) => (
                  <li key={s.status} className="flex justify-between py-2 text-sm">
                    <Badge>{s.status.replace(/_/g, ' ')}</Badge>
                    <span className="tabular-nums">{s.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 pt-6">
            <CardTitle>Top vendors (lifetime GMV)</CardTitle>
            {report.topVendors.length === 0 ? (
              <p className="text-sm text-muted-foreground">No paid orders yet.</p>
            ) : (
              <ol className="space-y-2 text-sm">
                {report.topVendors.map((v, i) => (
                  <li key={String(v.vendorId)} className="flex justify-between">
                    <span>
                      <span className="text-muted-foreground tabular-nums">{i + 1}.</span> {v.name}
                    </span>
                    <span className="tabular-nums">
                      {formatPrice(v.gmvMinor, report.currency)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <CardTitle>Top products (lifetime)</CardTitle>
          {report.topProducts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No paid orders yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-2" scope="col">Product</th>
                  <th className="py-2 text-right" scope="col">Units</th>
                  <th className="py-2 text-right" scope="col">GMV</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.topProducts.map((p) => (
                  <tr key={String(p.productId)}>
                    <td className="py-2">{p.title}</td>
                    <td className="py-2 text-right tabular-nums">{p.unitsSold}</td>
                    <td className="py-2 text-right tabular-nums">
                      {formatPrice(p.gmvMinor, report.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <div className="rounded-2xl border border-border bg-white p-5">
        <p className="text-sm text-muted-foreground">
          Need raw data?{' '}
          <Button asChild variant="link" className="px-0 text-sm">
            <Link href="/api/admin/payouts/export.csv">Payouts CSV</Link>
          </Button>{' '}
          ·{' '}
          <Button asChild variant="link" className="px-0 text-sm">
            <Link href="/admin/collections/orders">Open orders in admin</Link>
          </Button>
        </p>
      </div>
    </div>
  )
}

function Stat({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  accent?: boolean
}) {
  return (
    <Card className={accent ? 'border-accent-300 bg-accent-50/50' : undefined}>
      <CardContent className="space-y-1 pt-6">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <span className="text-brand-700">{icon}</span>
          {label}
        </div>
        <p className="font-display text-2xl font-semibold tracking-tight tabular-nums">
          {value}
        </p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  )
}
