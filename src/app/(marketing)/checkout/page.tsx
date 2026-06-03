import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Button } from '@/components/ui/button'
import { CheckoutForm } from '@/components/checkout/checkout-form'
import { readReconciledCart } from '@/lib/cart/store'
import { computeTotals } from '@/lib/cart/types'
import { getCurrentUser } from '@/lib/auth'
import { listConfiguredProcessors } from '@/lib/payments'
import { formatPrice } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Checkout',
  alternates: { canonical: '/checkout' },
  robots: { index: false, follow: false },
}

export default async function CheckoutPage() {
  const { cart } = await readReconciledCart()
  const retailItems = cart.items.filter((i) => i.fulfillmentMode !== 'quote')
  if (retailItems.length === 0) redirect('/cart')

  const user = await getCurrentUser()
  const totals = computeTotals(cart)
  const processors = listConfiguredProcessors()

  return (
    <section className="py-16">
      <Container className="grid gap-10 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <header className="mb-8">
            <h1 className="font-display text-4xl font-semibold tracking-tight">Checkout</h1>
            {user ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Signed in as {user.email}.
              </p>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                Have an account?{' '}
                <Link
                  href="/sign-in?next=/checkout"
                  className="font-medium text-brand-700 underline-offset-4 hover:underline"
                >
                  Sign in
                </Link>{' '}
                to check out faster.
              </p>
            )}
          </header>
          <CheckoutForm
            availableProcessors={processors}
            defaultEmail={user?.email ?? ''}
            hasSignedInUser={!!user}
          />
        </div>

        <aside className="lg:col-span-1">
          <div className="sticky top-24 space-y-4 rounded-2xl border border-border bg-white p-6 shadow-sm">
            <h2 className="font-display text-xl font-semibold">Order summary</h2>
            <ul className="divide-y divide-border">
              {retailItems.map((line) => (
                <li key={String(line.productId)} className="flex justify-between gap-3 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="line-clamp-2 font-medium">{line.title}</p>
                    <p className="text-xs text-muted-foreground">Qty {line.quantity}</p>
                  </div>
                  <span className="shrink-0 tabular-nums">
                    {formatPrice(line.unitPriceMinor * line.quantity, line.currency)}
                  </span>
                </li>
              ))}
            </ul>
            <dl className="space-y-2 border-t border-border pt-4 text-sm">
              <div className="flex justify-between">
                <dt>Subtotal</dt>
                <dd className="tabular-nums">
                  {formatPrice(totals.retailSubtotalMinor, totals.currency || 'NAD')}
                </dd>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <dt>Shipping</dt>
                <dd>Selected on left</dd>
              </div>
              {/* R8 frontend M7 — the second row was mislabelled
                  "Subtotal" (identical to the first) and shipping was
                  excluded from the total, so the number jumped at the
                  payment processor. Relabel as "Total before shipping"
                  and state that shipping is added at payment, since the
                  exact shipping amount depends on the method chosen on
                  the left (which lives in client state). */}
              <div className="flex justify-between border-t border-border pt-2 font-semibold">
                <dt>Total before shipping</dt>
                <dd className="tabular-nums">
                  {formatPrice(totals.retailSubtotalMinor, totals.currency || 'NAD')}
                </dd>
              </div>
              <p className="text-xs text-muted-foreground">
                Shipping is added based on the method you select, and your
                final total is shown on the secure payment page before you
                confirm.
              </p>
            </dl>
            <Button asChild variant="link" className="w-full">
              <Link href="/cart">Back to cart</Link>
            </Button>
          </div>
        </aside>
      </Container>
    </section>
  )
}
