import 'server-only'
import { cache } from 'react'
import { getPayload, safe } from '@/lib/payload'

export const listCategories = cache(async () => {
  const result = await safe(async () => {
    const payload = await getPayload()
    const { docs } = await payload.find({
      collection: 'categories',
      sort: 'order',
      limit: 100,
      depth: 0,
    })
    return docs
  })
  return result.ok ? result.data : []
})

export const getCategoryBySlug = cache(async (slug: string) => {
  const result = await safe(async () => {
    const payload = await getPayload()
    const { docs } = await payload.find({
      collection: 'categories',
      where: { slug: { equals: slug } },
      limit: 1,
      depth: 0,
    })
    return docs[0] ?? null
  })
  return result.ok ? result.data : null
})
