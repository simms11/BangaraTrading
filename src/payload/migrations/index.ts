/**
 * Migrations registry. Generate new migrations with:
 *   npm run db:migrate:create -- --name <name>
 *
 * Each migration file exports `up` and `down` functions plus a `name`.
 * Adding a migration here makes it part of the production deploy boot.
 */
import type { MigrateUpArgs, MigrateDownArgs } from '@payloadcms/db-postgres'
import * as baseline from './00000000_baseline'
import * as phase511 from './20260521_phase_5_11'
import * as phase516Sessions from './20260521_phase_5_16_user_sessions'
import * as phase518Indexes from './20260526_phase_5_18_indexes_and_constraints'
import * as phase523AuditKind from './20260601_phase_5_23_audit_kind_payout'
import * as phase524AuditKindUserDeleted from './20260603_phase_5_24_audit_kind_user_deleted'
import * as phase525RefundCapTrigger from './20260604_phase_5_25_refund_cap_trigger'

export const migrations: Array<{
  up: (args: MigrateUpArgs) => Promise<void>
  down: (args: MigrateDownArgs) => Promise<void>
  name: string
}> = [
  // Phase 5.20 (final): baseline schema. Creates every base table, enum,
  // index and FK so a clean production DB (schema-push disabled) can boot.
  // Idempotent: no-ops if the schema already exists. MUST run first.
  {
    name: baseline.name,
    up: baseline.up,
    down: baseline.down,
  },
  // Phase 5.11: orders.inventory_decremented + processor_intent_ref +
  // quotes.confirmation_token (with backfill). Guarded with IF NOT EXISTS
  // so it no-ops on top of the baseline (which already includes these).
  {
    name: phase511.name,
    up: phase511.up,
    down: phase511.down,
  },
  // Phase 5.16 (this commit): users_sessions table so Users.useSessions
  // can be enabled in prod. Existing JWTs become invalid on deploy.
  {
    name: phase516Sessions.name,
    up: phase516Sessions.up,
    down: phase516Sessions.down,
  },
  // Phase 5.18 (round-7 data integrity): indexes on hot query paths +
  // UNIQUE on payouts (vendor, period) + CHECK on commission rate.
  {
    name: phase518Indexes.name,
    up: phase518Indexes.up,
    down: phase518Indexes.down,
  },
  // Phase 5.23 (R11): add `payout.status_changed` to enum_audit_log_kind
  // for databases that ran the baseline before this value existed.
  {
    name: phase523AuditKind.name,
    up: phase523AuditKind.up,
    down: phase523AuditKind.down,
  },
  // Phase 5.24 (Phase 2 M5): add `user.deleted` so account-deletion
  // audit rows are discoverable to compliance queries.
  {
    name: phase524AuditKindUserDeleted.name,
    up: phase524AuditKindUserDeleted.up,
    down: phase524AuditKindUserDeleted.down,
  },
  // Phase 5.25 (audit M12): BEFORE INSERT OR UPDATE trigger on refunds that
  // enforces the cumulative refund cap atomically with the write (row-level
  // FOR UPDATE lock on the parent order). Durable backstop for the
  // no-`req` race the app-level cap check cannot close.
  {
    name: phase525RefundCapTrigger.name,
    up: phase525RefundCapTrigger.up,
    down: phase525RefundCapTrigger.down,
  },
]
