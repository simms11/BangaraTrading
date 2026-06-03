import 'server-only'
import { getPayload, safe } from '@/lib/payload'

const PAID_STATUSES = ['paid', 'processing', 'shipped', 'delivered'] as const

export type AdminReport = {
  windowDays: number
  orderCountTotal: number
  orderCountInWindow: number
  paidGmvMinor: number
  paidGmvWindowMinor: number
  outstandingPayoutsMinor: number
  pendingOrders: number
  refundedMinor: number
  ordersByStatus: Array<{ status: string; count: number }>
  topVendors: Array<{ vendorId: string | number; name: string; gmvMinor: number }>
  topProducts: Array<{ productId: string | number; title: string; unitsSold: number; gmvMinor: number }>
  currency: string
  /**
   * J5 (round-4 M3) — set true when any underlying find() returned exactly
   * the limit (1000), indicating data was silently truncated. The UI must
   * show a banner so admins know the dashboard is no longer authoritative.
   */
  truncated: boolean
}

const EMPTY: AdminReport = {
  windowDays: 30,
  orderCountTotal: 0,
  orderCountInWindow: 0,
  paidGmvMinor: 0,
  paidGmvWindowMinor: 0,
  outstandingPayoutsMinor: 0,
  pendingOrders: 0,
  refundedMinor: 0,
  ordersByStatus: [],
  topVendors: [],
  topProducts: [],
  currency: 'NAD',
  truncated: false,
}

export async function getAdminReport(windowDays: number = 30): Promise<AdminReport> {
  const result = await safe(async () => {
    const payload = await getPayload()
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString()

    // overrideAccess: the caller (/admin-reports route) already verified
    // role=admin via getCurrentUser. The Payload instance here has no req
    // context, so without overrideAccess these reads would be denied.
    const [allOrders, recentOrders, payouts, refunds] = await Promise.all([
      payload.find({
        collection: 'orders',
        limit: 1000,
        depth: 0,
        overrideAccess: true,
      }),
      payload.find({
        collection: 'orders',
        where: { createdAt: { greater_than_equal: since } },
        limit: 1000,
        depth: 0,
        overrideAccess: true,
      }),
      payload.find({
        collection: 'payouts',
        limit: 1000,
        depth: 0,
        overrideAccess: true,
      }),
      payload.find({
        collection: 'refunds',
        // R11 money M1 — include in-flight `processing` refunds so the
        // admin report mirrors what generateVendorStatement actually
        // deducts (was completed-only → outstanding figure ran high).
        where: { status: { in: ['completed', 'processing'] } },
        limit: 1000,
        depth: 0,
        overrideAccess: true,
      }),
    ])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ordersAll = allOrders.docs as any[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ordersWindow = recentOrders.docs as any[]

    const statusCounts = new Map<string, number>()
    let paidGmvMinor = 0
    let pendingOrders = 0
    let currency = 'NAD'
    for (const o of ordersAll) {
      statusCounts.set(o.status, (statusCounts.get(o.status) ?? 0) + 1)
      if (o.status === 'pending_payment') pendingOrders += 1
      if (PAID_STATUSES.includes(o.status as (typeof PAID_STATUSES)[number])) {
        paidGmvMinor += o.totalMinor ?? 0
        currency = o.currency || currency
      }
    }
    const paidGmvWindowMinor = ordersWindow
      .filter((o) => PAID_STATUSES.includes(o.status))
      .reduce((acc, o) => acc + (o.totalMinor ?? 0), 0)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const refundedMinor = (refunds.docs as any[]).reduce(
      (acc, r) => acc + (r.amountMinor ?? 0),
      0,
    )

    // J5 (round-4 M2) — outstanding payouts must respect each vendor's
    // actual commissionRate AND subtract completed refunds. The previous
    // 10% blanket gave dashboards that could be 5-figures off for vendors
    // on non-default rates. Strategy:
    //   1. Collect all vendor ids referenced by paid-order lineItems.
    //   2. Single bulk find on vendors with select={commissionRate}.
    //   3. Per line: pro-rata refund deduction then (1 - rate%) of
    //      remaining as the platform owes.
    const vendorIdsTouched = new Set<string>()
    const refundsByOrder = new Map<string, number>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of refunds.docs as any[]) {
      const oid = typeof r.order === 'object' && r.order != null ? r.order.id : r.order
      const k = String(oid)
      refundsByOrder.set(k, (refundsByOrder.get(k) ?? 0) + (r.amountMinor ?? 0))
    }
    for (const o of ordersAll.filter((x) =>
      PAID_STATUSES.includes(x.status as (typeof PAID_STATUSES)[number]),
    )) {
      for (const li of o.lineItems ?? []) {
        const vId = String(typeof li.vendor === 'object' ? li.vendor?.id : li.vendor)
        if (vId) vendorIdsTouched.add(vId)
      }
    }
    const commissionByVendor = new Map<string, number>()
    if (vendorIdsTouched.size > 0) {
      const ids = Array.from(vendorIdsTouched).map((s) =>
        Number.isNaN(Number(s)) ? s : Number(s),
      )
      const { docs: vendorsRaw } = await payload.find({
        collection: 'vendors',
        where: { id: { in: ids } },
        limit: ids.length,
        depth: 0,
        overrideAccess: true,
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const v of vendorsRaw as any[]) {
        commissionByVendor.set(String(v.id), typeof v.commissionRate === 'number' ? v.commissionRate : 10)
      }
    }

    let totalOwedNet = 0
    for (const o of ordersAll.filter((x) =>
      PAID_STATUSES.includes(x.status as (typeof PAID_STATUSES)[number]),
    )) {
      const orderRefund = refundsByOrder.get(String(o.id)) ?? 0
      const subtotal = o.subtotalMinor ?? 0
      // R8 money M1 — strip the refunded shipping+tax before allocating
      // the refund to vendor goods revenue (matches payouts.ts).
      const nonGoods = (o.shippingMinor ?? 0) + (o.taxMinor ?? 0)
      const orderTotal = o.totalMinor ?? subtotal + nonGoods
      const refundFraction =
        orderTotal > 0 ? Math.min(1, orderRefund / orderTotal) : 0
      const goodsRefund =
        orderRefund > 0 ? Math.max(0, Math.round(orderRefund - nonGoods * refundFraction)) : 0
      // R8 money M3 — aggregate gross per vendor per order, then round
      // commission ONCE per (order, vendor). The previous per-line-item
      // rounding drifted by up to 1 minor unit per order vs the real
      // payout generator (payouts.ts rounds per order), so the admin
      // report never tied out to the cent on odd amounts.
      const vendorGrossInOrder = new Map<string, number>()
      for (const li of o.lineItems ?? []) {
        const vId = String(typeof li.vendor === 'object' ? li.vendor?.id : li.vendor)
        vendorGrossInOrder.set(vId, (vendorGrossInOrder.get(vId) ?? 0) + (li.lineTotalMinor ?? 0))
      }
      for (const [vId, vendorGross] of vendorGrossInOrder) {
        const refundShare =
          goodsRefund > 0 && subtotal > 0
            ? Math.round((goodsRefund * vendorGross) / subtotal)
            : 0
        const adjusted = Math.max(0, vendorGross - refundShare)
        const rate = commissionByVendor.get(vId) ?? 10
        const commission = Math.round((adjusted * rate) / 100)
        totalOwedNet += adjusted - commission
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const paidOutMinor = (payouts.docs as any[])
      .filter((p) => p.status === 'paid')
      .reduce((acc, p) => acc + (p.totalPayoutMinor ?? 0), 0)
    const outstandingPayoutsMinor = Math.max(0, totalOwedNet - paidOutMinor)

    // Vendor + product rankings
    const vendorMap = new Map<string, { name: string; gmvMinor: number }>()
    const productMap = new Map<
      string,
      { title: string; unitsSold: number; gmvMinor: number }
    >()
    for (const o of ordersAll.filter((x) =>
      PAID_STATUSES.includes(x.status as (typeof PAID_STATUSES)[number]),
    )) {
      for (const li of o.lineItems ?? []) {
        const vId = String(typeof li.vendor === 'object' ? li.vendor?.id : li.vendor)
        const existingV = vendorMap.get(vId) ?? { name: '', gmvMinor: 0 }
        existingV.gmvMinor += li.lineTotalMinor ?? 0
        vendorMap.set(vId, existingV)

        const pId = String(typeof li.product === 'object' ? li.product?.id : li.product)
        const existingP =
          productMap.get(pId) ?? { title: li.titleSnapshot, unitsSold: 0, gmvMinor: 0 }
        existingP.unitsSold += li.quantity ?? 0
        existingP.gmvMinor += li.lineTotalMinor ?? 0
        productMap.set(pId, existingP)
      }
    }

    // Resolve vendor names (a single bulk query)
    if (vendorMap.size > 0) {
      const ids = Array.from(vendorMap.keys()).map((s) => (Number.isNaN(Number(s)) ? s : Number(s)))
      const { docs: vendors } = await payload.find({
        collection: 'vendors',
        where: { id: { in: ids } },
        limit: ids.length,
        depth: 0,
        overrideAccess: true,
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const v of vendors as any[]) {
        const existing = vendorMap.get(String(v.id))
        if (existing) existing.name = v.name
      }
    }

    const topVendors = Array.from(vendorMap.entries())
      .map(([vendorId, x]) => ({
        vendorId,
        name: x.name || `Vendor ${vendorId}`,
        gmvMinor: x.gmvMinor,
      }))
      .sort((a, b) => b.gmvMinor - a.gmvMinor)
      .slice(0, 5)

    const topProducts = Array.from(productMap.entries())
      .map(([productId, x]) => ({
        productId,
        title: x.title,
        unitsSold: x.unitsSold,
        gmvMinor: x.gmvMinor,
      }))
      .sort((a, b) => b.gmvMinor - a.gmvMinor)
      .slice(0, 5)

    // J5 (round-4 M3): surface truncation so the dashboard can flag stale
    // numbers instead of quietly underreporting.
    const truncated =
      allOrders.docs.length >= 1000 ||
      recentOrders.docs.length >= 1000 ||
      payouts.docs.length >= 1000 ||
      refunds.docs.length >= 1000

    return {
      windowDays,
      orderCountTotal: ordersAll.length,
      orderCountInWindow: ordersWindow.length,
      paidGmvMinor,
      paidGmvWindowMinor,
      outstandingPayoutsMinor,
      pendingOrders,
      refundedMinor,
      ordersByStatus: Array.from(statusCounts.entries())
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => b.count - a.count),
      topVendors,
      topProducts,
      currency,
      truncated,
    } satisfies AdminReport
  })
  return result.ok ? result.data : EMPTY
}
