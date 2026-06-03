import type { Metadata } from 'next'
import { Container } from '@/components/ui/container'

export const metadata: Metadata = {
  title: 'Terms of service',
  description: 'The rules of using the Bangarah marketplace.',
  alternates: { canonical: '/terms' },
}

const updated = '2026-05-16'

export default function TermsPage() {
  return (
    <article className="py-16">
      <Container size="md" className="prose prose-lg max-w-none">
        <header className="not-prose mb-10 space-y-2">
          <p className="text-sm uppercase tracking-wide text-muted-foreground">
            Last updated {updated}
          </p>
          <h1 className="font-display text-5xl font-semibold tracking-tight">
            Terms of service
          </h1>
        </header>

        <h2>1. Who we are</h2>
        <p>
          Bangarah Trading Enterprises CC (registration number on file) is a Close Corporation
          registered under the Namibian Close Corporations Act. We operate the marketplace at
          bangarahtradingenterprises.com. By using the marketplace as a customer or vendor, you
          agree to these terms.
        </p>

        <h2>2. The marketplace model</h2>
        <p>
          Bangarah is the <strong>merchant of record</strong>. We collect payment from
          customers, hold customer relationships, and disburse net proceeds (less platform
          commission) to vendors on a regular payout schedule. Vendors fulfill orders, retain
          ownership of their products and brands, and are responsible for product quality and
          compliance.
        </p>

        <h2>3. Customer terms</h2>
        <ul>
          <li>You must be 18 or older to place an order.</li>
          <li>Prices, availability, and lead times are subject to change without notice.</li>
          <li>
            Orders are confirmed once payment clears. For manual bank transfers, your order is
            held in <em>pending payment</em> until funds are received.
          </li>
          <li>
            Shipping rates shown at checkout are estimates. International deliveries may incur
            additional customs duties or import VAT in the destination country, payable by you.
          </li>
          <li>
            Risk passes on delivery. Title passes once payment has cleared <em>and</em> delivery
            is completed.
          </li>
        </ul>

        <h2>4. Returns & refunds</h2>
        <p>
          You may request a refund within <strong>14 days</strong> of receiving your order for
          unopened, undamaged items. Perishable items (sauces opened, honey opened) are
          non-returnable for hygiene reasons unless faulty. To request a refund, email{' '}
          <a href="mailto:enquiry@bangarahtradingenterprises.com">
            enquiry@bangarahtradingenterprises.com
          </a>{' '}
          with your order number. Refunds are processed within 7 business days of receiving
          the returned goods (or immediately for digital / non-shipped items).
        </p>

        <h2>5. Vendor terms</h2>
        <p>
          Vendors apply at <a href="/sell">/sell</a> and operate under a separate vendor
          agreement once approved. Key terms include:
        </p>
        <ul>
          <li>
            Platform commission (default 10%, set per-vendor by Bangarah) is deducted from gross
            revenue on each order.
          </li>
          <li>
            Vendors warrant their products are legal to sell, accurately described, and meet
            applicable safety and labelling regulations.
          </li>
          <li>
            Vendors agree to fulfill orders within the lead time stated on their products, or
            communicate delays promptly.
          </li>
          <li>
            Payouts are made on a regular schedule (typically weekly or fortnightly) via bank
            transfer. Vendor bank details must be kept current.
          </li>
          <li>
            Bangarah may suspend or terminate a vendor for repeated quality issues, customer
            complaints, fraudulent activity, or breach of these terms.
          </li>
        </ul>

        <h2>6. Intellectual property</h2>
        <p>
          The Bangarah name, logo, and storefront design are our intellectual property. Vendors
          retain ownership of their brand assets but grant us a non-exclusive licence to display
          them on their storefront and marketing materials.
        </p>

        <h2>7. Prohibited conduct</h2>
        <ul>
          <li>No fraudulent transactions, chargebacks made in bad faith, or stolen cards.</li>
          <li>No scraping, automated ordering, or denial-of-service attacks.</li>
          <li>No goods that are illegal under Namibian law or the destination country&apos;s law.</li>
          <li>No misrepresentation of vendor identity or product provenance.</li>
        </ul>

        <h2>8. Liability</h2>
        <p>
          Bangarah&apos;s liability for any single order is capped at the order total. We are
          not liable for indirect, consequential, or incidental losses. Nothing in these terms
          excludes liability for fraud, death, personal injury caused by negligence, or other
          liability that cannot be excluded under applicable law.
        </p>

        <h2>9. Governing law</h2>
        <p>
          These terms are governed by the laws of Namibia. Disputes are subject to the
          exclusive jurisdiction of the High Court of Namibia, Windhoek division. For consumer
          disputes from other countries we accept the non-exclusive jurisdiction of the
          customer&apos;s home country courts where legally required.
        </p>

        <h2>10. Changes</h2>
        <p>
          We may update these terms. The &ldquo;Last updated&rdquo; date above will reflect any
          change, and material changes will be communicated by email to active accounts.
        </p>
      </Container>
    </article>
  )
}
