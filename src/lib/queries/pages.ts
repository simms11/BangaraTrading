import 'server-only'
import { cache } from 'react'
import { getPayload, safe } from '@/lib/payload'

// m25 (Phase 2): return { slug, updatedAt } for sitemap lastModified.
export const listPageSlugs = cache(
  async (): Promise<Array<{ slug: string; updatedAt: string }>> => {
    const result = await safe(async () => {
      const payload = await getPayload()
      const { docs } = await payload.find({
        collection: 'pages',
        where: { status: { equals: 'published' } },
        limit: 1000,
        depth: 0,
        select: { slug: true, updatedAt: true },
      })
      return docs
        .filter((d) => Boolean(d.slug))
        .map((d) => ({
          slug: d.slug as string,
          updatedAt: String(d.updatedAt),
        }))
    })
    return result.ok ? result.data : []
  },
)
