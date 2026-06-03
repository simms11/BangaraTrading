import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { timingSafeEqual } from 'node:crypto'
import { CheckCircle2, Clock, MessageSquare } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Breadcrumb } from '@/components/site/breadcrumb'
import { AcceptQuoteForm } from '@/components/quote/accept-quote-form'
import { findQuoteByNumber } from '@/lib/quotes'
import { getCurrentUser } from '@/lib/auth'
import { formatPrice, formatDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Quote',
  robots: { index: false, follow: false },
}

type RouteParams = Promise<{ quoteNumber: string }>
type SearchParams = Promise<{ t?: string }>

/**
 * SECURITY (C2): constant-time token compare. The quote page used to leak
 * customer PII (email, items, message) to anyone holding the URL because
 * quote numbers are time-prefixed nanoid-6 and partially guessable. Now
 * a per-quote 32-char token (or signed-in ownership) is required.
 */
function tokensMatch(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) return false
  return timingSafeEqual(aBuf, bBuf)
}

const statusLabel: Record<string, string> = {
  submitted: 'Submitted · awaiting review',
  reviewing: 'Under review',
  quoted: 'Quote ready',
  accepted: 'Accepted',
  declined: 'Declined',
  converted: 'Converted to order',
  expired: 'Expired',
}

const statusVariant: Record<string, 'default' | 'accent' | 'spice'> = {
  submitted: 'default',
  reviewing: 'default',
  quoted: 'accent',
  accepted: 'accent',
  declined: 'spice',
  converted: 'accent',
  expired: 'spice',
}

export default async function QuoteDetailPage({
  params,
  searchParams,
}: {
  params: RouteParams
  searchParams: SearchParams
}) {
  const { quoteNumber } = await params
  const { t: tokenParam } = await searchParams
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const quote = (await findQuoteByNumber(quoteNumber)) as any
  if (!quote) notFound()

  // SECURITY (C2): the page is reachable by anyone with the URL, so we
  // gate access in one of two ways: a constant-time token match against
  // the per-quote `confirmationToken`, OR a signed-in user whose id
  // matches the quote's `customer`. Either succeeds → render. Otherwise
  // 404 (not 401 — don't disclose that the quote exists).
  //
  // H7 (M3): also gate vendor access by line ownership. Previously ANY
  // vendor with a guessed quote number could view customer PII — the
  // same mistake we fixed on the orders confirmation page (B72 M4).
  const user = await getCurrentUser()
  const quoteCustomerId =
    quote.customer && typeof quote.customer === 'object'
      ? (quote.customer as { id: number | string }).id
      : (quote.customer as number | string | undefined)
  const ownerMatch =
    quoteCustomerId != null && user?.id != null && String(quoteCustomerId) === String(user.id)
  const isAdmin = user?.role === 'admin'
  const vendorIdOnUser =
    user?.role === 'vendor' && user.vendor
      ? String(typeof user.vendor === 'object' ? user.vendor.id : user.vendor)
      : null
  const isOwningVendor =
    vendorIdOnUser != null &&
    ((quote.items ?? []) as Array<{ vendor?: number | { id: number } }>).some((l) => {
      const lvid = typeof l.vendor === 'object' && l.vendor != null ? l.vendor.id : l.vendor
      return String(lvid) === vendorIdOnUser
    })
  const tokenMatch = tokensMatch(tokenParam, quote.confirmationToken)
  if (!tokenMatch && !ownerMatch && !isAdmin && !isOwningVendor) notFound()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: any[] = quote.items ?? []
  const isQuoted = quote.status === 'quoted'
  const isConverted = quote.status === 'converted'
  const validUntil = quote.response?.validUntil ? new Date(quote.response.validUntil) : null
  const isExpired = validUntil ? validUntil < new Date() : false

  const totalMinor = isQuoted
    ? items.reduce((acc, l) => acc + (l.unitPriceQuoteMinor ?? 0) * l.quantity, 0)
    : 0

  return (
    <article className="py-12">
      <Container size="md" className="space-y-8">
        <Breadcrumb
          items={[
            { name: 'Quotes', href: '/account/quotes' },
            { name: quote.quoteNumber, href: `/quotes/${quote.quoteNumber}` },
          ]}
        />

        <header className="space-y-3 text-center">
          {isConverted ? (
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" aria-hidden />
          ) : isQuoted && !isExpired ? (
            <MessageSquare className="mx-auto h-12 w-12 text-brand-700" aria-hidden />
          ) : (
            <Clock className="mx-auto h-12 w-12 text-accent-500" aria-hidden />
          )}
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            Quote {quote.quoteNumber}
          </h1>
          <Badge variant={statusVariant[quote.status] ?? 'default'}>
            {statusLabel[quote.status] ?? quote.status}
          </Badge>
        </header>

        {!isQuoted && !isConverted && (
          <div className="rounded-2xl border border-border bg-muted/40 p-6 text-center text-sm text-muted-foreground">
            We&apos;ve received your request. Our team typically responds within one business day
            with pricing, lead time and shipping options. You&apos;ll get an email at{' '}
            <strong>{quote.customerEmail}</strong> when the quote is ready.
          </div>
        )}

        {isConverted && quote.convertedOrder && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-900">
            <p>This quote has been converted to an order.</p>
            <Button asChild variant="primary" size="sm" className="mt-3">
              <Link
                href={`/orders/${typeof quote.convertedOrder === 'object' ? quote.convertedOrder.orderNumber : ''}`}
              >
                View order
              </Link>
            </Button>
          </div>
        )}

        {quote.message && (
          <section>
            <h2 className="font-display text-lg font-semibold">Your request</h2>
            <p className="mt-2 whitespace-pre-wrap rounded-xl bg-muted/40 p-4 text-sm text-muted-foreground">
              {quote.message}
            </p>
          </section>
        )}

        <section className="rounded-2xl border border-border bg-white p-6 shadow-sm">
          <h2 className="font-display text-lg font-semibold">Items</h2>
          <ul className="mt-3 divide-y divide-border">
            {items.map((l, i) => (
              <li key={l.id ?? i} className="flex justify-between gap-3 py-3 text-sm">
                <div>
                  <p className="font-medium">{l.titleSnapshot}</p>
                  <p className="text-xs text-muted-foreground">Qty {l.quantity}</p>
                </div>
                {isQuoted && (
                  <div className="text-right">
                    <p className="tabular-nums">
                      {formatPrice(l.unitPriceQuoteMinor ?? 0, quote.currency || 'NAD')} ea
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {formatPrice(
                        (l.unitPriceQuoteMinor ?? 0) * l.quantity,
                        quote.currency || 'NAD',
                      )}
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {isQuoted && (
            <div className="mt-4 flex justify-between border-t border-border pt-4 font-semibold">
              <span>Total</span>
              <span className="tabular-nums">
                {formatPrice(quote.totalEstimateMinor ?? totalMinor, quote.currency || 'NAD')}
              </span>
            </div>
          )}
        </section>

        {isQuoted && quote.response?.message && (
          <section className="rounded-2xl border border-border bg-white p-6 shadow-sm">
            <h2 className="font-display text-lg font-semibold">Response</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
              {quote.response.message}
            </p>
            {validUntil && (
              <p className="mt-3 text-xs text-muted-foreground">
                Valid until {formatDate(validUntil)}
              </p>
            )}
          </section>
        )}

        {isQuoted && !isExpired && (ownerMatch || tokenMatch) && (
          // J2 (round-4 M2) — only render the accept-form (which leaks the
          // confirmationToken into a hidden input) when the viewer is the
          // customer or holds the URL token themselves. Vendors with line
          // ownership see the quote details for ops visibility but cannot
          // accept on the customer's behalf (which would otherwise hijack
          // the shipping address). Admin sees a separate admin UI.
          <section className="rounded-2xl border border-border bg-white p-6 shadow-sm">
            <h2 className="font-display text-2xl font-semibold">Accept &amp; checkout</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Confirm shipping details below. Accepting locks in the quoted pricing and creates
              your order.
            </p>
            <div className="mt-6">
              <AcceptQuoteForm
                quoteNumber={quote.quoteNumber}
                confirmationToken={tokenParam ?? quote.confirmationToken ?? ''}
              />
            </div>
          </section>
        )}
        {isQuoted && !isExpired && !ownerMatch && !tokenMatch && (isAdmin || isOwningVendor) && (
          <section className="rounded-2xl border border-border bg-muted/40 p-6 text-sm text-muted-foreground">
            View-only. Customer accepts via the per-quote URL emailed to them.
          </section>
        )}

        {isExpired && (
          <div className="rounded-2xl border border-spice-200 bg-spice-50 p-6 text-spice-900">
            <p>This quote has expired. Please request a fresh quote.</p>
            <Button asChild variant="primary" size="sm" className="mt-3">
              <Link href="/quote">Request a new quote</Link>
            </Button>
          </div>
        )}
      </Container>
    </article>
  )
}
