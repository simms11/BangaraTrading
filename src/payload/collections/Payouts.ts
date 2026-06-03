import type { Access, CollectionConfig, Where } from 'payload'
import { isAdmin } from '../access'

const readAccess: Access = ({ req: { user } }) => {
  if (!user) return false
  if (user.role === 'admin') return true
  if (user.role === 'vendor' && user.vendor) {
    const vendorId = typeof user.vendor === 'object' ? user.vendor.id : user.vendor
    return { vendor: { equals: vendorId } } as Where
  }
  return false
}

export const Payouts: CollectionConfig = {
  slug: 'payouts',
  labels: { singular: 'Payout', plural: 'Payouts' },
  admin: {
    useAsTitle: 'reference',
    defaultColumns: [
      'reference',
      'vendor',
      'periodStart',
      'periodEnd',
      'totalPayoutMinor',
      'status',
    ],
    description:
      'Vendor payouts ledger. Admin generates statements from paid orders and records bank transfers here.',
  },
  access: {
    read: readAccess,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  hooks: {
    // K5 (round-5 state minor m3) — Payouts had zero hooks → admin could
    // silently flip paid → pending (un-doing a payout that hit the bank),
    // cancelled → paid (paying out a cancelled statement), or paid →
    // cancelled (clawing back). All happen with no audit trail. We add
    // a transition allowlist (paid is terminal once paidAt is set) plus
    // an audit row on every status change.
    beforeChange: [
      ({ data, operation, originalDoc }) => {
        if (operation !== 'update') return data
        if (data?.status == null) return data
        const from = originalDoc?.status as string | undefined
        const to = data.status as string
        if (!from || from === to) return data
        // R10 — `failed` was listed both as a transition target and a
        // source state, but it isn't in the Payouts.status select options
        // (pending | processing | paid | cancelled). Dead branch; drop
        // so the allowlist matches the schema. Failed payout attempts
        // surface as Stripe/Flutterwave Connect failures in their own
        // dashboards; the row stays `processing` for ops follow-up.
        const ALLOWED: Record<string, ReadonlyArray<string>> = {
          pending: ['processing', 'cancelled'],
          processing: ['paid', 'cancelled'],
          paid: [], // terminal; clawbacks happen via a new negative payout
          cancelled: [],
        }
        const legal = ALLOWED[from]
        if (!legal || !legal.includes(to)) {
          throw new Error(
            `Refused: payout status transition "${from}" → "${to}" is not allowed. ` +
              `(Legal: ${(legal ?? []).join(', ') || 'none — terminal'})`,
          )
        }
        return data
      },
    ],
    afterChange: [
      // Audit every status transition so ops + compliance have a trail.
      async ({ doc, previousDoc, operation, req }) => {
        if (operation !== 'update') return doc
        if (!previousDoc) return doc
        if (previousDoc.status === doc.status) return doc
        try {
          const { audit } = await import('@/lib/audit')
          await audit({
            payload: req.payload,
            req,
            // R10 — was mislabelled `order.status_changed`; payout
            // transitions now use their own kind so ops audit-log
            // filtering on order events doesn't surface unrelated
            // payout writes.
            kind: 'payout.status_changed',
            subjectType: 'payouts',
            subjectId: String(doc.id),
            diff: { before: { status: previousDoc.status }, after: { status: doc.status } },
            notes: `Payout ${doc.reference} ${previousDoc.status} → ${doc.status}`,
          })
        } catch (e) {
          req.payload.logger?.error?.(
            `[payouts] audit emit failed: ${(e as Error).message}`,
          )
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
      admin: { description: 'Bank transfer reference / Stripe transfer ID / payment ref.' },
    },
    {
      name: 'vendor',
      type: 'relationship',
      relationTo: 'vendors',
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
        { label: 'Paid', value: 'paid' },
        { label: 'Cancelled', value: 'cancelled' },
      ],
    },
    {
      name: 'periodStart',
      type: 'date',
      required: true,
      admin: { description: 'Inclusive start of the period this statement covers.' },
    },
    {
      name: 'periodEnd',
      type: 'date',
      required: true,
      admin: { description: 'Inclusive end of the period.' },
    },
    {
      name: 'lines',
      type: 'array',
      labels: { singular: 'Order', plural: 'Orders covered' },
      fields: [
        { name: 'orderRef', type: 'relationship', relationTo: 'orders', required: true },
        {
          name: 'orderNumberSnapshot',
          type: 'text',
          required: true,
          admin: { description: 'Captured at statement generation time.' },
        },
        { name: 'paidAt', type: 'date' },
        {
          name: 'grossMinor',
          type: 'number',
          required: true,
          min: 0,
          admin: { description: 'Vendor revenue on this order before commission.' },
        },
        {
          name: 'commissionMinor',
          type: 'number',
          required: true,
          min: 0,
          admin: { description: 'Platform commission deducted.' },
        },
        {
          name: 'payoutMinor',
          type: 'number',
          required: true,
          min: 0,
          admin: { description: 'Net owed to vendor (gross - commission).' },
        },
      ],
    },
    {
      name: 'totalGrossMinor',
      type: 'number',
      required: true,
      defaultValue: 0,
      min: 0,
    },
    {
      name: 'totalCommissionMinor',
      type: 'number',
      required: true,
      defaultValue: 0,
      min: 0,
    },
    {
      name: 'totalPayoutMinor',
      type: 'number',
      required: true,
      defaultValue: 0,
      min: 0,
      admin: { description: 'Net amount transferred to the vendor.' },
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
      name: 'paidAt',
      type: 'date',
      admin: { description: 'When the transfer actually cleared.' },
    },
    {
      name: 'notes',
      type: 'textarea',
      admin: { description: 'Internal notes (not surfaced to vendor).' },
      access: {
        read: ({ req: { user } }) => user?.role === 'admin',
      },
    },
  ],
  timestamps: true,
}
