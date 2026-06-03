import type { Metadata } from 'next'
import { Services } from '@/components/site/services'

export const metadata: Metadata = {
  title: 'Services',
  description:
    'Import & export, manufacturing, honey processing and distribution services from Bangarah Trading Enterprises.',
  alternates: { canonical: '/services' },
}

export default function ServicesPage() {
  return (
    <div className="pt-10">
      <Services />
    </div>
  )
}
