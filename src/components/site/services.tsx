import { Globe, Package, Droplets, Truck } from 'lucide-react'
import { Container } from '@/components/ui/container'

const services = [
  {
    icon: Globe,
    title: 'Import & export',
    description:
      'Established Caribbean and inter-African trade networks. Direct relationships with producers.',
  },
  {
    icon: Package,
    title: 'Manufacturing',
    description:
      'Premium sauce production: Extra Hot, Hot, Sweet Chilli and herbal varieties — to international quality standards.',
  },
  {
    icon: Droplets,
    title: 'Honey processing',
    description:
      'End-to-end honey processing, packaging and traceability under the Kiyaya brand.',
  },
  {
    icon: Truck,
    title: 'Distribution',
    description:
      'Nationwide and regional distribution with 24/7 emergency supply capability.',
  },
]

export function Services() {
  return (
    <section id="services" className="bg-muted py-20">
      <Container className="space-y-10">
        <header className="max-w-2xl space-y-3">
          <h2 className="font-display text-4xl font-semibold tracking-tight">What we do</h2>
          <p className="text-muted-foreground">
            Beyond the marketplace storefront, Bangarah operates as a full trading house — useful
            context for buyers, partners, and sole traders considering listing with us.
          </p>
        </header>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {services.map((s) => {
            const Icon = s.icon
            return (
              <div key={s.title} className="rounded-2xl border border-border bg-white p-6 shadow-sm">
                <div className="inline-flex rounded-xl bg-brand-50 p-3 text-brand-700">
                  <Icon className="h-5 w-5" aria-hidden />
                </div>
                <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{s.description}</p>
              </div>
            )
          })}
        </div>
      </Container>
    </section>
  )
}
