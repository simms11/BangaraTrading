import type { Metadata } from 'next'
import { Container } from '@/components/ui/container'
import { MapPin, Phone, Mail, Clock, AlertCircle } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Contact',
  description:
    'Get in touch with Bangarah Trading Enterprises. Address, phone, email, business hours and 24/7 emergency support contact.',
  alternates: { canonical: '/contact' },
}

const blocks = [
  {
    icon: MapPin,
    title: 'Address',
    lines: [
      'Unit 8, Omumbonde Industrial Park Extension',
      'Okahandja, Namibia',
      'P.O. Box 27176, Windhoek, Namibia',
    ],
  },
  {
    icon: Phone,
    title: 'Phone',
    lines: ['Main: +264 855 63 6381', 'Emergency: +264 813 416 764'],
  },
  {
    icon: Mail,
    title: 'Email',
    lines: ['enquiry@bangarahtradingenterprises.com'],
  },
]

export default function ContactPage() {
  return (
    <section className="bg-brand-900 py-20 text-white">
      <Container size="lg" className="space-y-12">
        <header className="text-center space-y-4">
          <h1 className="text-5xl font-semibold tracking-tight">Get in touch</h1>
          <p className="mx-auto max-w-2xl text-lg text-brand-100">
            Ready to discuss your trading needs, place a bulk order, or list as a vendor? We&apos;re
            here to help.
          </p>
        </header>

        <div className="grid gap-10 md:grid-cols-2">
          <div className="space-y-8">
            {blocks.map((b) => {
              const Icon = b.icon
              return (
                <div key={b.title} className="flex gap-4">
                  <div className="rounded-xl bg-accent-400 p-3 text-brand-950">
                    <Icon className="h-6 w-6" aria-hidden />
                  </div>
                  <div>
                    <h2 className="font-semibold">{b.title}</h2>
                    <div className="mt-1 space-y-0.5 text-brand-100">
                      {b.lines.map((l) => (
                        <div key={l}>{l}</div>
                      ))}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="rounded-2xl bg-white/10 p-8 backdrop-blur-sm">
            <h2 className="flex items-center gap-2 text-2xl font-semibold">
              <Clock className="h-6 w-6 text-accent-400" aria-hidden /> Business hours
            </h2>
            <dl className="mt-6 space-y-3 text-brand-100">
              <div className="flex justify-between">
                <dt>Monday – Friday</dt>
                <dd>8:00 – 17:00</dd>
              </div>
              <div className="flex justify-between">
                <dt>Saturday</dt>
                <dd>8:00 – 13:00</dd>
              </div>
              <div className="flex justify-between">
                <dt>Sunday</dt>
                <dd>Closed</dd>
              </div>
            </dl>
            <div className="mt-6 flex items-start gap-2 rounded-xl bg-accent-400/10 p-4 text-accent-200">
              <AlertCircle className="h-5 w-5 shrink-0" aria-hidden />
              <p className="text-sm">
                <span className="font-semibold text-accent-100">24/7 emergency support</span>{' '}
                — for urgent orders or supply issues, call the emergency line above any time.
              </p>
            </div>
          </div>
        </div>
      </Container>
    </section>
  )
}
