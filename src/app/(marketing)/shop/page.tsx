import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Container } from '@/components/ui/container'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ProductCard } from '@/components/product/product-card'
import { CategoryNav } from '@/components/shop/category-nav'
import { SortSelect } from '@/components/shop/sort-select'
import { Pagination } from '@/components/shop/pagination'
import { listProducts, type ProductSort } from '@/lib/queries/products'
import { listCategories } from '@/lib/queries/categories'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Shop the marketplace',
  description:
    'Browse premium African and Caribbean sauces, honey, supplements and specialty imports from the Bangarah marketplace.',
  alternates: { canonical: '/shop' },
}

const ALLOWED_SORTS: ProductSort[] = ['newest', 'price-asc', 'price-desc']

type SearchParams = Promise<{ category?: string; sort?: string; page?: string }>

export default async function ShopPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams
  const category = sp.category
  const sortRaw = sp.sort as ProductSort | undefined
  const sort: ProductSort = sortRaw && ALLOWED_SORTS.includes(sortRaw) ? sortRaw : 'newest'
  const page = Math.max(1, Number(sp.page) || 1)

  const [{ docs: products, totalPages, totalDocs }, categories] = await Promise.all([
    listProducts({ categorySlug: category, sort, page }),
    listCategories(),
  ])

  // m23 (Phase 2): clamp out-of-range page numbers. Without this,
  // `?page=99999` against a non-empty catalog renders the empty-state
  // with a 200 — Google sees a soft-404 and crawl priority drifts.
  // Trip the real 404 so the URL drops from the index.
  if (totalDocs > 0 && page > totalPages) {
    notFound()
  }

  const baseParams = new URLSearchParams()
  if (category) baseParams.set('category', category)
  if (sort !== 'newest') baseParams.set('sort', sort)

  const activeCategoryName =
    category && categories.find((c) => c.slug === category)?.name

  return (
    <section className="py-16">
      <Container className="space-y-10">
        <header className="space-y-4">
          <Badge variant="accent">Marketplace</Badge>
          <h1 className="font-display text-5xl font-semibold tracking-tight">
            {activeCategoryName ?? 'Shop everything'}
          </h1>
          <p className="max-w-2xl text-lg text-muted-foreground">
            Sauces, honey, supplements and specialty imports from Bangarah and partner sole
            traders. Retail items check out instantly; bulk and wholesale items go through the
            quote flow.
          </p>
        </header>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <CategoryNav
            categories={categories.map((c) => ({ slug: c.slug as string, name: c.name as string }))}
            current={category}
          />
          <SortSelect value={sort} />
        </div>

        {products.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Showing {products.length} of {totalDocs} products
            </p>
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
            <Pagination page={page} totalPages={totalPages} baseParams={baseParams} />
          </>
        )}
      </Container>
    </section>
  )
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-muted/40 p-12 text-center">
      <h2 className="font-display text-2xl font-semibold">No products yet</h2>
      <p className="mt-2 max-w-md mx-auto text-muted-foreground">
        Either the catalog is being prepared or the database isn&apos;t reachable. Run{' '}
        <code className="rounded bg-white px-1.5 py-0.5 text-sm">npm run seed</code> to load the
        starter catalog, or sign in to the admin to add products.
      </p>
      <div className="mt-6 flex justify-center gap-2">
        <Button asChild variant="primary">
          <Link href="/admin">Open admin</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/quote">Request a bulk quote</Link>
        </Button>
      </div>
    </div>
  )
}
