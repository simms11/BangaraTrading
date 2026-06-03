import { sql, type MigrateUpArgs } from '@payloadcms/db-postgres'

/**
 * Phase 5.24 / Phase 2 M5 — add `user.deleted` to enum_audit_log_kind
 * so GDPR/POPIA account-deletion records are discoverable to compliance
 * queries on the audit-log `kind` index. Self-service deletion was
 * previously misfiled as `order.status_changed`.
 *
 * Idempotent via `ADD VALUE IF NOT EXISTS`. Pure DDL; cannot run inside
 * a transaction block, but Payload's db-postgres migration runner does
 * not wrap individual migrations in transactions.
 *
 * The baseline migration's embedded DDL is also updated to include the
 * value for fresh deploys; this migration is for databases that ran
 * the baseline before the value existed.
 */
export const name = '20260603_phase_5_24_audit_kind_user_deleted'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TYPE public.enum_audit_log_kind ADD VALUE IF NOT EXISTS 'user.deleted'
  `)
}

export async function down(): Promise<void> {
  // Postgres can't remove enum values without rewriting the type.
  // No-op; rolling back the application code is sufficient.
}
