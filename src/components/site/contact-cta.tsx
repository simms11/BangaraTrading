import Link from 'next/link'
import { Phone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'

export function ContactCta() {
  return (
    <section className="bg-brand-950 py-20 text-white">
      <Container size="md" className="text-center space-y-6">
        <h2 className="font-display text-4xl font-semibold">
          Bulk orders, supply enquiries, or want to sell with us?
        </h2>
        <p className="mx-auto max-w-2xl text-brand-200">
          We service retail shoppers and wholesale buyers across Southern Africa and the diaspora.
          Get in touch — same-day response on business days, 24/7 emergency line for active
          supply needs.
        </p>
        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild variant="accent" size="lg">
            <Link href="/quote">Request a quote</Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="border-white text-white hover:bg-white hover:text-brand-900">
            <a href="tel:+264813416764">
              <Phone className="h-4 w-4" aria-hidden /> +264 813 416 764
            </a>
          </Button>
        </div>
      </Container>
    </section>
  )
}
