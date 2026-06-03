import type { Metadata } from 'next'
import { ShieldCheck, Truck, Wallet, MessageSquare } from 'lucide-react'
import { Container } from '@/components/ui/container'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { VendorApplicationForm } from '@/components/vendor/application-form'

export const metadata: Metadata = {
  title: 'Sell on Bangarah',
  description:
    'Apply to list your sauces, honey, supplements or specialty goods on the Bangarah marketplace.',
  alternates: { canonical: '/sell' },
}

const perks = [
  {
    icon: Wallet,
    title: 'Bangarah handles payments',
    body: "We're merchant-of-record. You don't need Stripe or Flutterwave accounts — get paid via bank transfer on a scheduled ledger.",
  },
  {
    icon: ShieldCheck,
    title: 'Dispute & quality oversight',
    body: 'We mediate refunds and quality issues so you can focus on what you make.',
  },
  {
    icon: Truck,
    title: 'Pan-African + diaspora reach',
    body: 'Sell to retail and wholesale customers across Africa, the UK, US, and Caribbean.',
  },
  {
    icon: MessageSquare,
    title: 'B2B quote workflow built-in',
    body: 'Bulk and import enquiries flow through our quote engine — you respond with pricing, lead time and ship-ready terms.',
  },
]

export default function SellPage() {
  return (
    <section className="py-16">
      <Container className="grid gap-12 lg:grid-cols-5">
        <div className="lg:col-span-2 space-y-6">
          <Badge variant="accent">For sole traders & small producers</Badge>
          <h1 className="font-display text-5xl font-semibold tracking-tight">
            Sell on Bangarah
          </h1>
          <p className="text-lg text-muted-foreground">
            Reach retail and wholesale customers across Africa and the diaspora. We handle
            payments, dispute resolution and quality oversight — you focus on what you make.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {perks.map((p) => {
              const Icon = p.icon
              return (
                <Card key={p.title}>
                  <CardContent className="space-y-2 pt-6">
                    <Icon className="h-6 w-6 text-brand-700" aria-hidden />
                    <h2 className="font-display text-lg font-semibold">{p.title}</h2>
                    <p className="text-sm text-muted-foreground">{p.body}</p>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>

        <div className="lg:col-span-3">
          <div className="rounded-2xl border border-border bg-white p-6 shadow-sm lg:p-8">
            <h2 className="font-display text-2xl font-semibold">Tell us about your business</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              We review every application personally — typically within one business day.
            </p>
            <div className="mt-6">
              <VendorApplicationForm />
            </div>
          </div>
        </div>
      </Container>
    </section>
  )
}
