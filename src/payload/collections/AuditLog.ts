import type { CollectionConfig } from 'payload'
import { isAdmin } from '../access'

/**
 * Append-only audit trail for sensitive operations:
 *   - Order status changes
 *   - Refund issuance + completion
 *   - Vendor approval / status change
 *   - Product price changes
 *   - Manual order creation by an admin
 *
 * Read: admin only. Create: admin only (in practice, populated entirely by
 * hooks). Update/delete: never.
 *
 * Retained indefinitely. For compliance trim (POPIA / GDPR), a Phase 5.7
 * scheduled job will archive entries older than 7 years to cold storage.
 */
export const AuditLog: CollectionConfig = {
  slug: 'audit-log',
  labels: { singular: 'Audit log entry', plural: 'Audit log' },
  admin: {
    useAsTitle: 'kind',
    defaultColumns: ['kind', 'subjectType', 'subjectId', 'actorEmail', 'createdAt'],
    description:
      'Append-only audit trail. Populated by collection hooks; never edited directly.',
    hidden: ({ user }) => user?.role !== 'admin',
  },
  access: {
    read: isAdmin,
    create: isAdmin,
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'kind',
      type: 'select',
      required: true,
      index: true,
      options: [
        { label: 'order.created', value: 'order.created' },
        { label: 'order.status_changed', value: 'order.status_changed' },
        { label: 'refund.created', value: 'refund.created' },
        { label: 'refund.completed', value: 'refund.completed' },
        { label: 'vendor.approved', value: 'vendor.approved' },
        { label: 'vendor.status_changed', value: 'vendor.status_changed' },
        { label: 'product.price_changed', value: 'product.price_changed' },
        { label: 'product.status_changed', value: 'product.status_changed' },
        // I4 (C4): inventory reconciliation alert kind.
        { label: 'inventory.revert_failed', value: 'inventory.revert_failed' },
        // M2 (round-6): user role/vendor change w/ session revocation.
        { label: 'user.role_changed', value: 'user.role_changed' },
        // M2 (round-6): admin "log out everywhere" action.
        { label: 'user.sessions_revoked', value: 'user.sessions_revoked' },
        // R10: payout status transition (was mislabelled order.status_changed).
        { label: 'payout.status_changed', value: 'payout.status_changed' },
        // M5 (Phase 2): self-service account deletion.
        { label: 'user.deleted', value: 'user.deleted' },
      ],
    },
    {
      name: 'subjectType',
      type: 'text',
      required: true,
      admin: { description: 'Collection slug the action targets (orders, refunds, …).' },
    },
    {
      name: 'subjectId',
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'actorId',
      type: 'text',
      admin: { description: 'User id, or "system" for hook-initiated events.' },
    },
    {
      name: 'actorEmail',
      type: 'text',
      admin: { description: 'Captured at write time for forensic lookup.' },
    },
    {
      name: 'actorRole',
      type: 'select',
      options: [
        { label: 'admin', value: 'admin' },
        { label: 'vendor', value: 'vendor' },
        { label: 'customer', value: 'customer' },
        { label: 'system', value: 'system' },
      ],
    },
    {
      name: 'diff',
      type: 'json',
      admin: {
        description:
          'Snapshot of what changed: { before: {…}, after: {…} } where applicable.',
      },
    },
    {
      name: 'notes',
      type: 'textarea',
    },
  ],
  timestamps: true,
}
