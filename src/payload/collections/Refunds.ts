import type { Access, CollectionConfig, Where } from 'payload'
import { sql } from '@payloadcms/db-postgres'
import { isAdmin } from '../access'
import { auditRefund } from '../hooks/audit'
import type { Refund } from '@/payload-types'

const readAccess: Access = ({ req: { user } }) => {
  if (!user) return false
  if (user.role === 'admin') return true
  if (user.role === 'vendor' && user.vendor) {
    const vendorId = typeof user.vendor === 'object' ? user.vendor.id : user.vendor
    return { vendorRef: { equals: vendorId } } as Where
  }
  return { customer: { equals: user.id } } as Where
}

/**
 * Refunds ledger. One refund per row, linked back to the originating order.
 * Admin creates the row when issuing a refund (processor refund happens
 * out-of-band today; Phase 5.5 wires automated Stripe / Flutterwave refund
 * API calls + reconciliation).
 *
 * Triggers on Orders are handled at the application layer — Refunds.afterChange
 * recalculates the parent Order.status if the cumulative refund covers the
 * order total.
 */
export const Refunds: CollectionConfig = {
  slug: 'refunds',
  labels: { singular: 'Refund', plural: 'Refunds' },
  admin: {
    useAsTitle: 'reference',
    defaultColumns: [
      'reference',
      'order',
      'amountMinor',
      'status',
      'reason',
      'createdAt',
    ],
    description:
      'Customer refunds. Linked to an order. Updating to status=completed marks the order refunded.',
  },
  access: {
    read: readAccess,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  hooks: {
    // M2 fix: hard invariants on refund creation. Previously a refund could
    // be issued (a) for more than the order total, (b) against an order that
    // was never paid, and (c) with a currency different from the order's —
    // each of which silently corrupted accounting. The beforeChange guard
    // refuses the operation server-side so neither the admin UI nor a
    // future server action can bypass it.
    beforeChange: [
      async ({ data, operation, originalDoc, req }) => {
        if (operation !== 'create' && operation !== 'update') return data
        // R10 — resolve orderRef from data first, then fall back to the
        // existing originalDoc.order. The previous early-return when
        // `data.order` was absent let a partial UPDATE (e.g.
        // `{status:'completed'}` with no order field) bypass the
        // cumulative-cap re-check, currency match, transition allowlist,
        // and completed-row immutability check. Reach is limited (refund
        // create/update is admin-only) but a scripted patch could
        // silently mutate completed amounts. Use the saved order link
        // when the incoming patch omits it.
        const orderRefRaw =
          (typeof data.order === 'object' && data.order != null
            ? (data.order as { id?: number | string }).id
            : data.order) ??
          (originalDoc
            ? typeof originalDoc.order === 'object' && originalDoc.order != null
              ? (originalDoc.order as { id?: number | string }).id
              : originalDoc.order
            : undefined)
        const orderRef = orderRefRaw
        if (!orderRef) return data

        // R7 C1/M2 + R8 regression fix — TOCTOU on the cumulative refund
        // cap. Without serialisation, two parallel admin clicks (or
        // admin + webhook collision) both read the existing-refunds list
        // at the same instant, both compute `existing-sum + incoming <=
        // total`, both commit — cumulative refunds end up >100%.
        //
        // The Phase 5.18 attempt ran `pg_advisory_xact_lock` via
        // `req.payload.db.pool.query` — but `.pool` checks out a
        // DIFFERENT idle connection than the one Payload's create
        // transaction uses, so the xact lock committed+released
        // immediately and serialised NOTHING. The round-8 regression
        // audit caught this.
        //
        // The correct fix runs the advisory lock on the SAME connection
        // as the write — i.e. the transaction's drizzle handle, reachable
        // via `db.sessions[req.transactionID].db`. `payload.create`
        // always calls initTransaction first (verified against
        // payload@3.x), so req.transactionID is set inside this hook. The
        // xact lock then genuinely persists until the write transaction
        // commits, serialising concurrent refund inserts for the order.
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const adapter = req.payload.db as any
          // req.transactionID is typed as string|number|Promise but is
          // always resolved by the time hooks run (initTransaction awaits
          // it). Guard to a primitive index just in case.
          const rawTxId = req.transactionID as unknown
          const txId =
            typeof rawTxId === 'string' || typeof rawTxId === 'number'
              ? rawTxId
              : null
          const session = txId != null ? adapter.sessions?.[txId] : null
          if (session?.db?.execute) {
            await session.db.execute(
              sql`SELECT pg_advisory_xact_lock(hashtext(${`refund-cap:${orderRef}`}))`,
            )
          } else {
            // M9 (Phase 2) — pool-level fallback. Verified empirically
            // that Payload.create always inits a transaction so this
            // path shouldn't fire under v3.x, but if a future Payload
            // version changes that contract OR a programmatic path
            // bypasses initTransaction, we still want SOME serialisation.
            // Take a session-scoped pg_advisory_lock on a dedicated
            // pool client and schedule release after 30s (well beyond
            // any reasonable write-commit window). The lock prevents
            // concurrent cap-check phases across processes; it doesn't
            // strictly bracket the write, but it shrinks the race
            // window dramatically. Sentry-warn so ops sees the gap.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const pool = (req.payload.db as any).pool as
              | {
                  connect: () => Promise<{
                    query: (text: string, params?: unknown[]) => Promise<unknown>
                    release: () => void
                  }>
                }
              | undefined
            if (pool) {
              try {
                const client = await pool.connect()
                await client.query(
                  `SELECT pg_advisory_lock(hashtext($1))`,
                  [`refund-cap:${orderRef}`],
                )
                // Best-effort release after 30s. We can't tie to the
                // outer transaction lifecycle from here.
                setTimeout(() => {
                  client
                    .query(`SELECT pg_advisory_unlock(hashtext($1))`, [
                      `refund-cap:${orderRef}`,
                    ])
                    .catch(() => undefined)
                    .finally(() => client.release())
                }, 30_000)
              } catch (e) {
                req.payload.logger?.warn?.(
                  `[refunds] pool-fallback advisory lock failed for order ${orderRef}: ${(e as Error).message}`,
                )
              }
            }
            req.payload.logger?.warn?.(
              `[refunds] no transaction session for advisory lock (order ${orderRef}); using pool-level fallback.`,
            )
            try {
              const Sentry = await import('@sentry/nextjs').catch(() => null)
              Sentry?.captureMessage(
                `Refund cap lock fallback fired for order ${orderRef} — Payload tx context missing`,
                'warning',
              )
            } catch {
              // Sentry not configured
            }
          }
        } catch (e) {
          // Lock acquisition failure is non-fatal — log and continue with
          // the (TOCTOU-vulnerable) check. Better to take the slim risk
          // of an over-refund than to refuse a legitimate refund admin
          // action because of a Postgres hiccup.
          req.payload.logger?.warn?.(
            `[refunds] advisory lock failed for order ${orderRef}: ${(e as Error).message}`,
          )
        }

        // Only check on create or when amount/status changes — re-saving an
        // unchanged completed refund shouldn't re-trigger.
        //
        // R11 production-breaking fix: a partial UPDATE (e.g. the
        // auto-issue afterChange hook patches `{status:'completed',
        // processorRef, refundedAt}` with NO amountMinor) used to be
        // short-circuited by the early-return on missing `data.order`.
        // R10 closed that bypass by falling back to originalDoc.order
        // and reaching the cap+positivity guards. But the positivity
        // check at the bottom of this hook used `Number(data.amountMinor
        // ?? 0)` so an absent amountMinor became 0 and threw "Refund
        // amount must be positive.", breaking every refund completion
        // in production. Fix: track whether amountMinor was actually
        // supplied; for absent-amountMinor UPDATEs use originalDoc's
        // recorded amount for cap math and skip the positivity check.
        const amountSupplied = data.amountMinor !== undefined && data.amountMinor !== null
        const incomingAmount = amountSupplied
          ? Number(data.amountMinor)
          : Number((originalDoc?.amountMinor as number | undefined) ?? 0)
        const incomingCurrency = data.currency
        const incomingStatus = data.status

        const order = (await req.payload.findByID({
          collection: 'orders',
          id: orderRef,
          depth: 0,
          overrideAccess: true,
        })) as { totalMinor?: number; currency?: string; status?: string; orderNumber?: string }
        if (!order) {
          throw new Error('Refund references an unknown order.')
        }
        if (order.status === 'pending_payment') {
          throw new Error(
            `Refund refused: order ${order.orderNumber} is ${order.status} — not paid.`,
          )
        }
        // M1 (round-6 C2) — for cancelled orders, we still allow ONE
        // narrow path: the paid-after-cancel auto-refund created by
        // markOrderPaid. Those rows have a reference prefix of `auto_`
        // (auto_stripe_…, auto_flutterwave_…) and represent the case
        // where Stripe took the customer's money after the sweeper
        // cancelled the order. Refusing here would loop the webhook
        // forever with no refund. Admins issuing a manual refund on a
        // cancelled order (rare) should use a non-auto reference.
        // The cancelled-order guard admits the one legitimate write: the
        // paid-after-cancel auto-refund. That covers both the initial
        // CREATE (reference set in `data`) and downstream UPDATEs to the
        // same row (the auto-issue afterChange flips status to completed
        // /failed). Both paths are identified by an `auto_` reference
        // prefix on the row — checked against `data.reference` for new
        // creates and `originalDoc.reference` for updates of an existing
        // auto-row.
        const refOnRow =
          typeof data.reference === 'string'
            ? data.reference
            : typeof originalDoc?.reference === 'string'
              ? originalDoc.reference
              : null
        const isAutoRefundWrite =
          (operation === 'create' || operation === 'update') &&
          refOnRow !== null &&
          refOnRow.startsWith('auto_')
        if (order.status === 'cancelled' && !isAutoRefundWrite) {
          throw new Error(
            `Refund refused: order ${order.orderNumber} is cancelled — not paid.`,
          )
        }
        if (incomingCurrency && order.currency && incomingCurrency !== order.currency) {
          throw new Error(
            `Refund currency ${incomingCurrency} does not match order currency ${order.currency}.`,
          )
        }
        // J2 (round-4 M3) — immutability of completed refunds. The
        // cumulative cap below excludes `previousId` from the existing
        // sum (so that re-saving the in-flight row doesn't double-count
        // it), which meant editing an already-completed refund's
        // amountMinor upward bypassed the cap entirely. Reject any
        // mutation of `amountMinor` / `currency` / `processorRef` on a
        // completed refund — those are write-once fields.
        if (operation === 'update' && originalDoc?.status === 'completed') {
          const amountChanged =
            data.amountMinor != null && data.amountMinor !== originalDoc.amountMinor
          const currencyChanged =
            data.currency != null && data.currency !== originalDoc.currency
          const refChanged =
            data.processorRef != null && data.processorRef !== originalDoc.processorRef
          if (amountChanged || currencyChanged || refChanged) {
            throw new Error(
              'Refused: amountMinor / currency / processorRef are immutable on a completed refund. Issue a new refund for adjustments.',
            )
          }
        }
        // Cumulative completed-refund cap. We allow the in-flight row to
        // be in any status (pending/processing/completed) but the sum of
        // *all* refund amounts on this order (including this one) must
        // not exceed the order total.
        //
        // K3 (round-5 M5) — also include `cancelled` rows that hold a
        // `processorRef` in the cap. The previous filter dropped every
        // cancelled row from the sum, which meant a refund that actually
        // SUCCEEDED on Stripe but was marked `cancelled` in our row (ops
        // attempting cleanup) silently freed up the cap for a second
        // real refund. Cancelled-without-processorRef = never reached
        // the processor, still safe to drop.
        const { docs: existing } = await req.payload.find({
          collection: 'refunds',
          where: {
            and: [
              { order: { equals: orderRef } },
              { status: { not_equals: 'failed' } },
            ],
          },
          limit: 200,
          depth: 0,
          overrideAccess: true,
        })
        const previousId = originalDoc?.id
        const otherSum = (existing as Array<{
          id: number | string
          amountMinor?: number
          status?: string
          processorRef?: string | null
        }>)
          .filter((r) => String(r.id) !== String(previousId))
          // Drop cancelled rows that never reached the processor.
          .filter((r) => r.status !== 'cancelled' || !!r.processorRef)
          .reduce((acc, r) => acc + (r.amountMinor ?? 0), 0)
        if (otherSum + incomingAmount > (order.totalMinor ?? 0)) {
          throw new Error(
            `Refund refused: cumulative refund ${(otherSum + incomingAmount).toLocaleString()} exceeds order total ${(order.totalMinor ?? 0).toLocaleString()}.`,
          )
        }
        // Belt-and-braces: amount must be positive (collection already
        // has min: 1, but defense-in-depth against a future schema
        // change). Only enforced when amountMinor was actually supplied
        // in this write — a partial UPDATE that doesn't touch amountMinor
        // must not be rejected.
        if (amountSupplied && incomingAmount <= 0) {
          throw new Error('Refund amount must be positive.')
        }
        // If transitioning to "completed", processorRef must be present
        // (so we can dedupe replays via Stripe charge.refunded).
        if (incomingStatus === 'completed' && !data.processorRef) {
          throw new Error('Refund cannot be marked completed without a processorRef.')
        }

        // M3 (round-6) — explicit transition allowlist. Refund status had
        // no transition guards: an admin could flip a `completed` refund
        // back to `pending`, "reusing" the row to issue a second refund
        // against the processor without tripping the cumulative cap (the
        // cap uses the in-flight amount, not history). We allow:
        //   pending    → processing | cancelled
        //   processing → completed | failed | cancelled
        //   completed  → (terminal — only the auto-sync hook may write)
        //   cancelled  → (terminal)
        //   failed     → pending     (retry path)
        //
        // M3 (Phase 2 fix) — system-hook bypass detection used to be
        // `!req.user`, which was too permissive: ANY server-side caller
        // using `overrideAccess: true` without a session (jobs, server
        // actions, future reconciler scripts) bypassed the allowlist.
        // The auto-issue afterChange below now sets a marked context
        // flag `req.context.systemRefundUpdate = true` and passes `req`
        // to its inner `payload.update`. We check the flag instead of
        // the absence of a user; only the explicit marker bypasses.
        if (operation === 'update' && originalDoc?.status && incomingStatus) {
          const from = originalDoc.status as string
          const to = incomingStatus as string
          if (from !== to) {
            const allowed: Record<string, string[]> = {
              pending: ['processing', 'cancelled'],
              processing: ['completed', 'failed', 'cancelled'],
              completed: [],
              cancelled: [],
              failed: ['pending'],
            }
            const isSystemHookWrite =
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (req as any).context?.systemRefundUpdate === true
            if (!isSystemHookWrite && !(allowed[from] ?? []).includes(to)) {
              throw new Error(
                `Refund refused: transition ${from} → ${to} not allowed. Issue a new refund row instead of editing this one.`,
              )
            }
          }
        }
        return data
      },
    ],
    afterChange: [
      auditRefund,
      // Auto-issue the processor refund when status transitions to "processing".
      // On success we flip status to "completed", which the next hook in this
      // chain picks up to sync the parent Order status. Failures stay at
      // "processing" with the error captured in description; ops can retry.
      async ({ doc, previousDoc, req }) => {
        const wasProcessing = previousDoc?.status === 'processing'
        const isProcessing = doc?.status === 'processing'
        if (!isProcessing || wasProcessing) return doc
        // R8 money M4 — do NOT auto-complete manual-payment refunds. A
        // manual refund has no processor API to call; the previous code
        // had issueProcessorRefund return ok:true with processorRef set
        // to the refund's own reference, auto-flipping it to 'completed'
        // before the bank transfer actually happened. Ops then had no
        // signal money was still owed. For manual refunds we leave the
        // row in 'processing' and require ops to mark it completed with
        // a real bank reference once the transfer clears.
        if (doc.processor === 'manual') {
          req.payload.logger?.info?.(
            `[refunds] ${doc.reference} is manual — leaving in 'processing' for ops to confirm the bank transfer.`,
          )
          return doc
        }
        try {
          const { issueProcessorRefund } = await import('@/lib/payments/refund')
          const result = await issueProcessorRefund({
            payload: req.payload,
            refund: doc as Refund,
          })
          // M3 (Phase 2) — mark the inner update as the system path so
          // the beforeChange allowlist permits the otherwise-blocked
          // `processing → completed/failed` transition. We mutate
          // req.context (Payload merges it across the nested operation
          // via createLocalReq) and pass req explicitly so the inner
          // beforeChange sees the flag.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const sysReq = req as any
          sysReq.context = { ...(sysReq.context ?? {}), systemRefundUpdate: true }
          if (result.ok) {
            await req.payload.update({
              collection: 'refunds',
              id: doc.id,
              overrideAccess: true,
              req,
              data: {
                status: 'completed',
                processorRef: result.processorRef,
                refundedAt: new Date().toISOString(),
              },
            })
            req.payload.logger?.info?.(
              `[refunds] ${doc.reference} processor refund OK → ${result.processorRef}`,
            )
          } else {
            await req.payload.update({
              collection: 'refunds',
              id: doc.id,
              overrideAccess: true,
              req,
              data: {
                status: 'failed',
                description:
                  (doc.description ? doc.description + '\n\n' : '') +
                  `[auto-refund] ${result.error}`,
              },
            })
            req.payload.logger?.error?.(
              `[refunds] ${doc.reference} processor refund failed: ${result.error}`,
            )
          }
        } catch (e) {
          req.payload.logger?.error?.(
            `[refunds] auto-issue error: ${(e as Error).message}`,
          )
        }
        return doc
      },
      async ({ doc, previousDoc, req }) => {
        const wasCompleted = previousDoc?.status === 'completed'
        const isCompleted = doc?.status === 'completed'
        if (!isCompleted || wasCompleted) return doc
        try {
          const orderId =
            typeof doc.order === 'object' ? doc.order?.id : doc.order
          if (!orderId) return doc
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const order: any = await req.payload.findByID({
            collection: 'orders',
            id: orderId,
            depth: 0,
          })
          if (!order) return doc
          // Sum existing completed refunds for this order.
          // Note: include the doc we just saved — under some adapters the
          // afterChange query's snapshot lags by a few ms.
          const { docs: refunds } = await req.payload.find({
            collection: 'refunds',
            where: {
              and: [
                { order: { equals: orderId } },
                { status: { equals: 'completed' } },
              ],
            },
            limit: 200,
            depth: 0,
          })
          const seenIds = new Set<string>()
          let totalRefunded = 0
          for (const r of refunds as Array<{ id: number | string; amountMinor?: number }>) {
            seenIds.add(String(r.id))
            totalRefunded += r.amountMinor ?? 0
          }
          // Belt and braces: if our own doc isn't in the query result yet, add it.
          if (!seenIds.has(String(doc.id))) {
            totalRefunded += doc.amountMinor ?? 0
          }
          const fullyRefunded = totalRefunded >= (order.totalMinor ?? 0)
          if (fullyRefunded && order.status !== 'refunded') {
            // I7 (M6) fix: conditional UPDATE so two concurrent refund
            // hook-2 invocations don't both race to write 'refunded' (the
            // second invocation reading a stale snapshot might believe
            // the cumulative refund hasn't reached the total yet, but
            // already-refunded orders shouldn't transition again). Only
            // flip if the row is still in a non-refunded paid-ish state.
            await req.payload.update({
              collection: 'orders',
              where: {
                and: [
                  { id: { equals: orderId } },
                  { status: { not_equals: 'refunded' } },
                  { status: { not_equals: 'cancelled' } },
                ],
              },
              data: { status: 'refunded' },
            })
          }
          req.payload.logger?.info?.(
            `[refunds] ${doc.reference} completed; order ${order.orderNumber} ${
              fullyRefunded ? 'fully refunded' : 'partially refunded'
            } (total ${totalRefunded} / ${order.totalMinor})`,
          )

          // M1 (round-6 C3) — refund-after-payout detection. Once a payout
          // statement has settled for this order, the vendor was paid on
          // the order's gross. A subsequent refund means the platform
          // refunded the customer but the vendor's next statement (which
          // skips already-covered orders) won't deduct anything — permanent
          // silent leakage. Detect the overlap, audit it, and Sentry-alert
          // so ops can issue a clawback (negative payout, manual today).
          //
          // We deliberately use raw SQL against the payouts_lines junction
          // rather than payload.find with 'lines.orderRef' traversal —
          // the latter compiles to a query that has hung on the test pool
          // under certain Drizzle releases, and we're already inside an
          // active transaction so a hang here cascades to pool exhaustion.
          try {
            const pool = (req.payload.db as unknown as {
              pool?: {
                query: (text: string, params?: unknown[]) => Promise<{
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  rows: any[]
                }>
              }
            }).pool
            if (pool) {
              const overlap = await pool.query(
                `SELECT p.id AS id, p.reference AS reference
                   FROM payouts_lines pl
                   JOIN payouts p ON p.id = pl._parent_id
                   WHERE pl.order_ref_id = $1
                     AND p.status IN ('paid', 'processing')
                   LIMIT 5`,
                [orderId],
              )
              if (overlap.rows.length > 0) {
                const refs = overlap.rows.map((r) => r.reference).join(', ')
                req.payload.logger?.warn?.(
                  `[refunds] CLAWBACK REQUIRED: refund ${doc.reference} (${doc.amountMinor}) landed on order ${order.orderNumber} already in paid payout(s) [${refs}]. Vendor was paid the gross — create a negative payout to claw back.`,
                )
                try {
                  const Sentry = await import('@sentry/nextjs').catch(() => null)
                  Sentry?.captureMessage(
                    `Refund-after-payout: order ${order.orderNumber} refund ${doc.reference} — clawback required from payout(s) ${refs}`,
                    'warning',
                  )
                } catch {
                  // Sentry not configured — log + audit already capture
                }
              }
            }
          } catch (e) {
            req.payload.logger?.error?.(
              `[refunds] payout overlap check failed: ${(e as Error).message}`,
            )
          }
        } catch (e) {
          req.payload.logger?.error?.(`[refunds] order sync failed: ${(e as Error).message}`)
        }
        return doc
      },
    ],
  },
  fields: [
    {
      name: 'reference',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: { description: 'Internal reference / processor refund id.' },
    },
    {
      name: 'order',
      type: 'relationship',
      relationTo: 'orders',
      required: true,
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Processing', value: 'processing' },
        { label: 'Completed', value: 'completed' },
        { label: 'Failed', value: 'failed' },
        { label: 'Cancelled', value: 'cancelled' },
      ],
    },
    {
      name: 'amountMinor',
      type: 'number',
      required: true,
      min: 1,
      admin: { description: 'Refund amount in minor units (cents).' },
    },
    {
      name: 'currency',
      type: 'select',
      required: true,
      defaultValue: 'NAD',
      options: [
        { label: 'NAD', value: 'NAD' },
        { label: 'ZAR', value: 'ZAR' },
        { label: 'USD', value: 'USD' },
        { label: 'GBP', value: 'GBP' },
        { label: 'EUR', value: 'EUR' },
      ],
    },
    {
      name: 'reason',
      type: 'select',
      required: true,
      defaultValue: 'requested_by_customer',
      options: [
        { label: 'Requested by customer', value: 'requested_by_customer' },
        { label: 'Quality issue', value: 'quality' },
        { label: 'Out of stock', value: 'out_of_stock' },
        { label: 'Lost in transit', value: 'lost_in_transit' },
        { label: 'Fraud / chargeback', value: 'fraud' },
        { label: 'Other', value: 'other' },
      ],
    },
    {
      name: 'description',
      type: 'textarea',
      admin: { description: 'Free-text notes — visible to customer.' },
    },
    {
      name: 'processor',
      type: 'select',
      options: [
        { label: 'Stripe', value: 'stripe' },
        { label: 'Flutterwave', value: 'flutterwave' },
        { label: 'Manual / bank transfer', value: 'manual' },
      ],
      admin: { description: 'How the refund was issued.' },
    },
    {
      name: 'processorRef',
      type: 'text',
      admin: { description: 'Processor refund id (re_… for Stripe, etc.)' },
    },
    {
      name: 'customer',
      type: 'relationship',
      relationTo: 'users',
      admin: { description: 'Captured from the order at creation time.' },
    },
    {
      name: 'vendorRef',
      type: 'relationship',
      relationTo: 'vendors',
      admin: { description: 'Primary vendor on the original order (for scoping).' },
    },
    {
      name: 'refundedAt',
      type: 'date',
      admin: { description: 'When funds actually returned to the customer.' },
    },
  ],
  timestamps: true,
}
