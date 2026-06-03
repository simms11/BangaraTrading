import type { Access, CollectionConfig, Where } from 'payload'
import { isAdmin, isAdminFieldAccess } from '../access'
import { quoteStatusEmailHook } from '../hooks/quoteStatusEmail'

const readAccess: Access = ({ req: { user } }) => {
  if (!user) return false
  if (user.role === 'admin') return true
  if (user.role === 'vendor' && user.vendor) {
    const vendorId = typeof user.vendor === 'object' ? user.vendor.id : user.vendor
    return { 'items.vendor': { equals: vendorId } } as Where
  }
  return { customer: { equals: user.id } } as Where
}

const updateAccess: Access = ({ req: { user } }) => {
  if (!user) return false
  if (user.role === 'admin') return true
  if (user.role === 'vendor' && user.vendor) {
    const vendorId = typeof user.vendor === 'object' ? user.vendor.id : user.vendor
    return { 'items.vendor': { equals: vendorId } } as Where
  }
  return false
}

export const Quotes: CollectionConfig = {
  slug: 'quotes',
  labels: { singular: 'Quote', plural: 'Quotes' },
  admin: {
    useAsTitle: 'quoteNumber',
    defaultColumns: ['quoteNumber', 'status', 'customerName', 'totalEstimateMinor', 'createdAt'],
    description: 'B2B / bulk enquiry quotes. Convertible into orders.',
  },
  access: {
    read: readAccess,
    // SECURITY (M12): public POST /api/quotes used to be open ("() => true"),
    // letting anyone same-origin craft an arbitrary quote row (price 1,
    // status quoted, etc.) and bypass the createQuoteFromCart server-action
    // validation. Quote submissions now MUST go through the action which
    // uses overrideAccess.
    create: isAdmin,
    update: updateAccess,
    delete: isAdmin,
  },
  hooks: {
    beforeChange: [
      // K3 (round-5 M2) — explicit status-transition allowlist. Without
      // this an admin could PATCH `converted → quoted` (re-fires the
      // customer email with original prices + orphans the linked order
      // row by clearing convertedOrder) or `expired/declined → quoted`
      // (which should be a fresh quote row, not a revert).
      ({ data, operation, originalDoc }) => {
        if (operation !== 'update') return data
        if (data?.status == null) return data
        const from = originalDoc?.status as string | undefined
        const to = data.status as string
        if (!from || from === to) return data
        const ALLOWED: Record<string, ReadonlyArray<string>> = {
          submitted: ['reviewing', 'quoted', 'declined', 'expired'],
          reviewing: ['quoted', 'declined', 'expired'],
          quoted: ['accepted', 'declined', 'expired'],
          accepted: ['converted', 'expired'],
          declined: [],
          converted: [],
          expired: [],
        }
        const legal = ALLOWED[from]
        if (!legal || !legal.includes(to)) {
          throw new Error(
            `Refused: quote status transition "${from}" → "${to}" is not allowed. ` +
              `(Legal: ${(legal ?? []).join(', ') || 'none — terminal'})`,
          )
        }
        // R8 business M6 — when a quote is SENT (→ quoted), guarantee an
        // expiry. The accept flow only enforces expiry if response.
        // validUntil is set; an optional field meant a quote sent
        // without it could be accepted at the locked-in price forever
        // (years later, after the vendor's cost tripled). Default to
        // now + 30 days when ops didn't specify one.
        if (to === 'quoted') {
          const resp = (data.response ?? {}) as { validUntil?: string | null }
          if (!resp.validUntil) {
            const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            data.response = { ...resp, validUntil: in30Days.toISOString() }
          }
        }
        return data
      },

      // H6 (M2) gate: vendor users may only mutate fields on THEIR OWN
      // line items. Per-element ownership enforced here because
      // field-level access can't see the doc.
      async ({ data, operation, originalDoc, req }) => {
        if (operation !== 'update') return data
        const user = req.user
        if (!user || user.role === 'admin') return data
        if (user.role !== 'vendor') return data

        // If the caller didn't touch the items array, allow.
        if (data.items === undefined) return data

        const userVendorId = String(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          typeof (user as any).vendor === 'object'
            ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (user as any).vendor?.id
            : // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (user as any).vendor,
        )
        type Line = {
          id?: string | number
          vendor?: number | string | { id: number | string }
          product?: number | string | { id: number | string }
          titleSnapshot?: string
          quantity?: number
          unitPriceQuoteMinor?: number | null
          notes?: string
        }
        const incoming = (data.items ?? []) as Line[]
        const original = (originalDoc?.items ?? []) as Line[]

        const lineOwnerId = (line: Line): string =>
          String(
            typeof line.vendor === 'object' && line.vendor !== null
              ? (line.vendor as { id: number | string }).id
              : line.vendor,
          )
        const productOwnerId = (line: Line): string =>
          String(
            typeof line.product === 'object' && line.product !== null
              ? (line.product as { id: number | string }).id
              : line.product,
          )
        const lineFingerprint = (line: Line): string =>
          [
            productOwnerId(line),
            lineOwnerId(line),
            line.titleSnapshot ?? '',
            String(line.quantity ?? ''),
            String(line.unitPriceQuoteMinor ?? ''),
            line.notes ?? '',
          ].join('|')

        const originalById = new Map<string, Line>()
        for (const li of original) {
          if (li.id != null) originalById.set(String(li.id), li)
        }
        const incomingIds = new Set<string>()
        for (const line of incoming) {
          if (line.id != null) incomingIds.add(String(line.id))
          const owner = lineOwnerId(line)
          if (owner === userVendorId) continue
          // Non-owned line: must already exist with the same fingerprint.
          const before = line.id != null ? originalById.get(String(line.id)) : undefined
          if (!before) {
            throw new Error(
              `Refused: vendors can only modify their own quote lines.`,
            )
          }
          if (lineFingerprint(line) !== lineFingerprint(before)) {
            throw new Error(
              `Refused: vendors cannot edit another vendor's quote line.`,
            )
          }
        }
        // The submission must NOT omit a non-owned original line — that
        // would let a vendor "delete" a competitor's line by dropping it.
        for (const before of original) {
          if (lineOwnerId(before) === userVendorId) continue
          if (before.id == null) continue
          if (!incomingIds.has(String(before.id))) {
            throw new Error(
              `Refused: vendors cannot remove another vendor's quote line.`,
            )
          }
        }
        return data
      },
    ],
    afterChange: [quoteStatusEmailHook],
  },
  fields: [
    { name: 'quoteNumber', type: 'text', required: true, unique: true, index: true },
    // SECURITY (C2 gate): per-quote unguessable token. Required to view the
    // /quotes/[quoteNumber] page or accept the quote via server action.
    // Mirrors Orders.confirmationToken — never exposed in lists, never
    // readable by customers; the customer receives it in their original
    // quote-submitted email URL.
    //
    // J2 (round-4 M2) — admin-only read. The previous policy allowed
    // vendor-role users to read the token whenever they had any line on
    // the quote. A vendor on a multi-vendor quote could then call
    // acceptQuoteAndCreateOrder with the token + their own shipping
    // address, hijacking the customer's quote into an attacker-controlled
    // order. Vendors don't need the token: they respond/quote via admin
    // UI or via per-line server actions, neither of which requires the
    // token. Restrict to admin.
    {
      name: 'confirmationToken',
      type: 'text',
      required: true,
      admin: { description: 'Unguessable token gating the quote-acceptance URL.', readOnly: true },
      access: {
        read: ({ req: { user } }) => user?.role === 'admin',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'submitted',
      options: [
        { label: 'Submitted', value: 'submitted' },
        { label: 'Under review', value: 'reviewing' },
        { label: 'Quote sent', value: 'quoted' },
        { label: 'Accepted', value: 'accepted' },
        { label: 'Declined', value: 'declined' },
        { label: 'Converted to order', value: 'converted' },
        { label: 'Expired', value: 'expired' },
      ],
      // SECURITY (M1): a vendor that owns ONE line on a multi-vendor quote
      // could otherwise flip status='quoted' to trigger the customer email
      // with bogus prices. Status transitions go through admin or server
      // actions that use overrideAccess.
      access: { update: isAdminFieldAccess },
    },
    // Customer identity columns. A vendor with one line on a multi-vendor
    // quote shouldn't be able to rewrite the customer's email/phone to
    // hijack the conversation thread (M13).
    {
      name: 'customer',
      type: 'relationship',
      relationTo: 'users',
      access: { update: isAdminFieldAccess },
    },
    {
      name: 'customerName',
      type: 'text',
      required: true,
      access: { update: isAdminFieldAccess },
    },
    {
      name: 'customerEmail',
      type: 'email',
      required: true,
      access: { update: isAdminFieldAccess },
    },
    {
      name: 'customerPhone',
      type: 'text',
      access: { update: isAdminFieldAccess },
    },
    {
      name: 'companyName',
      type: 'text',
      access: { update: isAdminFieldAccess },
    },
    { name: 'destinationCountry', type: 'text' },
    {
      name: 'items',
      type: 'array',
      minRows: 1,
      // H6 (M2) fix: array-level update is restricted to admin to prevent a
      // vendor from re-pricing competitors' lines. But this previously
      // locked vendors out of responding to their OWN line prices, breaking
      // the documented quote workflow.
      //
      // Trade-off: collection-level update access already gates whether
      // the user can mutate this row at all (`items.vendor === user.vendor`
      // OR admin). At the row-mutation point Payload only re-validates
      // field-level access on the writes the caller actually sent. So:
      //   - Admin → can write anything (isAdminFieldAccess returns true).
      //   - Vendor → admin gate fails, BUT the collection-level filter
      //     already restricted the row set. The cross-vendor write risk
      //     remains: a vendor with line A on a multi-vendor quote could
      //     PATCH the items array and overwrite line B's price.
      //
      // The fully-safe pre-launch posture is to lock writes via a custom
      // FieldAccess that checks the doc *and* the user, but Payload v3's
      // FieldAccess does not receive the doc. The pragmatic launch
      // compromise: allow admin OR vendor writes here, and add a
      // beforeChange hook on the collection that rejects writes from a
      // vendor user touching lines belonging to a different vendor.
      access: {
        update: ({ req: { user } }) =>
          user?.role === 'admin' || user?.role === 'vendor',
      },
      fields: [
        { name: 'product', type: 'relationship', relationTo: 'products', required: true },
        { name: 'vendor', type: 'relationship', relationTo: 'vendors', required: true, index: true },
        { name: 'titleSnapshot', type: 'text', required: true },
        { name: 'quantity', type: 'number', required: true, min: 1 },
        { name: 'notes', type: 'textarea' },
        {
          name: 'unitPriceQuoteMinor',
          type: 'number',
          min: 0,
          admin: { description: 'Vendor/admin sets the quoted unit price.' },
        },
      ],
    },
    {
      name: 'totalEstimateMinor',
      type: 'number',
      min: 0,
      admin: { description: 'Quoted total. Filled in once vendor responds.' },
      access: { update: isAdminFieldAccess },
    },
    {
      // R7 round-7 data M1: was `type: 'text'` which let arbitrary
      // free-text drift in. Orders/Refunds/Payouts use the same select
      // — drift between collections caused a runtime cast failure when
      // a non-default-cased value (e.g. 'usd' lowercase) flowed into
      // acceptQuoteAndCreateOrder. Enum the field with the same options.
      name: 'currency',
      type: 'select',
      defaultValue: 'NAD',
      options: [
        { label: 'NAD', value: 'NAD' },
        { label: 'ZAR', value: 'ZAR' },
        { label: 'USD', value: 'USD' },
        { label: 'GBP', value: 'GBP' },
        { label: 'EUR', value: 'EUR' },
      ],
      access: { update: isAdminFieldAccess },
    },
    {
      name: 'message',
      type: 'textarea',
      admin: { description: 'Original customer message.' },
      access: { update: isAdminFieldAccess },
    },
    {
      name: 'response',
      type: 'group',
      access: { update: isAdminFieldAccess },
      fields: [
        { name: 'message', type: 'textarea' },
        { name: 'respondedBy', type: 'relationship', relationTo: 'users' },
        { name: 'respondedAt', type: 'date' },
        {
          name: 'validUntil',
          type: 'date',
          admin: { description: 'Quote expires after this date.' },
        },
      ],
    },
    {
      name: 'convertedOrder',
      type: 'relationship',
      relationTo: 'orders',
      admin: { description: 'If accepted, the order created from this quote.' },
      access: { update: isAdminFieldAccess },
    },
  ],
  timestamps: true,
}
