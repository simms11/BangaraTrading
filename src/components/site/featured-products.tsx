import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Container } from '@/components/ui/container'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ProductCard } from '@/components/product/product-card'
import { listFeaturedProducts } from '@/lib/queries/products'

type StaticFeatured = {
  name: string
  category: string
  description: string
  badge: 'signature' | 'premium' | 'natural'
}

const staticFallback: StaticFeatured[] = [
  {
    name: "Ayisha's Herbal Sauces",
    category: 'Signature sauces',
    description: 'Patented herbal recipes — the original Bangarah line.',
    badge: 'signature',
  },
  {
    name: "Kiyaya's Brand Sauces",
    category: 'Premium range',
    description: 'Extra Hot, Hot, and Sweet Chilli varieties for every palette.',
    badge: 'premium',
  },
  {
    name: "Kiyaya's Pure Honey",
    category: 'Natural products',
    description: 'Processed and packaged in Namibia. Pure, unblended, traceable.',
    badge: 'natural',
  },
]

const badgeVariant: Record<StaticFeatured['badge'], 'accent' | 'spice' | 'default'> = {
  signature: 'accent',
  premium: 'spice',
  natural: 'default',
}

export async function FeaturedProducts() {
  const featured = await listFeaturedProducts(3)
  const hasReal = featured.length > 0

  return (
    <section className="py-20">
      <Container className="space-y-10">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h2 className="font-display text-4xl font-semibold tracking-tight">
              Featured products
            </h2>
            <p className="mt-3 max-w-xl text-muted-foreground">
              A taste of what&apos;s on the marketplace — flagship brands from our own facility,
              plus growing range from partner sole traders.
            </p>
          </div>
          <Button asChild variant="link">
            <Link href="/shop">
              Browse all products
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        </div>

        {hasReal ? (
          <ul className="grid gap-6 md:grid-cols-3">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {(featured as any[]).map((p) => (
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
        ) : (
          <div className="grid gap-6 md:grid-cols-3">
            {staticFallback.map((p) => (
              <Card key={p.name} className="hover:shadow-md">
                <CardContent className="space-y-3 pt-6">
                  <Badge variant={badgeVariant[p.badge]}>{p.category}</Badge>
                  <CardTitle>{p.name}</CardTitle>
                  <CardDescription>{p.description}</CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Container>
    </section>
  )
}
