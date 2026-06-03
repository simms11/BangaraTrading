import Link from 'next/link'
import { Container } from '@/components/ui/container'

const cols = [
  {
    heading: 'Marketplace',
    links: [
      { href: '/shop', label: 'Shop all' },
      // R11 — these previously linked to non-existent /shop/X routes
      // (4 visible 404s on every page in the footer). The storefront
      // uses /shop?category=<slug>; slugs match the seed.
      { href: '/shop?category=sauces', label: 'Sauces' },
      { href: '/shop?category=honey', label: 'Honey' },
      { href: '/shop?category=supplements', label: 'Supplements' },
      { href: '/shop?category=caribbean-imports', label: 'Caribbean imports' },
    ],
  },
  {
    heading: 'Business',
    links: [
      { href: '/about', label: 'About us' },
      { href: '/services', label: 'Services' },
      { href: '/sell', label: 'Sell on Bangarah' },
      { href: '/quote', label: 'Request a quote' },
    ],
  },
  {
    heading: 'Support',
    links: [
      { href: '/contact', label: 'Contact' },
      { href: '/shipping', label: 'Shipping & returns' },
      { href: '/help', label: 'Help center' },
      { href: '/account/orders', label: 'Track an order' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { href: '/privacy', label: 'Privacy policy' },
      { href: '/terms', label: 'Terms of service' },
      { href: '/cookies', label: 'Cookie policy' },
    ],
  },
]

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-brand-950 text-brand-100">
      <Container size="xl" className="py-16">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2 space-y-4">
            <div className="font-display text-2xl font-semibold text-white">
              Bangarah Trading
            </div>
            <p className="max-w-sm text-sm text-brand-200">
              Premium African and Caribbean sauces, honey and specialty goods, brought to you by a
              marketplace of trusted sole traders. Established 2011 in Okahandja, Namibia.
            </p>
            <address className="not-italic text-sm text-brand-200">
              Unit 8, Omumbonde Industrial Park
              <br />
              Okahandja, Namibia
            </address>
          </div>
          {cols.map((c) => (
            <div key={c.heading}>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-white">
                {c.heading}
              </h3>
              <ul className="mt-4 space-y-2">
                {c.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="text-sm text-brand-200 transition-colors hover:text-accent-300"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-white/10 pt-6 text-xs text-brand-300 md:flex-row md:items-center">
          <div>© {new Date().getFullYear()} Bangarah Trading Enterprises CC. All rights reserved.</div>
          <div>Registered under the Namibian Close Corporation Act.</div>
        </div>
      </Container>
    </footer>
  )
}
