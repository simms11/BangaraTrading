import { Award, Users, Package, Clock } from 'lucide-react'
import { Container } from '@/components/ui/container'

const stats = [
  { icon: Award, label: 'Years in business', value: '13+' },
  { icon: Users, label: 'Happy customers', value: '500+' },
  { icon: Package, label: 'Product lines', value: '6' },
  { icon: Clock, label: 'Emergency support', value: '24/7' },
]

export function Stats() {
  return (
    <section className="border-y border-border bg-white py-14">
      <Container>
        <dl className="grid grid-cols-2 gap-6 md:grid-cols-4">
          {stats.map((s) => {
            const Icon = s.icon
            return (
              <div key={s.label} className="text-center">
                <Icon className="mx-auto h-7 w-7 text-brand-600" aria-hidden />
                <dt className="mt-3 text-sm text-muted-foreground">{s.label}</dt>
                <dd className="font-display text-3xl font-semibold text-brand-900">{s.value}</dd>
              </div>
            )
          })}
        </dl>
      </Container>
    </section>
  )
}
