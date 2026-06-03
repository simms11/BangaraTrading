import type { TaskConfig } from 'payload'

/**
 * K5 (round-5 privacy M3): the AuditLog collection's own header comment
 * promised a Phase 5.7 sched. job — never delivered. `actorEmail` is
 * plaintext PII; per the privacy policy we retain audit data for 7 years
 * (legal / financial compliance), but everything older than that must be
 * archived/deleted. This runs weekly and deletes rows older than the
 * retention window in batches.
 *
 * 7-year window aligns with `/privacy:124` ("Order data: 7 years —
 * financial-record retention").
 */
type IO = {
  input: Record<string, never>
  output: { scanned: number; deleted: number }
}

const RETENTION_DAYS = 7 * 365
const PRUNE_CHUNK = 500

export const pruneAuditLogTask: TaskConfig<IO> = {
  slug: 'pruneAuditLog',
  retries: 1,
  handler: async ({ req }) => {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
    let scanned = 0
    let deleted = 0
    // R11 — advance an id cursor each page so a row whose delete throws
    // persistently can't re-anchor every page at position 0 (matches
    // sweepAbandonedOrders + expireQuotes).
    let lastId: number | string | null = null
    for (let i = 0; i < 50; i++) {
      const cursorClause: import('payload').Where[] =
        lastId != null ? [{ id: { greater_than: lastId } }] : []
      const { docs } = await req.payload.find({
        collection: 'audit-log',
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
            collection: 'audit-log',
            id: d.id,
            overrideAccess: true,
          })
          deleted += 1
        } catch (e) {
          req.payload.logger?.error?.(
            `[jobs:pruneAuditLog] failed to delete ${d.id}: ${(e as Error).message}`,
          )
        }
      }
      if (docs.length < PRUNE_CHUNK) break
    }
    req.payload.logger?.info?.(
      `[jobs:pruneAuditLog] deleted ${deleted}/${scanned} rows older than ${cutoff.toISOString()}`,
    )
    return { output: { scanned, deleted } }
  },
}
