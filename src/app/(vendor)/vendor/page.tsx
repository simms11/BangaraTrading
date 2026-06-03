import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  Package,
  ShoppingBag,
  Wallet,
  TrendingUp,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardTitle } from '@/components/ui/card'
import { getCurrentUser } from '@/lib/auth'
import { getVendorById, getVendorStats } from '@/lib/queries/vendor-dashboard'
import { formatPrice } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Vendor dashboard',
  robots: { index: false, follow: false },
}

const statusVariant: Record<string, 'default' | 'accent' | 'spice'> = {
  pending: 'accent',
  active: 'default',
  paused: 'accent',
  banned: 'spice',
}

export default async function VendorDashboardPage() {
  const user = await getCurrentUser()
  if (!user?.vendor) {
    redirect('/sign-in?next=/vendor')
  }
  const vendorId =
    typeof user.vendor === 'object'
      ? (user.vendor as { id: number | string }).id
      : (user.vendor as number | string)

  const [vendor, stats] = await Promise.all([getVendorById(vendorId), getVendorStats(vendorId)])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v: any = vendor

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {v?.name ?? 'Your storefront'}
          </h1>
          {v?.status && (
            <Badge variant={statusVariant[v.status] ?? 'default'} className="mt-2">
              {v.status === 'pending'
                ? 'Pending review'
                : v.status[0].toUpperCase() + v.status.slice(1)}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {v?.slug && v.status === 'active' && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/vendors/${v.slug}`}>View public storefront</Link>
            </Button>
          )}
          <Button asChild variant="primary" size="sm">
            <Link href="/admin/collections/products/create">Add a product</Link>
          </Button>
        </div>
      </header>

      {v?.status === 'pending' && (
        <div className="rounded-2xl border border-accent-200 bg-accent-50 p-5 text-sm text-accent-900">
          Your application is under review. You can prepare your catalog in admin and we&apos;ll
          publish your storefront as soon as your account is approved.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Package className="h-5 w-5" aria-hidden />}
          label="Products"
          value={String(stats.productCount)}
          sub={`${stats.publishedProductCount} published`}
        />
        <StatCard
          icon={<ShoppingBag className="h-5 w-5" aria-hidden />}
          label="Paid orders"
          value={String(stats.paidOrderCount)}
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5" aria-hidden />}
          label="Lifetime sales"
          value={formatPrice(stats.paidGmvMinor, stats.currency)}
        />
        <StatCard
          icon={<Wallet className="h-5 w-5" aria-hidden />}
          label="Payout owed"
          value={formatPrice(stats.outstandingPayoutMinor, stats.currency)}
          sub={`${formatPrice(stats.paidOutMinor, stats.currency)} paid out`}
          accent={stats.outstandingPayoutMinor > 0}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-3 pt-6">
            <CardTitle>Manage your catalog</CardTitle>
            <p className="text-sm text-muted-foreground">
              Add, edit, or archive products via the Bangarah admin. Stock levels and product
              status changes go live immediately on your storefront.
            </p>
            <div className="flex gap-2">
              <Button asChild variant="primary" size="sm">
                <Link href="/vendor/products">View your products</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/collections/products">Open admin</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3 pt-6">
            <CardTitle>Get paid</CardTitle>
            <p className="text-sm text-muted-foreground">
              Bangarah collects payment from customers and pays vendors on a regular schedule.
              Update your bank details in settings.
            </p>
            <div className="flex gap-2">
              <Button asChild variant="primary" size="sm">
                <Link href="/vendor/payouts">View payouts</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/vendor/settings">Settings</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function StatCard({
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
        <p className="font-display text-2xl font-semibold tracking-tight">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  )
}
