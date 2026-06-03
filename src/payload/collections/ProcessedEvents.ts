import type { CollectionConfig } from 'payload'
import { isAdmin } from '../access'

/**
 * Processed-events ledger. Used by webhook handlers (Stripe, Flutterwave) to
 * guarantee idempotency. The unique constraint on `key` (`<processor>:<eventId>`)
 * means a duplicate insert raises a DB error which the handler treats as
 * "already processed, return 200".
 *
 * Auto-pruned after 90 days via a periodic admin task in Phase 5.5+.
 */
export const ProcessedEvents: CollectionConfig = {
  slug: 'processed-events',
  labels: { singular: 'Processed event', plural: 'Processed events' },
  admin: {
    useAsTitle: 'key',
    defaultColumns: ['key', 'processor', 'kind', 'createdAt'],
    description: 'Webhook idempotency ledger. Read-only for vendors; admin can prune.',
    hidden: ({ user }) => user?.role !== 'admin',
  },
  access: {
    read: isAdmin,
    create: isAdmin,
    update: () => false,
    delete: isAdmin,
  },
  fields: [
    { name: 'key', type: 'text', required: true, unique: true, index: true },
    {
      name: 'processor',
      type: 'select',
      required: true,
      options: [
        { label: 'Stripe', value: 'stripe' },
        { label: 'Flutterwave', value: 'flutterwave' },
      ],
    },
    { name: 'kind', type: 'text', admin: { description: 'Event type, e.g. checkout.session.completed' } },
    {
      name: 'orderId',
      type: 'text',
      admin: { description: 'Order ID resolved during handling (if any).' },
    },
  ],
  timestamps: true,
}
