import type { Metadata } from 'next'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { listActiveVendors } from '@/lib/queries/vendors'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Vendors',
  description:
    'Meet the African and Caribbean sole traders selling on Bangarah. Verified producers, transparent provenance.',
  alternates: { canonical: '/vendors' },
}

export default async function VendorsIndex() {
  const vendors = await listActiveVendors()

  return (
    <section className="py-16">
      <Container className="space-y-10">
        <header className="space-y-3">
          <Badge variant="accent">Vendors</Badge>
          <h1 className="font-display text-5xl font-semibold tracking-tight">
            Trusted producers
          </h1>
          <p className="max-w-2xl text-lg text-muted-foreground">
            Every vendor on Bangarah is verified by us. Bangarah Trading is the anchor vendor;
            partner sole traders join us on the same quality bar.
          </p>
        </header>

        {vendors.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-muted/40 p-12 text-center">
            <p className="text-muted-foreground">
              No vendors loaded yet. Run <code className="rounded bg-white px-1.5 py-0.5">npm run seed</code>{' '}
              or onboard vendors via the admin.
            </p>
          </div>
        ) : (
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {vendors.map((v: any) => (
              <li key={v.id}>
                <Card className="h-full hover:shadow-md transition-shadow">
                  <CardContent className="space-y-3 pt-6">
                    <h2 className="font-display text-xl font-semibold">
                      <Link href={`/vendors/${v.slug}`} className="hover:text-brand-700">
                        {v.name}
                      </Link>
                    </h2>
                    {v.tagline && (
                      <p className="text-sm text-muted-foreground line-clamp-3">{v.tagline}</p>
                    )}
                    {(v.city || v.country) && (
                      <p className="text-xs uppercase tracking-wide text-brand-700">
                        {[v.city, v.country].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Container>
    </section>
  )
}
