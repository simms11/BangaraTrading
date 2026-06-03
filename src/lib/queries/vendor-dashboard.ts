import 'server-only'
import { cache } from 'react'
import { getPayload, safe } from '@/lib/payload'

const PAID_STATUSES = ['paid', 'processing', 'shipped', 'delivered'] as const

/**
 * Vendor-dashboard queries.
 *
 * All calls below use `overrideAccess: true` and manually scope by
 * `vendor: { equals: vendorId }`. We do NOT rely on Payload's per-row
 * access functions here because:
 *
 *   1. `getPayload()` returns an instance with no `req` context; the
 *      access rules look at `req.user` and would deny anonymous reads.
 *   2. The caller already authenticated the vendor SSR-side via
 *      getCurrentUser() before invoking these helpers, so the scoping
 *      is the trust boundary — overrideAccess + manual scope is the
 *      correct shape for a system query.
 *
 * Read paths exposed to anonymous traffic (storefront /products etc.)
 * keep the per-row rules — those queries don't use overrideAccess.
 */

export const getVendorById = cache(async (vendorId: number | string) => {
  const result = await safe(async () => {
    const payload = await getPayload()
    return payload.findByID({
      collection: 'vendors',
      id: vendorId,
      depth: 1,
      overrideAccess: true,
    })
  })
  return result.ok ? result.data : null
})

export const listVendorProducts = cache(async (vendorId: number | string) => {
  const result = await safe(async () => {
    const payload = await getPayload()
    const { docs } = await payload.find({
      collection: 'products',
      where: { vendor: { equals: vendorId } },
      sort: '-createdAt',
      limit: 200,
      depth: 0,
      overrideAccess: true,
    })
    return docs
  })
  return result.ok ? result.data : []
})

export const listVendorOrders = cache(async (vendorId: number | string) => {
  const result = await safe(async () => {
    const payload = await getPayload()
    const { docs } = await payload.find({
      collection: 'orders',
      where: { 'lineItems.vendor': { equals: vendorId } },
      sort: '-createdAt',
      limit: 100,
      depth: 0,
      overrideAccess: true,
    })
    return docs
  })
  return result.ok ? result.data : []
})

export const listVendorPayouts = cache(async (vendorId: number | string) => {
  const result = await safe(async () => {
    const payload = await getPayload()
    const { docs } = await payload.find({
      collection: 'payouts',
      where: { vendor: { equals: vendorId } },
      sort: '-periodEnd',
      limit: 50,
      depth: 0,
      overrideAccess: true,
    })
    return docs
  })
  return result.ok ? result.data : []
})

export type VendorStats = {
  productCount: number
  publishedProductCount: number
  paidOrderCount: number
  paidGmvMinor: number
  outstandingPayoutMinor: number
  paidOutMinor: number
  currency: string
}

/**
 * Roll up the vendor's slice of every paid order, less any payouts already
 * recorded. "Outstanding" = vendor's share of paid orders not yet covered
 * by a Payout doc.
 */
export const getVendorStats = cache(async (vendorId: number | string): Promise<VendorStats> => {
  const empty: VendorStats = {
    productCount: 0,
    publishedProductCount: 0,
    paidOrderCount: 0,
    paidGmvMinor: 0,
    outstandingPayoutMinor: 0,
    paidOutMinor: 0,
    currency: 'NAD',
  }
  const result = await safe(async () => {
    const payload = await getPayload()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vendor: any = await payload.findByID({
      collection: 'vendors',
      id: vendorId,
      depth: 0,
      overrideAccess: true,
    })
    const commissionRate = typeof vendor?.commissionRate === 'number' ? vendor.commissionRate : 10

    const [{ docs: products }, { docs: paidOrders }, { docs: payouts }] = await Promise.all([
      payload.find({
        collection: 'products',
        where: { vendor: { equals: vendorId } },
        limit: 500,
        depth: 0,
        overrideAccess: true,
      }),
      payload.find({
        collection: 'orders',
        where: {
          and: [
            { 'lineItems.vendor': { equals: vendorId } },
            { status: { in: [...PAID_STATUSES] } },
          ],
        },
        limit: 500,
        depth: 0,
        overrideAccess: true,
      }),
      payload.find({
        collection: 'payouts',
        where: { vendor: { equals: vendorId } },
        limit: 500,
        depth: 0,
        overrideAccess: true,
      }),
    ])

    // I9 (M20) fix: round-2's M6 fix subtracted completed refunds in the
    // actual payout generator but this stats helper (used by the vendor
    // /vendor/payouts dashboard) still reported gross. After a partial
    // refund the vendor saw "Outstanding: N$500" but the real payout
    // would pay them N$400 — looked like the platform stole money. We
    // pull completed refunds for the candidate orders and subtract the
    // vendor's pro-rata share, mirroring the math in src/lib/payouts.ts.
    const candidateOrderIds = (paidOrders as Array<{ id: number | string }>).map((o) => o.id)
    const refundsByOrder = new Map<string, number>()
    if (candidateOrderIds.length > 0) {
      const { docs: completedRefunds } = await payload.find({
        collection: 'refunds',
        where: {
          and: [
            { order: { in: candidateOrderIds } },
            // R11 money M1 — include in-flight `processing` refunds.
            // See payouts.ts for the rationale (the dashboard must
            // mirror the statement generator's view of what's already
            // refunded, else outstanding payouts displays a value
            // higher than the next statement will actually pay).
            { status: { in: ['completed', 'processing'] } },
          ],
        },
        limit: 1000,
        depth: 0,
        overrideAccess: true,
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const r of completedRefunds as any[]) {
        const oid = typeof r.order === 'object' && r.order != null ? r.order.id : r.order
        const key = String(oid)
        refundsByOrder.set(key, (refundsByOrder.get(key) ?? 0) + (r.amountMinor ?? 0))
      }
    }

    let paidGmvMinor = 0
    let currency = 'NAD'
    for (const o of paidOrders) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const order: any = o
      currency = order.currency || currency
      let vendorLineGross = 0
      for (const li of order.lineItems ?? []) {
        const liVendor = typeof li.vendor === 'object' ? li.vendor?.id : li.vendor
        if (String(liVendor) === String(vendorId)) {
          vendorLineGross += li.lineTotalMinor ?? 0
        }
      }
      if (vendorLineGross === 0) continue
      // Pro-rata refund deduction over GOODS value only (R8 money M1 —
      // matches the corrected payouts.ts allocation; strip the refunded
      // shipping+tax before charging the vendor's goods revenue).
      const orderRefundTotal = refundsByOrder.get(String(order.id)) ?? 0
      let vendorRefundShare = 0
      if (orderRefundTotal > 0 && order.subtotalMinor && order.subtotalMinor > 0) {
        const nonGoods = (order.shippingMinor ?? 0) + (order.taxMinor ?? 0)
        const orderTotal = order.totalMinor ?? order.subtotalMinor + nonGoods
        const refundFraction =
          orderTotal > 0 ? Math.min(1, orderRefundTotal / orderTotal) : 0
        const goodsRefund = Math.max(
          0,
          Math.round(orderRefundTotal - nonGoods * refundFraction),
        )
        vendorRefundShare = Math.round(
          (goodsRefund * vendorLineGross) / order.subtotalMinor,
        )
      }
      paidGmvMinor += Math.max(0, vendorLineGross - vendorRefundShare)
    }
    const commissionMinor = Math.round((paidGmvMinor * commissionRate) / 100)
    const owedNetMinor = paidGmvMinor - commissionMinor

    let paidOutMinor = 0
    for (const p of payouts) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payout: any = p
      if (payout.status === 'paid') paidOutMinor += payout.totalPayoutMinor ?? 0
    }

    return {
      productCount: products.length,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      publishedProductCount: (products as any[]).filter((p) => p.status === 'published').length,
      paidOrderCount: paidOrders.length,
      paidGmvMinor,
      outstandingPayoutMinor: Math.max(0, owedNetMinor - paidOutMinor),
      paidOutMinor,
      currency,
    }
  })
  return result.ok ? result.data : empty
})
