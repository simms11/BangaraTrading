import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { ShoppingBag, MessageSquare } from 'lucide-react'
import { Container } from '@/components/ui/container'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { LineItemRow } from '@/components/cart/line-item-row'
import { SubmitQuoteForm } from '@/components/quote/submit-quote-form'
import { readReconciledCart } from '@/lib/cart/store'
import { computeTotals } from '@/lib/cart/types'
import { formatPrice } from '@/lib/utils'
import { getCurrentUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Your cart',
  alternates: { canonical: '/cart' },
}

export default async function CartPage() {
  const [{ cart, dropped, repriced }, user, jar] = await Promise.all([
    readReconciledCart(),
    getCurrentUser(),
    cookies(),
  ])
  // R10 — surface a "continue checkout" banner when a recent placeOrder
  // dropped the pending-order cookie (checkout-actions.ts:285). The
  // cookie was set but never read; this is the consumer.
  //
  // R11 — verify the cookie still corresponds to a pending_payment
  // order before rendering the banner. The /orders/{n} page clears the
  // cookie on settled orders, but a customer who never visited it (e.g.
  // closed the browser mid-Stripe-redirect) could still see a stale
  // banner for a paid/cancelled order until the 45-min cookie expiry.
  let pendingOrder: { n: string; c?: string; a?: number } | null = null
  try {
    const raw = jar.get('pending-order')?.value
    if (raw) {
      const parsed = JSON.parse(raw) as { n?: string; c?: string; a?: number }
      if (parsed?.n && typeof parsed.n === 'string') {
        const { findOrderByNumber } = await import('@/lib/orders')
        const live = await findOrderByNumber(parsed.n)
        if (live && live.status === 'pending_payment') {
          pendingOrder = { n: parsed.n, c: parsed.c, a: parsed.a }
        }
      }
    }
  } catch {
    // malformed cookie or DB hiccup — ignore (no banner)
  }
  const totals = computeTotals(cart)
  const retailItems = cart.items.filter((i) => i.fulfillmentMode !== 'quote')
  const quoteItems = cart.items.filter((i) => i.fulfillmentMode === 'quote')
  const hasItems = cart.items.length > 0

  return (
    <section className="py-16">
      <Container className="space-y-8">
        {dropped.length > 0 && (
          <div className="rounded-2xl border border-spice-200 bg-spice-50 p-4 text-sm text-spice-900">
            We removed {dropped.length === 1 ? 'an item' : `${dropped.length} items`} from your
            cart that are no longer available: {dropped.join(', ')}.
          </div>
        )}
        {repriced.length > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Heads up — the price changed for {repriced.length === 1 ? 'an item' : `${repriced.length} items`} in
            your cart: {repriced.join(', ')}. Your total below reflects the current price.
          </div>
        )}
        {pendingOrder && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-200 bg-brand-50/60 p-4 text-sm">
            <div>
              <p className="font-medium text-brand-900">
                Need to finish paying for order {pendingOrder.n}?
              </p>
              <p className="text-muted-foreground">
                {pendingOrder.a && pendingOrder.c
                  ? `${formatPrice(pendingOrder.a, pendingOrder.c)} · `
                  : ''}
                We&apos;ll show your order status and let you retry payment.
              </p>
            </div>
            <Button asChild variant="primary">
              <Link href={`/orders/${pendingOrder.n}`}>Continue checkout</Link>
            </Button>
          </div>
        )}
        <h1 className="font-display text-4xl font-semibold tracking-tight">Your cart</h1>

        {!hasItems ? (
          <EmptyCart />
        ) : (
          <div className="grid gap-10 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-10">
              {retailItems.length > 0 && (
                <div>
                  <h2 className="flex items-center gap-2 font-display text-2xl font-semibold">
                    <ShoppingBag className="h-5 w-5 text-brand-700" aria-hidden /> Retail items
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    These items check out via card and ship as soon as payment clears.
                  </p>
                  <ul className="mt-4">
                    {retailItems.map((line) => (
                      <LineItemRow key={String(line.productId)} line={line} />
                    ))}
                  </ul>
                </div>
              )}

              {quoteItems.length > 0 && (
                <div>
                  <h2 className="flex items-center gap-2 font-display text-2xl font-semibold">
                    <MessageSquare className="h-5 w-5 text-spice-700" aria-hidden /> Quote items
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Bulk/wholesale items get a vendor quote before they ship. Submit the form
                    below and we&apos;ll respond with pricing + lead time.
                  </p>
                  <ul className="mt-4">
                    {quoteItems.map((line) => (
                      <LineItemRow key={String(line.productId)} line={line} />
                    ))}
                  </ul>
                  <div className="mt-6 rounded-2xl border border-border bg-white p-6 shadow-sm">
                    <h3 className="font-display text-lg font-semibold">Submit quote request</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Tell us where you are and any specifics. Same-day response on business
                      days.
                    </p>
                    <div className="mt-4">
                      <SubmitQuoteForm
                        defaultName={user?.name ?? ''}
                        defaultEmail={user?.email ?? ''}
                        hasSignedInUser={!!user}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <aside className="lg:col-span-1">
              <div className="sticky top-24 space-y-4 rounded-2xl border border-border bg-white p-6 shadow-sm">
                <h2 className="font-display text-xl font-semibold">Order summary</h2>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt>Items</dt>
                    <dd className="tabular-nums">{totals.itemCount}</dd>
                  </div>
                  {retailItems.length > 0 && (
                    <div className="flex justify-between">
                      <dt>Retail subtotal</dt>
                      <dd className="tabular-nums">
                        {formatPrice(totals.retailSubtotalMinor, totals.currency || 'NAD')}
                      </dd>
                    </div>
                  )}
                  {quoteItems.length > 0 && (
                    <div className="flex justify-between">
                      <dt>Quote subtotal (est.)</dt>
                      <dd className="tabular-nums">
                        {formatPrice(totals.quoteSubtotalMinor, totals.currency || 'NAD')}
                      </dd>
                    </div>
                  )}
                  <div className="border-t border-border pt-2 flex justify-between font-semibold">
                    <dt>Subtotal</dt>
                    <dd className="tabular-nums">
                      {formatPrice(totals.totalMinor, totals.currency || 'NAD')}
                    </dd>
                  </div>
                </dl>
                <p className="text-xs text-muted-foreground">
                  Shipping and tax calculated at checkout.
                </p>
                {retailItems.length > 0 ? (
                  <Button asChild variant="primary" size="lg" className="w-full">
                    <Link href="/checkout">Proceed to checkout</Link>
                  </Button>
                ) : (
                  <Badge variant="spice" className="w-full justify-center py-2">
                    Quote-only cart — submit the form on the left
                  </Badge>
                )}
                <Button asChild variant="link" className="w-full">
                  <Link href="/shop">Continue shopping</Link>
                </Button>
              </div>
            </aside>
          </div>
        )}
      </Container>
    </section>
  )
}

function EmptyCart() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-muted/40 p-12 text-center">
      <ShoppingBag className="mx-auto h-10 w-10 text-brand-300" aria-hidden />
      <h2 className="mt-4 font-display text-2xl font-semibold">Your cart is empty</h2>
      <p className="mt-2 text-muted-foreground">
        Browse the marketplace and add a few items to get started.
      </p>
      <div className="mt-6">
        <Button asChild variant="primary">
          <Link href="/shop">Shop the marketplace</Link>
        </Button>
      </div>
    </div>
  )
}
