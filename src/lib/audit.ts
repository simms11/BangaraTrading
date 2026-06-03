import 'server-only'
import type { Payload, PayloadRequest } from 'payload'

export type AuditKind =
  | 'order.created'
  | 'order.status_changed'
  | 'refund.created'
  | 'refund.completed'
  | 'vendor.approved'
  | 'vendor.status_changed'
  | 'product.price_changed'
  | 'product.status_changed'
  // I4 (C4): emitted when an inventory compensating action (revert at
  // order-create failure, release on cancellation) fails to restore stock.
  // Ops must reconcile manually; the audit row provides the trail.
  | 'inventory.revert_failed'
  // M2 (round-6): user role/vendor change → live sessions revoked.
  | 'user.role_changed'
  // M2 (round-6): admin "log out everywhere" action against a user.
  | 'user.sessions_revoked'
  // R10: payout status transition (pending → processing → paid/cancelled).
  | 'payout.status_changed'
  // M5 (Phase 2): self-service account deletion (GDPR/POPIA Article 17 /
  // POPIA s.23). Was previously misfiled as `order.status_changed`,
  // which made the deletion record undiscoverable to compliance queries.
  | 'user.deleted'

/**
 * Append a single audit entry. Best-effort: never throws. If the audit
 * write fails (e.g. DB hiccup), we log a structured error and return —
 * the caller's primary operation already succeeded.
 *
 * Callers usually pass `req` from a Payload hook so we capture actor.
 */
export async function audit(args: {
  payload: Payload
  req?: PayloadRequest
  kind: AuditKind
  subjectType: string
  subjectId: string | number
  diff?: { before?: unknown; after?: unknown }
  notes?: string
}): Promise<void> {
  const { payload, req, kind, subjectType, subjectId, diff, notes } = args
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user = (req?.user ?? null) as any | null
  try {
    await payload.create({
      collection: 'audit-log',
      overrideAccess: true,
      data: {
        kind,
        subjectType,
        subjectId: String(subjectId),
        actorId: user ? String(user.id) : 'system',
        actorEmail: user?.email ?? undefined,
        actorRole: user?.role ?? 'system',
        diff: diff as Record<string, unknown> | undefined,
        notes,
      },
    })
  } catch (e) {
    payload.logger?.error?.(
      `[audit] failed to record ${kind} for ${subjectType}#${subjectId}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    )
  }
}
