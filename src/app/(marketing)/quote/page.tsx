import type { Metadata } from 'next'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Badge } from '@/components/ui/badge'
import { StandaloneQuoteForm } from '@/components/quote/standalone-quote-form'
import { getProductBySlug } from '@/lib/queries/products'
import { getCurrentUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Request a quote',
  description:
    'Get a custom quote on bulk orders, wholesale or specialty imports from Bangarah Trading.',
  alternates: { canonical: '/quote' },
}

type SearchParams = Promise<{ product?: string }>

export default async function QuotePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const product = sp.product ? ((await getProductBySlug(sp.product)) as any) : null
  const user = await getCurrentUser()

  return (
    <section className="py-16">
      <Container size="md" className="space-y-6">
        <header className="space-y-3">
          <Badge variant="spice">B2B / wholesale</Badge>
          <h1 className="font-display text-5xl font-semibold tracking-tight">
            Request a quote
          </h1>
          <p className="text-lg text-muted-foreground">
            Bulk orders, wholesale pricing and import enquiries get a same-day response on
            business days. Already have items in your cart marked for quote?{' '}
            <Link
              href="/cart"
              className="font-medium text-brand-700 underline-offset-4 hover:underline"
            >
              Submit them from the cart
            </Link>
            .
          </p>
        </header>

        <StandaloneQuoteForm
          productSlug={product?.slug}
          productTitle={product?.title}
          defaultName={user?.name ?? ''}
          defaultEmail={user?.email ?? ''}
          hasSignedInUser={!!user}
        />
      </Container>
    </section>
  )
}
