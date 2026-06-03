import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Container } from '@/components/ui/container'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getCurrentUser } from '@/lib/auth'
import { getPayload, safe } from '@/lib/payload'
import { formatPrice, formatDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Your orders',
  robots: { index: false, follow: false },
}

export default async function MyOrdersPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/sign-in?next=/account/orders')

  const result = await safe(async () => {
    const payload = await getPayload()
    const { docs } = await payload.find({
      collection: 'orders',
      where: { customer: { equals: user.id } },
      sort: '-createdAt',
      limit: 50,
      depth: 0,
      // B42 fix: getPayload() has no req context, so without overrideAccess
      // the access rules deny everything. We manually scope by customer
      // above — same trust boundary as before, just made explicit.
      overrideAccess: true,
    })
    return docs
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orders: any[] = result.ok ? (result.data as any[]) : []

  return (
    <section className="py-16">
      <Container size="md" className="space-y-8">
        <header>
          <h1 className="font-display text-4xl font-semibold tracking-tight">Your orders</h1>
        </header>

        {orders.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-muted/40 p-12 text-center">
            <p className="text-muted-foreground">You haven&apos;t placed any orders yet.</p>
            <div className="mt-6">
              <Button asChild variant="primary">
                <Link href="/shop">Start shopping</Link>
              </Button>
            </div>
          </div>
        ) : (
          <ul className="space-y-4">
            {orders.map((o) => (
              <li
                key={o.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-white p-5 shadow-sm"
              >
                <div>
                  <Link
                    href={`/orders/${o.orderNumber}`}
                    className="font-semibold hover:text-brand-700"
                  >
                    {o.orderNumber}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(o.createdAt)} ·{' '}
                    {o.lineItems?.length ?? 0} item{(o.lineItems?.length ?? 0) === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge>{String(o.status).replace(/_/g, ' ')}</Badge>
                  <span className="font-semibold tabular-nums">
                    {formatPrice(o.totalMinor, o.currency)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Container>
    </section>
  )
}
