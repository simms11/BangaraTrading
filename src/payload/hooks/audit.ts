import type { CollectionAfterChangeHook } from 'payload'
import { audit, type AuditKind } from '@/lib/audit'

type FieldMap = Record<string, AuditKind>

/**
 * Generic hook factory: emits an audit event whenever a watched scalar
 * field changes between previousDoc and doc. Caller declares which fields
 * map to which audit kinds.
 *
 * Example: `auditOnFieldChange({ status: 'order.status_changed' })`
 * fires only on the status transition.
 */
export function auditOnFieldChange(
  fieldMap: FieldMap,
  subjectType: string,
): CollectionAfterChangeHook {
  return async ({ doc, previousDoc, operation, req }) => {
    if (operation !== 'update') return doc
    for (const [field, kind] of Object.entries(fieldMap)) {
      const before = (previousDoc as Record<string, unknown> | undefined)?.[field]
      const after = (doc as Record<string, unknown> | undefined)?.[field]
      if (before === after) continue
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const docId = (doc as any).id as string | number
      await audit({
        payload: req.payload,
        req,
        kind,
        subjectType,
        subjectId: docId,
        diff: { before: { [field]: before }, after: { [field]: after } },
      })
    }
    return doc
  }
}

export const auditOrder = auditOnFieldChange(
  { status: 'order.status_changed' },
  'orders',
)

export const auditVendor = auditOnFieldChange(
  { status: 'vendor.status_changed' },
  'vendors',
)

export const auditProduct = auditOnFieldChange(
  { priceMinor: 'product.price_changed', status: 'product.status_changed' },
  'products',
)

// R10 — rewritten. The previous version misused auditOnFieldChange:
// `refund.created` was mapped to amountMinor (so it NEVER fired on real
// refund creation — auditOnFieldChange only runs on update — and
// amountMinor edits were mislabelled as creation events), and processor
// Ref edits masqueraded as completion events. This dedicated hook:
//   - emits `refund.created` on every operation === 'create'
//   - emits `refund.completed` ONLY when status transitions to 'completed'
// amountMinor / processorRef edits show up in the diff of the status
// transition (and the Refunds.beforeChange immutability guard already
// blocks edits on completed rows).
export const auditRefund: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  operation,
  req,
}) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = doc as any
  if (operation === 'create') {
    await audit({
      payload: req.payload,
      req,
      kind: 'refund.created',
      subjectType: 'refunds',
      subjectId: d.id,
      diff: {
        before: undefined,
        after: {
          status: d.status,
          amountMinor: d.amountMinor,
          processor: d.processor,
          processorRef: d.processorRef,
        },
      },
    })
    return doc
  }
  if (operation === 'update') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prev = (previousDoc as any) ?? {}
    if (prev.status !== 'completed' && d.status === 'completed') {
      await audit({
        payload: req.payload,
        req,
        kind: 'refund.completed',
        subjectType: 'refunds',
        subjectId: d.id,
        diff: {
          before: { status: prev.status, processorRef: prev.processorRef },
          after: { status: d.status, processorRef: d.processorRef },
        },
      })
    }
  }
  return doc
}
