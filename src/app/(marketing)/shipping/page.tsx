import type { Metadata } from 'next'
import Link from 'next/link'
import { Container } from '@/components/ui/container'

export const metadata: Metadata = {
  title: 'Shipping & returns',
  description:
    'Bangarah Trading shipping rates, delivery windows, and returns policy.',
  alternates: { canonical: '/shipping' },
}

/**
 * K5 (round-5 privacy M4) — stub for the previously-dead footer link.
 * Content sourced from /terms § 4 (returns) and the public shipping
 * methods exposed via the cart's shipping picker. Replace with a
 * marketing-owned page once the catalog stabilises.
 */
export default function ShippingAndReturnsPage() {
  return (
    <article className="py-12">
      <Container size="md" className="space-y-6">
        <header>
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            Shipping &amp; returns
          </h1>
          <p className="mt-2 text-muted-foreground">
            How we ship and what to do if your order doesn&apos;t arrive as
            expected.
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="font-display text-xl font-semibold">Shipping methods</h2>
          <p>
            We offer pickup from our Okahandja warehouse free of charge, plus
            paid shipping via local carriers (within Namibia) and EasyPost
            (international, when configured). Cost and lead time are shown
            on the checkout page based on your destination.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-xl font-semibold">Returns</h2>
          <p>
            See <Link href="/terms" className="underline">our terms</Link>{' '}
            §4 for the full returns policy. Short version: contact{' '}
            <a className="underline" href="mailto:enquiry@bangarahtradingenterprises.com">
              enquiry@bangarahtradingenterprises.com
            </a>{' '}
            within 14 days of delivery with your order number and we&apos;ll
            arrange return shipping or a replacement.
          </p>
        </section>
      </Container>
    </article>
  )
}
