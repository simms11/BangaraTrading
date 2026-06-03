import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Container } from '@/components/ui/container'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getCurrentUser } from '@/lib/auth'
import { getPayload, safe } from '@/lib/payload'
import { formatDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Your quotes',
  robots: { index: false, follow: false },
}

const statusLabel: Record<string, string> = {
  submitted: 'Submitted',
  reviewing: 'Under review',
  quoted: 'Quote ready',
  accepted: 'Accepted',
  declined: 'Declined',
  converted: 'Converted',
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

export default async function MyQuotesPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/sign-in?next=/account/quotes')

  const result = await safe(async () => {
    const payload = await getPayload()
    const { docs } = await payload.find({
      collection: 'quotes',
      where: { customer: { equals: user.id } },
      sort: '-createdAt',
      limit: 50,
      depth: 0,
      // Same as /account/orders — manual scope + overrideAccess because
      // getPayload() runs without a req context.
      overrideAccess: true,
    })
    return docs
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const quotes: any[] = result.ok ? (result.data as any[]) : []

  return (
    <section className="py-16">
      <Container size="md" className="space-y-8">
        <header>
          <h1 className="font-display text-4xl font-semibold tracking-tight">Your quotes</h1>
        </header>

        {quotes.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-muted/40 p-12 text-center">
            <p className="text-muted-foreground">
              You haven&apos;t requested any quotes yet.
            </p>
            <div className="mt-6">
              <Button asChild variant="primary">
                <Link href="/quote">Request a quote</Link>
              </Button>
            </div>
          </div>
        ) : (
          <ul className="space-y-4">
            {quotes.map((q) => (
              <li
                key={q.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-white p-5 shadow-sm"
              >
                <div>
                  <Link
                    href={`/quotes/${q.quoteNumber}`}
                    className="font-semibold hover:text-brand-700"
                  >
                    {q.quoteNumber}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(q.createdAt)} ·{' '}
                    {q.items?.length ?? 0} item{(q.items?.length ?? 0) === 1 ? '' : 's'}
                  </p>
                </div>
                <Badge variant={statusVariant[q.status] ?? 'default'}>
                  {statusLabel[q.status] ?? q.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Container>
    </section>
  )
}
