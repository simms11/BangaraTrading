import type { Metadata } from 'next'
import Link from 'next/link'
import { Container } from '@/components/ui/container'

export const metadata: Metadata = {
  title: 'Help center',
  description: 'Customer support contacts and common questions.',
  alternates: { canonical: '/help' },
}

/**
 * K5 (round-5 privacy M4) — stub for the previously-dead footer link.
 * Replace with a real help/FAQ system once content stabilises.
 */
export default function HelpCenterPage() {
  return (
    <article className="py-12">
      <Container size="md" className="space-y-6">
        <header>
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            Help center
          </h1>
          <p className="mt-2 text-muted-foreground">
            How to reach us, and where to find answers.
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="font-display text-xl font-semibold">Contact</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Sales / general enquiries:{' '}
              <a className="underline" href="mailto:enquiry@bangarahtradingenterprises.com">
                enquiry@bangarahtradingenterprises.com
              </a>
            </li>
            <li>
              Urgent / emergency: <span className="tabular-nums">+264 813 416 764</span>
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-xl font-semibold">Quick links</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <Link href="/shipping" className="underline">Shipping &amp; returns</Link>
            </li>
            <li>
              <Link href="/terms" className="underline">Terms of service</Link>
            </li>
            <li>
              <Link href="/privacy" className="underline">Privacy policy</Link>
            </li>
            <li>
              <Link href="/account/orders" className="underline">Track an order</Link>{' '}
              (sign in required)
            </li>
            <li>
              <Link href="/quote" className="underline">Request a bulk quote</Link>
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-xl font-semibold">Common questions</h2>
          <p>
            <strong>How do I track my order?</strong> If you have an account,
            visit <Link href="/account/orders" className="underline">your orders</Link>.
            Guest checkouts get a link in their confirmation email.
          </p>
          <p>
            <strong>Do you ship internationally?</strong> Yes, when EasyPost
            is enabled and we serve your destination. Costs are shown at
            checkout.
          </p>
          <p>
            <strong>How do I delete my account?</strong> Visit{' '}
            <Link href="/account" className="underline">your account page</Link>{' '}
            — there is a self-service deletion option. Order history is
            retained for 7 years (financial-record compliance) but
            personal details are anonymised immediately.
          </p>
        </section>
      </Container>
    </article>
  )
}
