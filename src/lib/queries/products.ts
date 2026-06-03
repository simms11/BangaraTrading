import 'server-only'
import { cache } from 'react'
import type { Where } from 'payload'
import type { Product } from '@/payload-types'
import { getPayload, safe } from '@/lib/payload'

export type ProductSort = 'newest' | 'price-asc' | 'price-desc'

const PAGE_SIZE = 12

const sortMap: Record<ProductSort, string> = {
  newest: '-createdAt',
  'price-asc': 'priceMinor',
  'price-desc': '-priceMinor',
}

export type ListProductsArgs = {
  categorySlug?: string
  vendorSlug?: string
  sort?: ProductSort
  page?: number
  limit?: number
}

export type PaginatedProducts = {
  docs: Product[]
  totalDocs: number
  totalPages: number
  page: number
}

const EMPTY_PAGE: PaginatedProducts = { docs: [], totalDocs: 0, totalPages: 0, page: 1 }

export const listProducts = cache(
  async (args: ListProductsArgs = {}): Promise<PaginatedProducts> => {
    const { categorySlug, vendorSlug, sort = 'newest', page = 1, limit = PAGE_SIZE } = args

    const result = await safe(async () => {
      const payload = await getPayload()
      // R8 business M4/M5 — filter by vendor.status so a paused or banned
      // vendor's products never surface on the storefront, regardless of
      // whether the Vendors cascade-archive ran (defence in depth) and so
      // that PAUSE can be reversible without mutating product rows. This
      // is a flat belongsTo relationship traversal (products.vendor_id →
      // vendors.id), a cheap PK join — not the array-table traversal that
      // hung in round-7.
      const and: Where[] = [
        { status: { equals: 'published' } },
        { 'vendor.status': { equals: 'active' } },
      ]

      if (categorySlug) {
        const cat = await payload.find({
          collection: 'categories',
          where: { slug: { equals: categorySlug } },
          limit: 1,
        })
        const id = cat.docs[0]?.id
        if (!id) return EMPTY_PAGE
        and.push({ categories: { in: [id] } })
      }

      if (vendorSlug) {
        const v = await payload.find({
          collection: 'vendors',
          where: { slug: { equals: vendorSlug } },
          limit: 1,
        })
        const id = v.docs[0]?.id
        if (!id) return EMPTY_PAGE
        and.push({ vendor: { equals: id } })
      }

      // I8 (M13): depth: 2 fanned out to vendor + categories + images.image
      // for every row → ~3 extra SELECTs per product × 12 products = 36 SQL
      // statements per shop render. depth: 1 keeps vendor + first image
      // (one level deep) which is what the product card actually needs.
      const res = await payload.find({
        collection: 'products',
        where: { and },
        sort: sortMap[sort],
        page,
        limit,
        depth: 1,
      })
      return {
        docs: res.docs as Product[],
        totalDocs: res.totalDocs,
        totalPages: res.totalPages,
        page: res.page ?? 1,
      } satisfies PaginatedProducts
    })

    return result.ok ? result.data : EMPTY_PAGE
  },
)

export const getProductBySlug = cache(async (slug: string): Promise<Product | null> => {
  const result = await safe(async () => {
    const payload = await getPayload()
    // I8 (M12): the product detail page reads vendor + image rows from
    // this row plus listRelatedProducts (3 more rows). depth: 2 here added
    // 6+ SELECTs for a single render; depth: 1 keeps the immediate
    // relationships (vendor, images.image, categories) populated which is
    // all the detail page actually consumes.
    const { docs } = await payload.find({
      collection: 'products',
      where: {
        and: [
          { slug: { equals: slug } },
          { status: { equals: 'published' } },
          // R8 business M4/M5 — hide products of paused/banned vendors.
          { 'vendor.status': { equals: 'active' } },
        ],
      },
      limit: 1,
      depth: 1,
    })
    return (docs[0] ?? null) as Product | null
  })
  return result.ok ? result.data : null
})

/**
 * Pulled by orders.ts at order-creation time to re-validate cart prices
 * against the live DB. Uses depth=0 for speed; no joins needed.
 */
export const getProductsByIds = cache(
  async (ids: Array<number | string>): Promise<Product[]> => {
    if (ids.length === 0) return []
    const result = await safe(async () => {
      const payload = await getPayload()
      const { docs } = await payload.find({
        collection: 'products',
        where: { id: { in: ids } },
        limit: Math.min(200, ids.length),
        depth: 0,
      })
      return docs as Product[]
    })
    return result.ok ? result.data : []
  },
)

export const listFeaturedProducts = cache(async (limit = 3): Promise<Product[]> => {
  const result = await safe(async () => {
    const payload = await getPayload()
    const settings = await payload.findGlobal({ slug: 'site-settings', depth: 2 })
    const featured = settings?.featuredProducts as Array<Product | number> | undefined
    if (featured && featured.length) {
      return featured
        .filter((p): p is Product => typeof p === 'object' && p !== null)
        .slice(0, limit)
    }
    const { docs } = await payload.find({
      collection: 'products',
      where: { status: { equals: 'published' } },
      sort: '-createdAt',
      limit,
      depth: 2,
    })
    return docs as Product[]
  })
  return result.ok ? result.data : []
})

export const listRelatedProducts = cache(
  async (
    productId: number | string,
    categoryIds: Array<number | string>,
    limit = 3,
  ): Promise<Product[]> => {
    if (!categoryIds.length) return []
    const result = await safe(async () => {
      const payload = await getPayload()
      // I8 (M12): depth: 1 — related-product cards only need vendor + first
      // image, not the deeper category/media-size traversal that depth: 2
      // triggers.
      const { docs } = await payload.find({
        collection: 'products',
        where: {
          and: [
            { status: { equals: 'published' } },
            { id: { not_equals: productId } },
            { categories: { in: categoryIds } },
            // Final audit (frontend) — hide paused/banned vendors' products
            // from "You may also like" so a card can't link to a detail
            // page that then 404s. Matches listProducts/getProductBySlug.
            { 'vendor.status': { equals: 'active' } },
          ],
        },
        sort: '-createdAt',
        limit,
        depth: 1,
      })
      return docs as Product[]
    })
    return result.ok ? result.data : []
  },
)

/**
 * m25 (Phase 2): return `{ slug, updatedAt }` so sitemap.ts can emit a
 * meaningful `lastModified` per URL. Returning bare strings made every
 * sitemap entry stamp with `new Date()` on each crawl — Googlebot saw
 * every URL "change" simultaneously and lost crawl-priority on real
 * updates.
 */
export const listProductSlugs = cache(
  async (): Promise<Array<{ slug: string; updatedAt: string }>> => {
    const result = await safe(async () => {
      const payload = await getPayload()
      const { docs } = await payload.find({
        collection: 'products',
        where: {
          and: [
            { status: { equals: 'published' } },
            // Final audit (frontend) — exclude paused/banned vendors'
            // products from the sitemap + generateStaticParams so we don't
            // advertise URLs that 404 (soft-404 SEO noise) or pre-render
            // throwaway pages. Matches listProducts/getProductBySlug.
            { 'vendor.status': { equals: 'active' } },
          ],
        },
        limit: 1000,
        depth: 0,
        select: { slug: true, updatedAt: true },
      })
      return docs.map((d) => ({
        slug: d.slug as string,
        updatedAt: String(d.updatedAt),
      }))
    })
    return result.ok ? result.data : []
  },
)
