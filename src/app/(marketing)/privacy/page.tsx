import type { Metadata } from 'next'
import { Container } from '@/components/ui/container'

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: 'How Bangarah Trading Enterprises handles your personal data.',
  alternates: { canonical: '/privacy' },
}

const updated = '2026-05-16'

export default function PrivacyPolicyPage() {
  return (
    <article className="py-16">
      <Container size="md" className="prose prose-lg max-w-none">
        <header className="not-prose mb-10 space-y-2">
          <p className="text-sm uppercase tracking-wide text-muted-foreground">
            Last updated {updated}
          </p>
          <h1 className="font-display text-5xl font-semibold tracking-tight">
            Privacy policy
          </h1>
        </header>

        <h2>Who we are</h2>
        <p>
          Bangarah Trading Enterprises CC (&ldquo;Bangarah&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) is a
          Close Corporation registered in Namibia, operating a marketplace at
          bangarahtradingenterprises.com. Our registered address is Unit 8, Omumbonde
          Industrial Park Extension, Okahandja, Namibia.
        </p>

        <h2>Scope</h2>
        <p>
          This policy explains what personal data we collect, why we collect it, how we use it,
          who we share it with, and your rights. It applies to the Bangarah storefront, vendor
          dashboard, and Bangarah-managed support channels.
        </p>

        <h2>Data we collect</h2>
        <ul>
          <li>
            <strong>Account data:</strong> name, email, password hash, role (customer / vendor /
            admin), phone (optional).
          </li>
          <li>
            <strong>Order data:</strong> shipping and billing addresses, items purchased,
            payment method (last 4 digits / processor ref — we never see full card numbers),
            order history.
          </li>
          <li>
            <strong>Quote data:</strong> business contact details and the message you submit
            when requesting a quote.
          </li>
          <li>
            <strong>Vendor data:</strong> business profile, bank details (encrypted at rest,
            admin-readable only), commission rate, payout history.
          </li>
          <li>
            <strong>Operational data:</strong> server logs (IP address, user agent, request
            path), error traces (via Sentry), product analytics (via PostHog,{' '}
            <em>only with your consent</em>).
          </li>
          <li>
            <strong>Cookies:</strong> a <code>payload-token</code> cookie keeps you signed in;
            a <code>bangarah_cart</code> cookie remembers your cart; <code>bangarah_cookie_consent_v1</code>
            stores your cookie preferences.
          </li>
        </ul>

        <h2>Why we use it</h2>
        <ul>
          <li>Processing orders, payments, quotes, and refunds.</li>
          <li>Communicating about your account, orders, and quotes (transactional email).</li>
          <li>Operating the marketplace (fulfillment, vendor payouts, dispute resolution).</li>
          <li>Security, fraud prevention, and meeting accounting / tax obligations.</li>
          <li>
            With your consent, anonymous product analytics to understand which categories and
            pages perform best. You can withdraw consent at any time from{' '}
            <a href="/cookies">/cookies</a>.
          </li>
        </ul>

        <h2>Lawful basis</h2>
        <p>
          We process personal data on the basis of <strong>contract performance</strong> (your
          order, your vendor agreement), <strong>legitimate interest</strong> (security, fraud
          prevention, service operation), <strong>legal obligation</strong> (tax records), and{' '}
          <strong>consent</strong> (analytics, marketing emails). These map to the corresponding
          bases under Namibia&apos;s Data Protection Bill, the South African POPIA, and the EU
          GDPR for diaspora customers.
        </p>

        <h2>Who we share it with</h2>
        <ul>
          <li>
            <strong>Payment processors</strong> (Stripe, Flutterwave) — for card and mobile
            money payments. They are independent controllers of the data they receive.
          </li>
          <li>
            <strong>Carriers</strong> (EasyPost-integrated couriers, DHL, Aramex, etc.) —
            shipping addresses and parcel details for delivery.
          </li>
          <li>
            <strong>Vendors</strong> — name, shipping address, and items of each order are
            shared with the vendor whose products are in the order, so they can fulfill.
          </li>
          <li>
            <strong>Email service</strong> (Resend) — to deliver transactional email.
          </li>
          <li>
            <strong>Infrastructure</strong> (Vercel for the site, Neon for the database,
            Cloudflare R2 for images, Sentry for errors, PostHog for analytics).
          </li>
          <li>
            <strong>Lawful disclosures</strong> — courts, regulators, or law enforcement when
            required by law.
          </li>
        </ul>
        <p>We never sell your personal data.</p>

        <h2>How long we keep it</h2>
        <ul>
          <li>Account data: while your account is active + 12 months.</li>
          <li>Orders, refunds, and tax-relevant records: 7 years (Namibian Income Tax Act).</li>
          <li>Quote enquiries: 2 years.</li>
          <li>Server / error logs: 30 days rolling.</li>
        </ul>

        <h2>Your rights</h2>
        <p>
          You have the right to access, correct, delete, port, and restrict processing of your
          personal data, and to object to processing or withdraw consent at any time. Email{' '}
          <a href="mailto:enquiry@bangarahtradingenterprises.com">
            enquiry@bangarahtradingenterprises.com
          </a>{' '}
          to exercise any of these. We respond within 30 days.
        </p>
        <p>
          If you&apos;re in South Africa, you also have the right to lodge a complaint with the
          Information Regulator (
          <a href="https://inforegulator.org.za/" target="_blank" rel="noreferrer noopener">
            inforegulator.org.za
          </a>
          ). EU/UK residents may contact their local data protection authority.
        </p>

        <h2>Security</h2>
        <p>
          Passwords are hashed with bcrypt. Payment card data never reaches our servers — it is
          handled directly by the payment processor on their PCI-DSS-compliant infrastructure.
          Bank details for vendor payouts are stored encrypted at rest and visible only to
          authorized admin users.
        </p>

        <h2>Changes</h2>
        <p>
          Material changes are announced via email to active accounts and the &ldquo;Last
          updated&rdquo; date at the top of this page is bumped.
        </p>
      </Container>
    </article>
  )
}
