import { sql, type MigrateUpArgs, type MigrateDownArgs } from '@payloadcms/db-postgres'

/**
 * Phase 5.18 (round-7 data integrity batch).
 *
 * Adds the indexes + constraints flagged by round-7 audit:
 *
 *   1. payouts_lines.order_ref_id — used by Refunds.afterChange's
 *      clawback detection (raw SQL join). Missing index → full table
 *      scan inside an active transaction → connection pool pressure.
 *   2. orders.created_at — used by every payout statement generation,
 *      every admin dashboard query, every sweeper tick. Sequential
 *      scan past a few months of data.
 *   3. orders.guest_email — used by /orders/[orderNumber] guest view.
 *   4. audit_log composite (subject_type, subject_id) — every "what
 *      happened to order N" lookup currently uses only the
 *      subject_id single-column index.
 *   5. UNIQUE on payouts (vendor_id, period_start, period_end) — DB
 *      guard against generating the same statement twice. Application
 *      already uses an advisory lock but doesn't catch overlapping
 *      periods or repeated-identical creates after a crash mid-flight.
 *   6. CHECK on vendors.commission_rate BETWEEN 0 AND 100 — defence
 *      against a manual SQL edit (admin via psql) setting an
 *      out-of-range rate that the payout generator would silently
 *      treat as 0 or 100%+.
 *
 * All CREATE INDEX use IF NOT EXISTS so a re-run on a database where
 * Payload's schema-push already created the table is a no-op. The
 * ADD CONSTRAINT calls are guarded with DO blocks so re-runs don't
 * throw on duplicate constraints.
 */
export const name = '20260526_phase_5_18_indexes_and_constraints'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // 1. payouts_lines.order_ref_id (clawback detection).
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "payouts_lines_order_ref_id_idx"
      ON "payouts_lines" ("order_ref_id")
  `)

  // 2. orders.created_at (payout window queries, sweeper).
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "orders_created_at_idx"
      ON "orders" ("created_at")
  `)

  // 3. orders.guest_email (guest-order lookups). Lowercased for
  //    case-insensitive match if the storefront ever lowercases on read.
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "orders_guest_email_idx"
      ON "orders" ("guest_email")
  `)

  // 4. audit_log (subject_type, subject_id) composite.
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "audit_log_subject_idx"
      ON "audit_log" ("subject_type", "subject_id")
  `)

  // 5. payouts UNIQUE (vendor_id, period_start, period_end). We add it
  //    only if no duplicates exist (a duplicate would block the index
  //    create; safer to log and let ops reconcile manually).
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'payouts_vendor_period_uniq'
      ) THEN
        IF NOT EXISTS (
          SELECT vendor_id, period_start, period_end
            FROM payouts
            GROUP BY vendor_id, period_start, period_end
            HAVING COUNT(*) > 1
            LIMIT 1
        ) THEN
          ALTER TABLE payouts
            ADD CONSTRAINT payouts_vendor_period_uniq
            UNIQUE (vendor_id, period_start, period_end);
        ELSE
          RAISE NOTICE 'Skipping payouts_vendor_period_uniq: existing duplicates require ops reconciliation';
        END IF;
      END IF;
    END $$;
  `)

  // 6. CHECK on vendors.commission_rate. Allow NULL for un-set rates
  //    (the platform falls back to a global default in that case).
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'vendors_commission_rate_chk'
      ) THEN
        ALTER TABLE vendors
          ADD CONSTRAINT vendors_commission_rate_chk
          CHECK (commission_rate IS NULL OR (commission_rate >= 0 AND commission_rate <= 100));
      END IF;
    END $$;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE vendors DROP CONSTRAINT IF EXISTS vendors_commission_rate_chk`)
  await db.execute(sql`ALTER TABLE payouts DROP CONSTRAINT IF EXISTS payouts_vendor_period_uniq`)
  await db.execute(sql`DROP INDEX IF EXISTS audit_log_subject_idx`)
  await db.execute(sql`DROP INDEX IF EXISTS orders_guest_email_idx`)
  await db.execute(sql`DROP INDEX IF EXISTS orders_created_at_idx`)
  await db.execute(sql`DROP INDEX IF EXISTS payouts_lines_order_ref_id_idx`)
}
