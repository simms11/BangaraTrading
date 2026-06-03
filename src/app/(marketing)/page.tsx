import type { Metadata } from 'next'
import { Hero } from '@/components/site/hero'
import { Stats } from '@/components/site/stats'
import { FeaturedProducts } from '@/components/site/featured-products'
import { Services } from '@/components/site/services'
import { About } from '@/components/site/about'
import { ContactCta } from '@/components/site/contact-cta'

export const metadata: Metadata = {
  title: 'Premium African sauces, honey & specialty goods',
  alternates: { canonical: '/' },
}

export default function HomePage() {
  return (
    <>
      <Hero />
      <Stats />
      <FeaturedProducts />
      <Services />
      <About />
      <ContactCta />
    </>
  )
}
