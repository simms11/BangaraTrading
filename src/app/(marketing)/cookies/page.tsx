import type { Metadata } from 'next'
import { Container } from '@/components/ui/container'

export const metadata: Metadata = {
  title: 'Cookie policy',
  description: 'Which cookies Bangarah uses, why, and how to manage them.',
  alternates: { canonical: '/cookies' },
}

const updated = '2026-05-16'

export default function CookiesPage() {
  return (
    <article className="py-16">
      <Container size="md" className="prose prose-lg max-w-none">
        <header className="not-prose mb-10 space-y-2">
          <p className="text-sm uppercase tracking-wide text-muted-foreground">
            Last updated {updated}
          </p>
          <h1 className="font-display text-5xl font-semibold tracking-tight">
            Cookie policy
          </h1>
        </header>

        <p>
          We use cookies and similar storage mechanisms to operate the marketplace. The banner
          you saw on your first visit lets you accept all cookies, save preferences, or use
          necessary cookies only.
        </p>

        <h2>Necessary cookies (always on)</h2>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Purpose</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>payload-token</code></td>
              <td>Keeps you signed in across requests.</td>
              <td>7 days</td>
            </tr>
            <tr>
              <td><code>bangarah_cart</code></td>
              <td>Remembers your cart between visits.</td>
              <td>30 days</td>
            </tr>
            <tr>
              <td><code>bangarah_cookie_consent_v1</code></td>
              <td>Stores your cookie choice so we don&apos;t ask again.</td>
              <td>12 months (localStorage)</td>
            </tr>
          </tbody>
        </table>

        <h2>Analytics (opt-in)</h2>
        <p>
          When you opt in, PostHog records anonymous usage stats so we can understand which
          products and pages perform best. No personal data is sold or used for advertising. You
          can withdraw consent at any time by clearing your browser&apos;s site data for this
          domain — the banner will reappear on the next visit and you can choose again.
        </p>

        <h2>Third parties</h2>
        <p>
          Stripe and Flutterwave checkout pages may set their own cookies on their domains
          (used for fraud prevention and to complete payment). These are out of our direct
          control; please review their respective cookie policies.
        </p>

        <h2>Doing without cookies</h2>
        <p>
          You can sign in without remembering cookies by using a private/incognito window. If
          you block all cookies entirely, the marketplace will still let you browse, but
          you&apos;ll be unable to keep a cart, stay signed in, or check out.
        </p>
      </Container>
    </article>
  )
}
