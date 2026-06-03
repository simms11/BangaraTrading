import { Award } from 'lucide-react'
import { Container } from '@/components/ui/container'

export function About() {
  return (
    <section className="py-20">
      <Container size="md" className="grid items-center gap-12 lg:grid-cols-2">
        <div className="rounded-3xl bg-gradient-to-br from-brand-700 to-brand-900 p-10 text-white shadow-lg">
          <Award className="h-10 w-10 text-accent-300" aria-hidden />
          <h2 className="mt-6 font-display text-3xl font-semibold">Established 2011</h2>
          <p className="mt-4 leading-relaxed text-brand-100">
            Registered under the Namibian Close Corporation Act, Bangarah Trading Enterprises has
            been delivering quality sauces, honeys and specialty goods with integrity and passion
            for more than a decade.
          </p>
        </div>
        <div className="space-y-4 text-muted-foreground">
          <h2 className="font-display text-3xl font-semibold text-foreground">
            From a single trading house to a marketplace
          </h2>
          <p>
            We started as a producer-distributor of premium sauces and honey from Okahandja. Today,
            we&apos;re evolving into a marketplace where vetted African and Caribbean sole traders
            can reach diaspora customers without losing the provenance and quality buyers expect.
          </p>
          <p>
            Bangarah remains the anchor merchant — owning the merchant-of-record relationship,
            handling payments, dispute resolution and quality assurance — while inviting other
            makers to join.
          </p>
        </div>
      </Container>
    </section>
  )
}
