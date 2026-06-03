import type { TaskConfig } from 'payload'

/**
 * Expire quotes whose `response.validUntil` has passed.
 *
 * Quotes start `submitted`, move to `quoted` once ops responds, and have a
 * `validUntil` set on response. After that date the quote auto-expires so
 * customers can't accept stale pricing. Runs hourly via the jobs cron.
 *
 * We declare the input/output shapes inline (rather than referencing the
 * generated TypedJobs registry) so types compile before the slug has been
 * added to the registry. `npm run generate:types` then promotes the slug
 * for typed `jobs.queue({ task: 'expireQuotes' })` callers.
 */
type ExpireQuotesIO = {
  input: Record<string, never>
  output: { scanned: number; expired: number }
}

export const expireQuotesTask: TaskConfig<ExpireQuotesIO> = {
  slug: 'expireQuotes',
  retries: 2,
  handler: async ({ req }) => {
    const cutoff = new Date().toISOString()
    // M21 fix: previously fetched a single page of 100 and dropped any
    // overflow. At low volume this is fine, but a backlog (job didn't run
    // for a few cycles, or a launch spike) would silently leave expired
    // quotes acceptable. Loop until a page returns fewer than the limit.
    const pageLimit = 100
    let scanned = 0
    let expired = 0
    // Clean-room correctness — advance an id cursor each page. The prior
    // loop sorted by id but never passed `id > lastId`, relying on
    // updated rows leaving the `status: quoted` filter. If a quote's
    // update THROWS (caught + logged + continue), it stays `quoted` AND
    // still matches `validUntil < cutoff`, so every subsequent page
    // re-fetched it at position 0 and quotes with larger ids behind it
    // were never reached. Cursoring on the monotonic id guarantees
    // forward progress past a persistently-failing row (matches the
    // sweepAbandonedOrders cursor).
    let lastId: number | string | null = null
    for (let page = 1; page < 100; page++) {
      const cursorClause: import('payload').Where[] =
        lastId != null ? [{ id: { greater_than: lastId } }] : []
      const { docs } = await req.payload.find({
        collection: 'quotes',
        where: {
          and: [
            { status: { equals: 'quoted' } },
            { 'response.validUntil': { less_than: cutoff } },
            ...cursorClause,
          ],
        },
        limit: pageLimit,
        sort: 'id',
        depth: 0,
        overrideAccess: true,
      })
      if (docs.length === 0) break
      scanned += docs.length
      // Advance the cursor before processing so a failing row can't
      // re-anchor the next page at position 0.
      lastId = docs[docs.length - 1]!.id
      for (const q of docs) {
        try {
          await req.payload.update({
            collection: 'quotes',
            id: q.id,
            overrideAccess: true,
            data: { status: 'expired' },
          })
          expired += 1
        } catch (e) {
          req.payload.logger?.error?.(
            `[jobs:expireQuotes] failed for quote ${q.id}: ${(e as Error).message}`,
          )
        }
      }
      if (docs.length < pageLimit) break
    }
    req.payload.logger?.info?.(`[jobs:expireQuotes] expired ${expired}/${scanned}`)
    return { output: { scanned, expired } }
  },
}
