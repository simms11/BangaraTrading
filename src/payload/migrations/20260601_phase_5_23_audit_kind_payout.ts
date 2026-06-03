import { sql, type MigrateUpArgs } from '@payloadcms/db-postgres'

/**
 * Phase 5.23 — add the `payout.status_changed` value to the
 * enum_audit_log_kind Postgres enum.
 *
 * Phase 5.22 introduced this audit kind at the TS / collection-options /
 * payload-types layer but forgot the DB migration. On a clean prod DB
 * that ran the baseline before this value existed, Postgres rejects
 * every audit insert with `kind='payout.status_changed'` as
 * `invalid input value for enum enum_audit_log_kind`. The audit wrapper
 * swallows the error, so every payout status transition silently fails
 * to write a compliance row.
 *
 * The Phase 5.22 baseline (00000000_baseline.ts) is updated in the same
 * commit to include this value for any FUTURE clean deploys. This
 * migration is needed only for databases that already ran the original
 * baseline (existing prod / staging).
 *
 * `ADD VALUE IF NOT EXISTS` is idempotent and safe on Postgres 12+.
 * It cannot run inside a transaction block — Payload's migration
 * runner does NOT wrap individual migrations in transactions for
 * db-postgres, so a bare `ADD VALUE` is correct.
 */
export const name = '20260601_phase_5_23_audit_kind_payout'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TYPE public.enum_audit_log_kind ADD VALUE IF NOT EXISTS 'payout.status_changed'
  `)
}

export async function down(): Promise<void> {
  // Postgres does NOT support removing an enum value. Down is a no-op;
  // rolling back the application code is sufficient (the value remains
  // in the enum but is unreferenced).
}
