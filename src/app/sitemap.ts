import type { MetadataRoute } from 'next'
import { listProductSlugs } from '@/lib/queries/products'
import { listVendorSlugs } from '@/lib/queries/vendors'
import { listPageSlugs } from '@/lib/queries/pages'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

const STATIC_PATHS = [
  '',
  '/about',
  '/services',
  '/shop',
  '/vendors',
  '/sell',
  '/quote',
  '/contact',
] as const

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()
  const staticRoutes: MetadataRoute.Sitemap = STATIC_PATHS.map((path) => ({
    url: `${siteUrl}${path}`,
    lastModified: now,
    changeFrequency: path === '' ? 'daily' : 'weekly',
    priority: path === '' ? 1 : 0.7,
  }))

  // H11 minor: sitemap must degrade gracefully if Payload/DB is unreachable.
  // Previously a transient outage produced a 500 on /sitemap.xml — Google
  // retries and eventually demotes; uptime monitors flap. Each list call
  // catches independently so a single broken collection still lets the
  // others through.
  type SlugRow = { slug: string; updatedAt: string }
  const [productRows, vendorRows, pageRows] = await Promise.all([
    listProductSlugs().catch(() => [] as SlugRow[]),
    listVendorSlugs().catch(() => [] as SlugRow[]),
    listPageSlugs().catch(() => [] as SlugRow[]),
  ])

  // m25 (Phase 2): emit per-row `lastModified` from the document's
  // `updatedAt` instead of `now` so Googlebot can prioritise URLs whose
  // content actually changed. Fall back to `now` only if the date is
  // unparseable (paranoia — the helpers already coerce to a string).
  const sitemapDate = (raw: string): Date => {
    const d = new Date(raw)
    return Number.isFinite(d.getTime()) ? d : now
  }

  // B70 fix: include CMS-managed Pages. The revalidatePage hook maps a Page
  // with slug=X to `/X`, so we dedupe against the static path list to avoid
  // emitting two entries when an editor creates a Page with a slug that
  // overlaps a hard-coded route (e.g. `about`).
  const staticPathSet = new Set<string>(STATIC_PATHS.map((p) => p.replace(/^\//, '')))
  const cmsPageEntries: MetadataRoute.Sitemap = pageRows
    .filter(({ slug }) => !staticPathSet.has(slug))
    .map(({ slug, updatedAt }) => ({
      url: `${siteUrl}/${slug}`,
      lastModified: sitemapDate(updatedAt),
      changeFrequency: 'weekly' as const,
      priority: 0.5,
    }))

  return [
    ...staticRoutes,
    ...cmsPageEntries,
    ...productRows.map(({ slug, updatedAt }) => ({
      url: `${siteUrl}/products/${slug}`,
      lastModified: sitemapDate(updatedAt),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
    ...vendorRows.map(({ slug, updatedAt }) => ({
      url: `${siteUrl}/vendors/${slug}`,
      lastModified: sitemapDate(updatedAt),
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),
  ]
}
