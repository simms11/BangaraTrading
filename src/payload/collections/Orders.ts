import type { Access, CollectionConfig, Where } from 'payload'
import { isAdmin } from '../access'
import { auditOrder } from '../hooks/audit'

const readAccess: Access = ({ req: { user } }) => {
  if (!user) return false
  if (user.role === 'admin') return true
  if (user.role === 'vendor' && user.vendor) {
    const vendorId = typeof user.vendor === 'object' ? user.vendor.id : user.vendor
    return { 'lineItems.vendor': { equals: vendorId } } as Where
  }
  return { customer: { equals: user.id } } as Where
}

export const Orders: CollectionConfig = {
  slug: 'orders',
  admin: {
    useAsTitle: 'orderNumber',
    defaultColumns: ['orderNumber', 'status', 'totalMinor', 'currency', 'customer', 'createdAt'],
  },
  access: {
    // Customers don't POST orders directly — they're created via the checkout
    // server action (which calls payload.create with admin context) or by an
    // admin for back-office manual entry / quote conversion.
    read: readAccess,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  hooks: {
    beforeChange: [
      // K2 (round-5 C1) — explicit allowed-transitions matrix.
      //
      // Background: `markOrderPaid` and `cancelOrderAndReleaseInventory`
      // use conditional SQL UPDATEs to reject illegal transitions on the
      // webhook hot path. But Payload's admin UI / GraphQL / direct
      // payload.update calls go straight to this collection without
      // routing through those helpers — so an admin (or a leaked admin
      // JWT) could PATCH `cancelled → paid` and create a shippable order
      // with stock that cancelOrderAndReleaseInventory had already
      // released back to the storefront. We codify the legal transitions
      // here and refuse anything else with a clear error.
      ({ data, operation, originalDoc }) => {
        if (operation !== 'update') return data
        if (data?.status == null) return data
        const from = originalDoc?.status as string | undefined
        const to = data.status as string
        if (!from || from === to) return data

        const ALLOWED: Record<string, ReadonlyArray<string>> = {
          pending_payment: ['paid', 'cancelled'],
          paid: ['processing', 'shipped', 'cancelled', 'refunded', 'disputed'],
          processing: ['shipped', 'cancelled', 'refunded', 'disputed'],
          shipped: ['delivered', 'refunded', 'disputed'],
          delivered: ['refunded', 'disputed'],
          // Terminal states — only admins resolving a dispute can revert,
          // and that path goes through Refunds / a dispute resolver flow,
          // not direct status writes. Refuse.
          cancelled: [],
          refunded: [],
          disputed: ['refunded'],
        }
        const legal = ALLOWED[from]
        if (!legal || !legal.includes(to)) {
          throw new Error(
            `Refused: order status transition "${from}" → "${to}" is not allowed. ` +
              `(Legal: ${(legal ?? []).join(', ') || 'none — terminal'})`,
          )
        }
        return data
      },

      // K3 / K10 (round-5 M11 regression fix + minor m2) — when an admin
      // flips ANY order from `pending_payment` → `paid` via the admin UI,
      // populate `payment.paidAt` / `processorRef` / `processorIntentRef`
      // for reconciliation + the confirmation-email path that reads
      // paidAt. The previous version of this hook gated on
      // `processor === 'manual'` BUT createOrderFromCart never sets the
      // processor field at creation (it's only set by markOrderPaid for
      // Stripe/Flutterwave) — so the gate never matched and the hook was
      // a no-op for the documented manual flow. We now apply on every
      // admin pending_payment → paid transition; Stripe/Flutterwave
      // orders rarely take this path because they go through the webhook,
      // and when they do (ops manual mark-paid) we still want the fields
      // populated rather than empty.
      ({ data, operation, originalDoc }) => {
        if (operation !== 'update') return data
        const transitioningToPaid =
          originalDoc?.status === 'pending_payment' && data?.status === 'paid'
        if (!transitioningToPaid) return data
        const nowIso = new Date().toISOString()
        const existingPayment = (originalDoc?.payment ?? {}) as Record<string, unknown>
        const submittedPayment = (data?.payment ?? {}) as Record<string, unknown>
        const processor =
          (submittedPayment.processor as string | undefined) ??
          (existingPayment.processor as string | undefined) ??
          'manual'
        return {
          ...data,
          payment: {
            ...existingPayment,
            ...submittedPayment,
            processor,
            processorRef:
              submittedPayment.processorRef ??
              existingPayment.processorRef ??
              `${processor}_${originalDoc?.orderNumber}`,
            paidAt: submittedPayment.paidAt ?? existingPayment.paidAt ?? nowIso,
          },
        }
      },
    ],
    afterChange: [auditOrder],
  },
  fields: [
    {
      // R7 round-7 data m4 — orderNumber must be immutable post-create.
      // Snapshots in payouts.lines.orderNumberSnapshot, audit-log rows,
      // emails, and Stripe metadata all freeze this value at write time;
      // an admin rename would silently desync every snapshot. The
      // beforeChange guard below rejects update attempts that change it.
      name: 'orderNumber',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      access: {
        update: () => false,
      },
    },
    {
      name: 'confirmationToken',
      type: 'text',
      required: true,
      admin: {
        description:
          'Unguessable secret used to gate guest order viewing. Never exposed in lists.',
        readOnly: true,
      },
      access: {
        // M4 (Phase 2) — admin-only. Mirrors the J2-round-4 fix on
        // Quotes.confirmationToken. The token is the sole auth gate for
        // the public guest URL `/orders/<n>?t=<token>`; a vendor with
        // one line on a multi-line order had collection-level read +
        // field-level token read, so they could hit the guest URL and
        // see customer shipping address + ALL other vendors' line items
        // (bypassing the per-line vendor scoping that lives in the page
        // not the collection). The order page reads via findOrderByNumber
        // with overrideAccess so legitimate customer/vendor views are
        // unaffected.
        read: ({ req: { user } }) => user?.role === 'admin',
        // R11 — immutable after creation. The token gates guest order
        // viewing; allowing admin (or a compromised admin JWT) to rotate
        // it would lock the original customer out of the URL they were
        // emailed at checkout, with no recovery path. Mirrors the
        // orderNumber immutability pattern.
        update: () => false,
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending_payment',
      options: [
        { label: 'Pending payment', value: 'pending_payment' },
        { label: 'Paid', value: 'paid' },
        { label: 'Processing', value: 'processing' },
        { label: 'Shipped', value: 'shipped' },
        { label: 'Delivered', value: 'delivered' },
        { label: 'Cancelled', value: 'cancelled' },
        { label: 'Refunded', value: 'refunded' },
        { label: 'Disputed', value: 'disputed' },
      ],
    },
    {
      name: 'customer',
      type: 'relationship',
      relationTo: 'users',
      index: true,
    },
    {
      name: 'guestEmail',
      type: 'email',
      admin: { description: 'For guest checkouts (no account).' },
    },
    {
      name: 'lineItems',
      type: 'array',
      minRows: 1,
      fields: [
        { name: 'product', type: 'relationship', relationTo: 'products', required: true },
        { name: 'vendor', type: 'relationship', relationTo: 'vendors', required: true, index: true },
        { name: 'titleSnapshot', type: 'text', required: true },
        { name: 'skuSnapshot', type: 'text' },
        { name: 'quantity', type: 'number', required: true, min: 1 },
        { name: 'unitPriceMinor', type: 'number', required: true, min: 0 },
        { name: 'lineTotalMinor', type: 'number', required: true, min: 0 },
      ],
    },
    {
      // M9 fix: only orders created via the retail cart path decrement
      // inventory at creation. Quote-converted orders skip the decrement
      // because stock for B2B/quote items isn't held the same way. Without
      // this flag, cancelOrderAndReleaseInventory increments inventory for
      // *any* cancelled order — leading to phantom stock when a
      // quote-derived order is cancelled.
      name: 'inventoryDecremented',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        readOnly: true,
        description:
          'Set by createOrderFromCart when stock was deducted at creation. Cancelled orders only restore stock when this is true.',
      },
    },
    { name: 'subtotalMinor', type: 'number', required: true, min: 0 },
    { name: 'shippingMinor', type: 'number', defaultValue: 0, min: 0 },
    { name: 'taxMinor', type: 'number', defaultValue: 0, min: 0 },
    { name: 'discountMinor', type: 'number', defaultValue: 0, min: 0 },
    { name: 'totalMinor', type: 'number', required: true, min: 0 },
    {
      name: 'currency',
      type: 'select',
      required: true,
      options: [
        { label: 'NAD', value: 'NAD' },
        { label: 'ZAR', value: 'ZAR' },
        { label: 'USD', value: 'USD' },
        { label: 'GBP', value: 'GBP' },
        { label: 'EUR', value: 'EUR' },
      ],
    },
    {
      name: 'payment',
      type: 'group',
      fields: [
        {
          name: 'processor',
          type: 'select',
          options: [
            { label: 'Stripe', value: 'stripe' },
            { label: 'Flutterwave', value: 'flutterwave' },
            { label: 'Manual / bank transfer', value: 'manual' },
          ],
        },
        {
          name: 'processorRef',
          type: 'text',
          admin: { description: 'Outer reference (Stripe: cs_…, Flutterwave: tx_ref).' },
        },
        {
          // C3 fix: Stripe `charge.refunded` events carry a PaymentIntent
          // (`pi_…`) NOT a Checkout Session id. Previously we stored only
          // the session id in processorRef, so the refund lookup
          // `where payment.processorRef equals charge.payment_intent`
          // matched nothing — every Stripe-dashboard refund was silently
          // dropped from our ledger. This field captures the underlying
          // PI at the time we mark the order paid so the refund handler
          // can resolve back.
          name: 'processorIntentRef',
          type: 'text',
          index: true,
          admin: {
            description: 'Inner Stripe PaymentIntent id (pi_…) used to match refund webhooks.',
          },
          // R7 round-7 data m2 — vendors can read orders scoped by their
          // line items, but they have no business reason to see the raw
          // Stripe PaymentIntent id (it's a server-side correlation key,
          // exposing it lets a malicious vendor make Stripe API calls
          // against orders they only partially owned). Admin-only read.
          access: {
            read: ({ req: { user } }) => user?.role === 'admin',
          },
        },
        { name: 'paidAt', type: 'date' },
      ],
    },
    {
      name: 'shippingAddress',
      type: 'group',
      fields: [
        { name: 'name', type: 'text' },
        { name: 'line1', type: 'text' },
        { name: 'line2', type: 'text' },
        { name: 'city', type: 'text' },
        { name: 'region', type: 'text' },
        { name: 'postalCode', type: 'text' },
        { name: 'country', type: 'text' },
        { name: 'phone', type: 'text' },
      ],
    },
    {
      name: 'billingAddress',
      type: 'group',
      fields: [
        { name: 'name', type: 'text' },
        { name: 'line1', type: 'text' },
        { name: 'line2', type: 'text' },
        { name: 'city', type: 'text' },
        { name: 'region', type: 'text' },
        { name: 'postalCode', type: 'text' },
        { name: 'country', type: 'text' },
      ],
    },
    {
      name: 'fulfillment',
      type: 'group',
      fields: [
        { name: 'carrier', type: 'text' },
        { name: 'trackingNumber', type: 'text' },
        { name: 'shippedAt', type: 'date' },
        { name: 'deliveredAt', type: 'date' },
      ],
    },
    {
      name: 'notes',
      type: 'textarea',
      admin: { description: 'Internal notes — not shown to customer.' },
    },
  ],
  timestamps: true,
}
