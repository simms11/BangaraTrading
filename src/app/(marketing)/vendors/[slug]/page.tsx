import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { Container } from '@/components/ui/container'
import { Badge } from '@/components/ui/badge'
import { Breadcrumb } from '@/components/site/breadcrumb'
import { ProductCard } from '@/components/product/product-card'
import { BreadcrumbJsonLd } from '@/components/seo/json-ld'
import { getVendorBySlug, listVendorSlugs } from '@/lib/queries/vendors'
import { listProducts } from '@/lib/queries/products'

export const dynamicParams = true
export const revalidate = 300

export async function generateStaticParams() {
  const rows = await listVendorSlugs()
  return rows.map(({ slug }) => ({ slug }))
}

type RouteParams = Promise<{ slug: string }>

export async function generateMetadata({ params }: { params: RouteParams }): Promise<Metadata> {
  const { slug } = await params
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vendor = (await getVendorBySlug(slug)) as any
  if (!vendor) return { title: 'Vendor not found' }
  return {
    title: vendor.name,
    description: vendor.tagline ?? `${vendor.name} on Bangarah Trading.`,
    alternates: { canonical: `/vendors/${slug}` },
  }
}

export default async function VendorPage({ params }: { params: RouteParams }) {
  const { slug } = await params
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vendor = (await getVendorBySlug(slug)) as any
  if (!vendor) notFound()

  const { docs: products } = await listProducts({ vendorSlug: slug, limit: 24 })

  const crumbs = [
    { name: 'Vendors', href: '/vendors' },
    { name: vendor.name, href: `/vendors/${slug}` },
  ]

  return (
    <article className="py-12">
      <BreadcrumbJsonLd items={crumbs} />
      <Container className="space-y-10">
        <Breadcrumb items={crumbs} />
        <header className="space-y-4 rounded-3xl bg-gradient-to-br from-brand-50 to-accent-50 p-8 lg:p-12">
          <Badge variant="accent">Verified vendor</Badge>
          <h1 className="font-display text-5xl font-semibold tracking-tight">{vendor.name}</h1>
          {vendor.tagline && (
            <p className="max-w-2xl text-lg text-muted-foreground">{vendor.tagline}</p>
          )}
          {(vendor.city || vendor.country) && (
            <p className="text-sm uppercase tracking-wide text-brand-800">
              {[vendor.city, vendor.country].filter(Boolean).join(' · ')}
            </p>
          )}
          {vendor.bio && (
            <p className="max-w-3xl pt-2 text-muted-foreground">{vendor.bio}</p>
          )}
        </header>

        <section className="space-y-6">
          <h2 className="font-display text-2xl font-semibold">Products from {vendor.name}</h2>
          {products.length === 0 ? (
            <p className="text-muted-foreground">
              No products published yet — check back soon.
            </p>
          ) : (
            <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {products.map((p: any) => (
                <li key={p.id}>
                  <ProductCard
                    product={{
                      slug: p.slug,
                      title: p.title,
                      shortDescription: p.shortDescription,
                      priceMinor: p.priceMinor,
                      compareAtMinor: p.compareAtMinor,
                      currency: p.currency,
                      fulfillmentMode: p.fulfillmentMode,
                      vendor: typeof p.vendor === 'object' ? p.vendor : null,
                      images: p.images,
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </Container>
    </article>
  )
}
