import 'server-only'
import { cache } from 'react'
import type { Vendor } from '@/payload-types'
import { getPayload, safe } from '@/lib/payload'

export const listActiveVendors = cache(async (): Promise<Vendor[]> => {
  const result = await safe(async () => {
    const payload = await getPayload()
    const { docs } = await payload.find({
      collection: 'vendors',
      where: { status: { equals: 'active' } },
      sort: 'name',
      limit: 100,
      depth: 1,
    })
    return docs as Vendor[]
  })
  return result.ok ? result.data : []
})

export const getVendorBySlug = cache(async (slug: string): Promise<Vendor | null> => {
  const result = await safe(async () => {
    const payload = await getPayload()
    const { docs } = await payload.find({
      collection: 'vendors',
      where: { and: [{ slug: { equals: slug } }, { status: { equals: 'active' } }] },
      limit: 1,
      depth: 1,
    })
    return (docs[0] ?? null) as Vendor | null
  })
  return result.ok ? result.data : null
})

// m25 (Phase 2): return { slug, updatedAt } for sitemap lastModified.
export const listVendorSlugs = cache(
  async (): Promise<Array<{ slug: string; updatedAt: string }>> => {
    const result = await safe(async () => {
      const payload = await getPayload()
      const { docs } = await payload.find({
        collection: 'vendors',
        where: { status: { equals: 'active' } },
        limit: 200,
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
