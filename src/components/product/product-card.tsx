import Link from 'next/link'
import Image from 'next/image'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Price } from './price'
import { cn } from '@/lib/utils'

type ProductCardData = {
  slug: string
  title: string
  shortDescription?: string | null
  priceMinor: number
  compareAtMinor?: number | null
  currency: string
  fulfillmentMode: 'retail' | 'quote' | 'hybrid'
  vendor?: { name?: string; slug?: string } | null
  images?: Array<{ image?: { url?: string | null; alt?: string | null } | null; alt?: string }>
}

const modeLabel: Record<ProductCardData['fulfillmentMode'], string> = {
  retail: 'In stock',
  quote: 'Bulk · quote',
  hybrid: 'Retail + bulk',
}

export function ProductCard({ product, className }: { product: ProductCardData; className?: string }) {
  const firstImage = product.images?.[0]
  const imageUrl = firstImage?.image?.url
  const imageAlt = firstImage?.alt || firstImage?.image?.alt || product.title

  return (
    <Card className={cn('group flex flex-col overflow-hidden hover:shadow-md transition-shadow', className)}>
      <Link href={`/products/${product.slug}`} className="block">
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-gradient-to-br from-brand-50 to-accent-50">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={imageAlt}
              fill
              sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
              className="object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full items-center justify-center font-display text-4xl text-brand-300">
              {product.title.charAt(0)}
            </div>
          )}
        </div>
      </Link>
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-center justify-between gap-2">
          {product.vendor?.slug ? (
            <Link
              href={`/vendors/${product.vendor.slug}`}
              className="text-xs font-medium uppercase tracking-wide text-brand-700 hover:text-brand-900"
            >
              {product.vendor.name}
            </Link>
          ) : (
            <span />
          )}
          <Badge variant={product.fulfillmentMode === 'quote' ? 'spice' : 'default'}>
            {modeLabel[product.fulfillmentMode]}
          </Badge>
        </div>
        <Link href={`/products/${product.slug}`} className="mt-2">
          <h3 className="font-display text-lg font-semibold leading-tight tracking-tight text-foreground group-hover:text-brand-700">
            {product.title}
          </h3>
        </Link>
        {product.shortDescription && (
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
            {product.shortDescription}
          </p>
        )}
        <div className="mt-4">
          <Price
            amountMinor={product.priceMinor}
            currency={product.currency}
            compareAtMinor={product.compareAtMinor}
            size="md"
          />
        </div>
      </div>
    </Card>
  )
}
