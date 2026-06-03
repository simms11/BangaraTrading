import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Truck, ShieldCheck, MessageSquare } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Breadcrumb } from '@/components/site/breadcrumb'
import { Price } from '@/components/product/price'
import { ProductGallery } from '@/components/product/product-gallery'
import { ProductCard } from '@/components/product/product-card'
import { ProductJsonLd, BreadcrumbJsonLd } from '@/components/seo/json-ld'
import { AddToCart } from '@/components/cart/add-to-cart'
import {
  getProductBySlug,
  listProductSlugs,
  listRelatedProducts,
} from '@/lib/queries/products'

export const dynamicParams = true
export const revalidate = 300

export async function generateStaticParams() {
  const rows = await listProductSlugs()
  return rows.map(({ slug }) => ({ slug }))
}

type RouteParams = Promise<{ slug: string }>

export async function generateMetadata({ params }: { params: RouteParams }): Promise<Metadata> {
  const { slug } = await params
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const product = (await getProductBySlug(slug)) as any
  if (!product) return { title: 'Product not found' }
  return {
    title: product.title,
    description: product.shortDescription ?? `${product.title} on Bangarah Trading.`,
    alternates: { canonical: `/products/${slug}` },
    openGraph: {
      title: product.title,
      description: product.shortDescription ?? undefined,
      type: 'website',
      images: product.images?.[0]?.image?.url ? [product.images[0].image.url] : undefined,
    },
  }
}

export default async function ProductPage({ params }: { params: RouteParams }) {
  const { slug } = await params
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const product = (await getProductBySlug(slug)) as any
  if (!product) notFound()

  const vendor = typeof product.vendor === 'object' ? product.vendor : null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const categories: any[] = Array.isArray(product.categories)
    ? product.categories.filter((c: unknown) => typeof c === 'object')
    : []
  const primaryCategory = categories[0]

  const galleryImages =
    product.images
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ?.map((row: any) => ({
        url: row.image?.url as string | undefined,
        alt: (row.alt as string) || (row.image?.alt as string) || product.title,
      }))
      .filter((x: { url?: string }) => x.url) ?? []

  const inStock =
    !product.inventory?.trackQuantity || (product.inventory?.quantity ?? 0) > 0 ||
    product.inventory?.allowBackorder

  const related = await listRelatedProducts(
    product.id,
    categories.map((c) => c.id),
  )

  const crumbs = [
    { name: 'Shop', href: '/shop' },
    ...(primaryCategory
      ? [{ name: primaryCategory.name, href: `/shop?category=${primaryCategory.slug}` }]
      : []),
    { name: product.title, href: `/products/${slug}` },
  ]

  const isQuoteOnly = product.fulfillmentMode === 'quote'

  return (
    <article className="py-12">
      <ProductJsonLd
        title={product.title}
        slug={slug}
        description={product.shortDescription ?? ''}
        priceMinor={product.priceMinor}
        currency={product.currency}
        sku={product.sku}
        imageUrls={galleryImages.map((g: { url: string }) => g.url)}
        vendorName={vendor?.name}
        inStock={Boolean(inStock)}
      />
      <BreadcrumbJsonLd items={crumbs} />

      <Container className="space-y-10">
        <Breadcrumb items={crumbs} />

        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
          <ProductGallery images={galleryImages} title={product.title} />

          <div className="space-y-6">
            {vendor && (
              <Link
                href={`/vendors/${vendor.slug}`}
                className="inline-flex text-sm font-medium text-brand-700 hover:text-brand-900 hover:underline"
              >
                Sold by {vendor.name}
              </Link>
            )}
            <h1 className="font-display text-4xl font-semibold tracking-tight">
              {product.title}
            </h1>
            {product.shortDescription && (
              <p className="text-lg text-muted-foreground">{product.shortDescription}</p>
            )}

            <Price
              amountMinor={product.priceMinor}
              currency={product.currency}
              compareAtMinor={product.compareAtMinor}
              size="lg"
            />

            <div className="flex flex-wrap items-center gap-2">
              {isQuoteOnly ? (
                <Badge variant="spice">Bulk · quote required</Badge>
              ) : product.fulfillmentMode === 'hybrid' ? (
                <Badge variant="accent">Retail + bulk available</Badge>
              ) : (
                <Badge>Instant checkout</Badge>
              )}
              {!inStock && <Badge variant="outline">Out of stock</Badge>}
              {product.sku && (
                <span className="text-xs text-muted-foreground">SKU {product.sku}</span>
              )}
            </div>

            <div className="space-y-3 pt-2">
              {isQuoteOnly ? (
                <Button asChild size="lg" variant="primary">
                  <Link href={`/quote?product=${slug}`}>
                    <MessageSquare className="h-4 w-4" aria-hidden />
                    Request a quote
                  </Link>
                </Button>
              ) : (
                <>
                  {inStock ? (
                    <AddToCart slug={slug} />
                  ) : (
                    <Button size="lg" variant="primary" disabled aria-disabled>
                      Out of stock
                    </Button>
                  )}
                  {product.fulfillmentMode === 'hybrid' && (
                    <Button asChild size="lg" variant="outline">
                      <Link href={`/quote?product=${slug}`}>Request bulk quote</Link>
                    </Button>
                  )}
                </>
              )}
            </div>

            <dl className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-muted/40 p-5 sm:grid-cols-2">
              <Feature
                icon={<Truck className="h-4 w-4" aria-hidden />}
                label="Ships from"
                value={vendor ? `${vendor.city ?? ''} ${vendor.country ?? ''}`.trim() || 'Namibia' : 'Namibia'}
              />
              <Feature
                icon={<ShieldCheck className="h-4 w-4" aria-hidden />}
                label="Quality"
                value="Bangarah-verified vendor"
              />
            </dl>

            {Array.isArray(product.tags) && product.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {product.tags.map((t: any, i: number) => (
                  <span
                    key={i}
                    className="rounded-full bg-brand-50 px-3 py-1 text-xs text-brand-800"
                  >
                    {t.value}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {related.length > 0 && (
          <section className="space-y-6 pt-10">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl font-semibold">You may also like</h2>
              <Button asChild variant="link">
                <Link href="/shop">
                  <ArrowLeft className="h-4 w-4" aria-hidden /> Back to shop
                </Link>
              </Button>
            </div>
            <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {related.map((p: any) => (
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
          </section>
        )}
      </Container>
    </article>
  )
}

function Feature({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 rounded-md bg-white p-1.5 text-brand-700">{icon}</span>
      <div>
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="text-sm font-medium">{value}</dd>
      </div>
    </div>
  )
}
