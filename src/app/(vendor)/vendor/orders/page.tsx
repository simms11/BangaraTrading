import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getCurrentUser } from '@/lib/auth'
import { listVendorOrders } from '@/lib/queries/vendor-dashboard'
import { formatPrice, formatDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Your orders',
  robots: { index: false, follow: false },
}

const statusVariant: Record<string, 'default' | 'accent' | 'spice'> = {
  pending_payment: 'accent',
  paid: 'default',
  processing: 'default',
  shipped: 'default',
  delivered: 'default',
  cancelled: 'spice',
  refunded: 'spice',
  disputed: 'spice',
}

export default async function VendorOrdersPage() {
  const user = await getCurrentUser()
  if (!user?.vendor) redirect('/sign-in?next=/vendor/orders')
  const vendorId =
    typeof user.vendor === 'object'
      ? (user.vendor as { id: number | string }).id
      : (user.vendor as number | string)
  const orders = await listVendorOrders(vendorId)

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Orders</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Orders containing one or more of your products. Bangarah collects payment and handles
          fulfillment dispatch — you receive payouts on a regular schedule.
        </p>
      </header>

      {orders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-white p-10 text-center text-muted-foreground">
          No orders yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3" scope="col">Order</th>
                <th className="px-4 py-3" scope="col">Status</th>
                <th className="px-4 py-3" scope="col">Placed</th>
                <th className="px-4 py-3 text-right" scope="col">Your share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {(orders as any[]).map((o) => {
                const myShareMinor =
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (o.lineItems ?? []).reduce((acc: number, li: any) => {
                    const liVendor = typeof li.vendor === 'object' ? li.vendor?.id : li.vendor
                    return String(liVendor) === String(vendorId)
                      ? acc + (li.lineTotalMinor ?? 0)
                      : acc
                  }, 0)
                return (
                  <tr key={o.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{o.orderNumber}</td>
                    <td className="px-4 py-3">
                      <Badge variant={statusVariant[o.status] ?? 'default'}>
                        {String(o.status).replace(/_/g, ' ')}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDate(o.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatPrice(myShareMinor, o.currency)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-muted/30 p-5 text-sm text-muted-foreground">
        Need fulfillment details (shipping label, customer address)?{' '}
        <Button asChild variant="link" className="px-0 text-sm">
          <Link href="/admin/collections/orders">Open in admin</Link>
        </Button>
      </div>
    </div>
  )
}
