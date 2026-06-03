import 'server-only'
import { nanoid } from 'nanoid'
import type { Pool, PoolClient } from 'pg'
import { getPayload } from '@/lib/payload'

const PAID_STATUSES = ['paid', 'processing', 'shipped', 'delivered'] as const

export type GenerateStatementInput = {
  vendorId: number | string
  periodStart: string // ISO date
  periodEnd: string // ISO date inclusive
}

export type GenerateStatementResult =
  | {
      ok: true
      payoutId: string | number
      reference: string
      ordersCovered: number
      totalGrossMinor: number
      totalCommissionMinor: number
      totalPayoutMinor: number
      currency: string
    }
  | { ok: false; error: string }

/**
 * Builds a payout statement for a vendor over a date range.
 *
 * Scope: paid orders (status in PAID_STATUSES) created within the range
 * that contain one or more line items belonging to the vendor and that are
 * not already covered by an existing Payout doc.
 *
 * Commission: vendor.commissionRate% of vendor's gross share per order.
 */
export async function generateVendorStatement(
  input: GenerateStatementInput,
): Promise<GenerateStatementResult> {
  const payload = await getPayload()
  const pool = (payload.db as unknown as { pool: Pool }).pool

  // I3 (C3) fix: serialise concurrent generateVendorStatement calls for the
  // same vendor with a Postgres advisory lock. The previous logic computed
  // `coveredOrderIds` from a snapshot read of `payouts`, so two admins
  // running the function at the same instant both saw orders 1-10 as
  // uncovered and both created payouts — vendor paid twice. The lock is
  // taken on a connection that holds it for the duration of the statement;
  // we release in finally.
  //
  // The lock key uses hashtext('payouts:'||vendor_id) which is a stable
  // 32-bit hash that fits the advisory-lock interface. Collisions between
  // different vendors are harmless (false-positive serialisation).
  const lockKey = `payouts:${input.vendorId}`
  const client: PoolClient = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [lockKey])
    try {
      return await runUnderLock(client, payload, input)
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey])
    }
  } finally {
    client.release()
  }
}

async function runUnderLock(
  // The lock is held on `client`, but the existing logic uses Payload's
  // local API. Payload acquires its own connections from the same pool —
  // a different connection won't see the in-flight uncommitted insert,
  // but that's fine: the advisory lock ensures no other generateVendorStatement
  // runs concurrently. Within the lock, this function's reads/writes
  // happen as a normal sequence.
  _client: PoolClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any,
  input: GenerateStatementInput,
): Promise<GenerateStatementResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vendor: any = await payload.findByID({
    collection: 'vendors',
    id: input.vendorId,
    depth: 0,
    overrideAccess: true,
  })
  if (!vendor) return { ok: false, error: 'Vendor not found.' }

  const commissionRate =
    typeof vendor.commissionRate === 'number' ? vendor.commissionRate : 10

  const periodStart = new Date(input.periodStart)
  const periodEnd = new Date(input.periodEnd)
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    return { ok: false, error: 'Invalid date range.' }
  }
  if (periodStart > periodEnd) {
    return { ok: false, error: 'periodStart must be on or before periodEnd.' }
  }

  // I8 (M14): paid-orders and existing-payouts both capped at 1000. For a
  // high-volume vendor with >1000 paid orders in the requested window,
  // the silent ceiling would have dropped real orders from the statement.
  // We throw on overflow so ops sees the problem and either narrows the
  // window or asks for pagination support. Same for the covered-payouts
  // lookup — exceeding 1000 historical payouts is unrealistic but worth
  // surfacing.
  //
  // System-context: this function is admin-gated by the API route + the
  // advisory lock above, so we skip per-row access checks and trust the
  // route boundary.
  const ordersResult = await payload.find({
    collection: 'orders',
    where: {
      and: [
        { 'lineItems.vendor': { equals: input.vendorId } },
        { status: { in: [...PAID_STATUSES] } },
        { createdAt: { greater_than_equal: periodStart.toISOString() } },
        { createdAt: { less_than_equal: periodEnd.toISOString() } },
      ],
    },
    limit: 1000,
    depth: 0,
    overrideAccess: true,
  })
  if (ordersResult.totalDocs > 1000) {
    return {
      ok: false,
      error: `Vendor has ${ordersResult.totalDocs} paid orders in the requested window — exceeds the 1000-order single-statement limit. Narrow the date range and re-run.`,
    }
  }

  // Find orders already covered by an existing payout for this vendor.
  const existingPayouts = await payload.find({
    collection: 'payouts',
    where: { vendor: { equals: input.vendorId } },
    limit: 1000,
    depth: 0,
    overrideAccess: true,
  })
  if (existingPayouts.totalDocs > 1000) {
    return {
      ok: false,
      error: `Vendor has ${existingPayouts.totalDocs} historical payouts — exceeds the 1000 cap. Contact engineering to enable cursor pagination.`,
    }
  }
  const coveredOrderIds = new Set<string>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const p of existingPayouts.docs as any[]) {
    for (const line of p.lines ?? []) {
      const oid = typeof line.orderRef === 'object' ? line.orderRef?.id : line.orderRef
      if (oid != null) coveredOrderIds.add(String(oid))
    }
  }

  const lines: Array<{
    orderRef: number | string
    orderNumberSnapshot: string
    paidAt?: string
    grossMinor: number
    commissionMinor: number
    payoutMinor: number
  }> = []
  let totalGrossMinor = 0
  let totalCommissionMinor = 0
  let totalPayoutMinor = 0
  let currency: string | null = null

  // M6 fix: subtract completed refunds from each order's vendor gross before
  // commission. Previously a partial refund (which leaves order.status='paid')
  // had no effect on payouts — the vendor was paid the original gross even
  // though the platform refunded the customer. Pull all completed refunds
  // for the candidate orders in one query and proportionally deduct.
  const candidateOrderIds = (ordersResult.docs as Array<{ id: number | string }>)
    .map((o) => o.id)
    .filter((id) => !coveredOrderIds.has(String(id)))
  const refundsByOrder = new Map<string, number>()
  if (candidateOrderIds.length > 0) {
    const refundsResult = await payload.find({
      collection: 'refunds',
      where: {
        and: [
          { order: { in: candidateOrderIds } },
          // R11 money M1 — include in-flight `processing` refunds too,
          // not just `completed`. After the R7 Stripe-refund-status
          // mapping, a Stripe refund reported as `pending` (e.g.
          // bank-rejected ACH that may still settle) writes as
          // `processing` in our ledger. The previous filter skipped
          // those, so a vendor statement generated while a refund was
          // in-flight paid the vendor the full gross and the refund
          // landed on a covered order → silent overpayment. Including
          // processing rows pre-empts the overlap; if the refund later
          // moves to `failed`, the next statement excludes it
          // automatically.
          { status: { in: ['completed', 'processing'] } },
        ],
      },
      limit: 1000,
      depth: 0,
      overrideAccess: true,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of refundsResult.docs as any[]) {
      const oid =
        typeof r.order === 'object' && r.order != null ? r.order.id : r.order
      const key = String(oid)
      refundsByOrder.set(key, (refundsByOrder.get(key) ?? 0) + (r.amountMinor ?? 0))
    }
  }
  // R8 money M1 — build an order lookup so we can subtract the
  // shipping+tax portion of a refund before allocating it to vendor
  // goods revenue (see the pro-rata block below).
  const orderById = new Map<string, { subtotalMinor?: number; shippingMinor?: number; taxMinor?: number; totalMinor?: number }>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const o of ordersResult.docs as any[]) {
    orderById.set(String(o.id), {
      subtotalMinor: o.subtotalMinor,
      shippingMinor: o.shippingMinor,
      taxMinor: o.taxMinor,
      totalMinor: o.totalMinor,
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const o of ordersResult.docs as any[]) {
    if (coveredOrderIds.has(String(o.id))) continue
    let vendorGross = 0
    for (const li of o.lineItems ?? []) {
      const liVendor = typeof li.vendor === 'object' ? li.vendor?.id : li.vendor
      if (String(liVendor) === String(input.vendorId)) {
        vendorGross += li.lineTotalMinor ?? 0
      }
    }
    if (vendorGross === 0) continue
    // Allocate refund pro-rata over GOODS value only. R8 money M1 fix:
    // a refund's amountMinor is sized against order.totalMinor (subtotal
    // + shipping + tax), but the vendor only ever earned the goods
    // subtotal — they never received the shipping or tax. The previous
    // code divided the full refund by subtotalMinor, so on a partial
    // refund the vendor's goods revenue absorbed the refunded shipping
    // AND tax (tax especially is the platform's liability to the
    // authority, never the vendor's). We first strip the non-goods
    // portion of the refund, then allocate only the goods refund across
    // vendors by their goods share.
    const orderRefundTotal = refundsByOrder.get(String(o.id)) ?? 0
    let vendorRefundShare = 0
    if (orderRefundTotal > 0 && o.subtotalMinor && o.subtotalMinor > 0) {
      const nonGoods = (o.shippingMinor ?? 0) + (o.taxMinor ?? 0)
      const orderTotal = o.totalMinor ?? o.subtotalMinor + nonGoods
      // Proportion of the refund attributable to goods. If the refund
      // is a full refund (== total), goodsRefund == subtotal. If partial,
      // scale the non-goods deduction by the refund fraction so a 50%
      // refund only strips 50% of shipping+tax.
      const refundFraction = orderTotal > 0 ? Math.min(1, orderRefundTotal / orderTotal) : 0
      const goodsRefund = Math.max(
        0,
        Math.round(orderRefundTotal - nonGoods * refundFraction),
      )
      vendorRefundShare = Math.round((goodsRefund * vendorGross) / o.subtotalMinor)
    }
    const adjustedGross = Math.max(0, vendorGross - vendorRefundShare)
    if (adjustedGross === 0) continue
    const commissionMinor = Math.round((adjustedGross * commissionRate) / 100)
    const payoutMinor = adjustedGross - commissionMinor
    lines.push({
      orderRef: o.id,
      orderNumberSnapshot: o.orderNumber,
      paidAt: o.payment?.paidAt,
      grossMinor: adjustedGross,
      commissionMinor,
      payoutMinor,
    })
    totalGrossMinor += adjustedGross
    totalCommissionMinor += commissionMinor
    totalPayoutMinor += payoutMinor
    currency = currency ?? o.currency
  }

  if (lines.length === 0) {
    return { ok: false, error: 'No new orders to pay out in this range.' }
  }

  const reference = `PO-${new Date().toISOString().slice(2, 7).replace('-', '')}-${nanoid(6).toUpperCase()}`

  const vendorIdNum =
    typeof input.vendorId === 'number' ? input.vendorId : parseInt(String(input.vendorId), 10)
  if (Number.isNaN(vendorIdNum)) {
    return { ok: false, error: 'Invalid vendor id.' }
  }
  const payout = await payload.create({
    collection: 'payouts',
    overrideAccess: true,
    data: {
      reference,
      vendor: vendorIdNum,
      status: 'pending',
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      lines: lines.map((l) => ({
        orderRef:
          typeof l.orderRef === 'number' ? l.orderRef : parseInt(String(l.orderRef), 10),
        orderNumberSnapshot: l.orderNumberSnapshot,
        paidAt: l.paidAt,
        grossMinor: l.grossMinor,
        commissionMinor: l.commissionMinor,
        payoutMinor: l.payoutMinor,
      })),
      totalGrossMinor,
      totalCommissionMinor,
      totalPayoutMinor,
      currency: (currency ?? 'NAD') as 'NAD' | 'ZAR' | 'USD' | 'GBP' | 'EUR',
    },
  })

  return {
    ok: true,
    payoutId: payout.id,
    reference,
    ordersCovered: lines.length,
    totalGrossMinor,
    totalCommissionMinor,
    totalPayoutMinor,
    currency: currency ?? 'NAD',
  }
}
