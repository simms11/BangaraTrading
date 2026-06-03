import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CheckCircle2, Clock, RotateCcw } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { findOrderByNumber } from '@/lib/orders'
import { getCurrentUser } from '@/lib/auth'
import { getPayload, safe } from '@/lib/payload'
import { formatPrice, formatDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Order confirmation',
  robots: { index: false, follow: false },
}

type RouteParams = Promise<{ orderNumber: string }>
type SearchParams = Promise<{ processor?: string; session_id?: string; t?: string }>

/**
 * Constant-time token comparison so attackers can't probe valid tokens via
 * response-time side channels.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

export default async function OrderConfirmationPage({
  params,
  searchParams,
}: {
  params: RouteParams
  searchParams: SearchParams
}) {
  const { orderNumber } = await params
  const sp = await searchParams
  const order = await findOrderByNumber(orderNumber)
  if (!order) notFound()

  // Access gate. Legitimate viewers:
  //   1. The signed-in customer who owns the order
  //   2. Admin — sees all
  //   3. Vendor with at least one line item on the order (M4 fix)
  //   4. A guest who has the confirmationToken from the success URL
  const user = await getCurrentUser()
  const isOwner =
    user?.id != null &&
    String(user.id) ===
      String(typeof order.customer === 'object' ? order.customer?.id : order.customer)
  const isAdmin = user?.role === 'admin'
  // SECURITY (M4): previously `isStaff` short-circuited the gate for ANY
  // vendor regardless of whether they had a line on the order. A vendor
  // with a guessed/leaked order number could view customer addresses,
  // totals, and competitor vendors' line items. Now a vendor must own at
  // least one of the lineItems on this specific order.
  const vendorIdOnUser =
    user?.role === 'vendor' && user.vendor
      ? String(typeof user.vendor === 'object' ? user.vendor.id : user.vendor)
      : null
  const isOwningVendor =
    vendorIdOnUser != null &&
    (order.lineItems ?? []).some((l) => {
      const lvid = typeof l.vendor === 'object' ? (l.vendor as { id: number }).id : l.vendor
      return String(lvid) === vendorIdOnUser
    })
  const tokenOk =
    typeof sp.t === 'string' &&
    typeof order.confirmationToken === 'string' &&
    timingSafeEqual(sp.t, order.confirmationToken)
  // Single 404 for any unauthorized access — don't disclose whether the order
  // exists. Signed-in customers see their own orders; guests need the token
  // from the success URL; admins see all orders; vendors only see orders
  // that contain at least one of their products.
  if (!isOwner && !isAdmin && !isOwningVendor && !tokenOk) notFound()

  const isPaid = order.status === 'paid'
  const isManual = sp.processor === 'manual' || order.payment?.processor === 'manual'

  // R11 — clear the pending-order cookie once the customer reaches the
  // settled (or already-cancelled/refunded) order page. Without this the
  // /cart page would keep showing a stale "Need to finish paying" banner
  // for up to 45 min after the order was paid. The cookie is cleared
  // only for the matching order to avoid wiping a different pending one.
  if (order.status !== 'pending_payment') {
    try {
      const { cookies } = await import('next/headers')
      const jar = await cookies()
      const raw = jar.get('pending-order')?.value
      if (raw) {
        const parsed = JSON.parse(raw) as { n?: string }
        if (parsed?.n === order.orderNumber) {
          jar.delete('pending-order')
        }
      }
    } catch {
      // malformed cookie — ignore
    }
  }

  // Fetch refunds for this order so the customer sees the refund timeline.
  // The page-level access gate above already authorized this viewer; the
  // refunds query is system-context (no req on getPayload) so we override
  // access and scope manually to this specific order.
  const refundsResult = await safe(async () => {
    const payload = await getPayload()
    const { docs } = await payload.find({
      collection: 'refunds',
      where: { order: { equals: order.id } },
      sort: '-createdAt',
      limit: 20,
      depth: 0,
      overrideAccess: true,
    })
    return docs
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const refunds: any[] = refundsResult.ok ? (refundsResult.data as any[]) : []
  const completedRefundsMinor = refunds
    .filter((r) => r.status === 'completed')
    .reduce((acc, r) => acc + (r.amountMinor ?? 0), 0)

  return (
    <section className="py-16">
      <Container size="md" className="space-y-8">
        <header className="space-y-3 text-center">
          {isPaid ? (
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" aria-hidden />
          ) : (
            <Clock className="mx-auto h-12 w-12 text-accent-500" aria-hidden />
          )}
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            {isPaid ? 'Order confirmed' : 'Thanks — order received'}
          </h1>
          <p className="text-muted-foreground">
            Order <strong>{order.orderNumber}</strong>
          </p>
          <Badge variant={isPaid ? 'default' : 'accent'}>{order.status.replace(/_/g, ' ')}</Badge>
        </header>

        {isManual && !isPaid && (
          <div className="rounded-2xl border border-accent-200 bg-accent-50 p-6 text-accent-900">
            <h2 className="font-display text-xl font-semibold">Payment instructions</h2>
            <p className="mt-2">
              {process.env.MANUAL_PAYMENT_INSTRUCTIONS ||
                `Please transfer ${formatPrice(order.totalMinor, order.currency)} to the bank details we'll email you at ${order.guestEmail ?? 'your account email'}, referencing your order number ${order.orderNumber}. We'll ship as soon as funds clear.`}
            </p>
          </div>
        )}

        <div className="rounded-2xl border border-border bg-white p-6 shadow-sm">
          <h2 className="font-display text-xl font-semibold">Items</h2>
          <ul className="mt-4 divide-y divide-border">
            {(order.lineItems ?? []).map((l, idx) => (
              <li key={l.id ?? idx} className="flex justify-between py-3 text-sm">
                <span>
                  {l.titleSnapshot} × {l.quantity}
                </span>
                <span className="tabular-nums">
                  {formatPrice(l.lineTotalMinor, order.currency)}
                </span>
              </li>
            ))}
          </ul>
          <dl className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd className="tabular-nums">{formatPrice(order.subtotalMinor, order.currency)}</dd>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <dt>Shipping{order.fulfillment?.carrier ? ` · ${order.fulfillment.carrier}` : ''}</dt>
              <dd>{order.shippingMinor ? formatPrice(order.shippingMinor, order.currency) : '—'}</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-2 font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatPrice(order.totalMinor, order.currency)}</dd>
            </div>
            {completedRefundsMinor > 0 && (
              <div className="flex justify-between text-spice-800">
                <dt>Refunded</dt>
                <dd className="tabular-nums">
                  −{formatPrice(completedRefundsMinor, order.currency)}
                </dd>
              </div>
            )}
          </dl>
        </div>

        {refunds.length > 0 && (
          <div className="rounded-2xl border border-spice-200 bg-spice-50/40 p-6 text-spice-900">
            <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
              <RotateCcw className="h-5 w-5" aria-hidden /> Refunds
            </h2>
            <ul className="mt-3 divide-y divide-spice-200/60 text-sm">
              {refunds.map((r) => (
                <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <div>
                    <p className="font-medium">{r.reference}</p>
                    <p className="text-xs">
                      {String(r.reason).replace(/_/g, ' ')} ·{' '}
                      {formatDate(r.createdAt)}
                    </p>
                    {r.description && <p className="mt-1 text-xs">{r.description}</p>}
                  </div>
                  <div className="text-right">
                    <Badge variant={r.status === 'completed' ? 'default' : 'accent'}>
                      {r.status}
                    </Badge>
                    <p className="mt-1 tabular-nums">
                      {formatPrice(r.amountMinor ?? 0, r.currency || order.currency)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {order.shippingAddress && (
          <div className="rounded-2xl border border-border bg-white p-6 shadow-sm">
            <h2 className="font-display text-xl font-semibold">Ship to</h2>
            <address className="mt-3 not-italic text-sm leading-relaxed text-muted-foreground">
              {order.shippingAddress.name}
              <br />
              {order.shippingAddress.line1}
              {order.shippingAddress.line2 ? (
                <>
                  <br />
                  {order.shippingAddress.line2}
                </>
              ) : null}
              <br />
              {order.shippingAddress.city}
              {order.shippingAddress.region ? `, ${order.shippingAddress.region}` : ''}{' '}
              {order.shippingAddress.postalCode}
              <br />
              {order.shippingAddress.country}
            </address>
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button asChild variant="primary">
            <Link href="/shop">Continue shopping</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/account/orders">View your orders</Link>
          </Button>
        </div>
      </Container>
    </section>
  )
}
