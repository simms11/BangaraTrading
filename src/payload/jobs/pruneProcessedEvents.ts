import type { TaskConfig } from 'payload'

/**
 * I7 (M8) — Phase 5.5+ promise made good. The processed-events ledger is
 * the webhook-idempotency table: every Stripe/Flutterwave event id we've
 * handled. It grows ~1 row per real payment event, plus retries. Rows
 * older than 90 days will never be retried (Stripe stops retrying after
 * 3 days), so we prune them to keep the indexed lookup fast.
 *
 * Runs daily. Deletes in chunks to keep the transaction small.
 */
type IO = {
  input: Record<string, never>
  output: { scanned: number; deleted: number }
}

const RETENTION_DAYS = 90
const PRUNE_CHUNK = 500

export const pruneProcessedEventsTask: TaskConfig<IO> = {
  slug: 'pruneProcessedEvents',
  retries: 1,
  handler: async ({ req }) => {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
    let scanned = 0
    let deleted = 0
    // R11 — id cursor so a row whose delete throws persistently can't
    // re-anchor every page at position 0.
    let lastId: number | string | null = null
    for (let i = 0; i < 50; i++) {
      const cursorClause: import('payload').Where[] =
        lastId != null ? [{ id: { greater_than: lastId } }] : []
      const { docs } = await req.payload.find({
        collection: 'processed-events',
        where: {
          and: [
            { createdAt: { less_than: cutoff.toISOString() } },
            ...cursorClause,
          ],
        },
        limit: PRUNE_CHUNK,
        depth: 0,
        sort: 'id',
        overrideAccess: true,
      })
      if (docs.length === 0) break
      scanned += docs.length
      lastId = docs[docs.length - 1]!.id
      for (const d of docs) {
        try {
          await req.payload.delete({
            collection: 'processed-events',
            id: d.id,
            overrideAccess: true,
          })
          deleted += 1
        } catch (e) {
          req.payload.logger?.error?.(
            `[jobs:pruneProcessedEvents] failed to delete ${d.id}: ${(e as Error).message}`,
          )
        }
      }
      if (docs.length < PRUNE_CHUNK) break
    }
    req.payload.logger?.info?.(
      `[jobs:pruneProcessedEvents] deleted ${deleted}/${scanned} (cutoff ${cutoff.toISOString()})`,
    )
    return { output: { scanned, deleted } }
  },
}
