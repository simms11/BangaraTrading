import { sql, type MigrateUpArgs, type MigrateDownArgs } from '@payloadcms/db-postgres'

/**
 * Phase 5.11 schema additions:
 *
 *   - orders.inventory_decremented (bool, default false)
 *     Tracks whether `createOrderFromCart` deducted stock at creation, so
 *     `cancelOrderAndReleaseInventory` only restores stock that was
 *     actually held.
 *
 *   - orders.payment_processor_intent_ref (text, indexed)
 *     Stripe `charge.refunded` events carry the PaymentIntent id (pi_…),
 *     not the Checkout Session id we previously stored in
 *     payment.processor_ref. Capturing the PI here lets the refund
 *     handler resolve back to the order.
 *
 *   - quotes.confirmation_token (text, required)
 *     Per-quote unguessable token gating the customer-facing accept URL.
 *     Without this, anyone who could guess a quote number could view PII
 *     or accept the quote with attacker-controlled shipping.
 *
 * Rollout discipline:
 *   The token column is added NULLABLE, existing rows are backfilled with
 *   a 32-char nanoid via `gen_random_uuid()` (no nanoid extension in
 *   Postgres; uuid is unguessable and equivalent for this gate), then
 *   constrained NOT NULL once every row holds a value.
 */
export const name = '20260521_phase_5_11'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // K4 (round-5 M4) — wrap the entire migration in a single transaction.
  // Postgres autocommits each `db.execute()` call by default; if the
  // backfill UPDATE timed out after creating the `confirmation_token`
  // column but before the `ALTER … SET NOT NULL` ran, re-running the
  // migration would fail on `SET NOT NULL` (rows with null tokens still
  // exist between attempts because the autocommit'd add-column persists
  // while the autocommit'd backfill rolls back partially). Postgres DDL
  // is transactional (unlike MySQL), so wrapping is safe and idempotent.
  //
  // pgcrypto is created outside the transaction because CREATE EXTENSION
  // requires its own transaction on some managed providers (Supabase).
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`)

  await db.execute(sql`BEGIN`)
  try {
    await db.execute(sql`
      ALTER TABLE "orders"
        ADD COLUMN IF NOT EXISTS "inventory_decremented" boolean DEFAULT false
    `)

    await db.execute(sql`
      ALTER TABLE "orders"
        ADD COLUMN IF NOT EXISTS "payment_processor_intent_ref" varchar
    `)
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "orders_payment_processor_intent_ref_idx"
        ON "orders" ("payment_processor_intent_ref")
    `)

    await db.execute(sql`
      ALTER TABLE "quotes"
        ADD COLUMN IF NOT EXISTS "confirmation_token" varchar
    `)
    // Backfill legacy rows with an unguessable token. gen_random_uuid() ships
    // with pgcrypto / Postgres 13+. We coerce to text so the column is a
    // simple varchar (consistent with how Payload generates these elsewhere).
    await db.execute(sql`
      UPDATE "quotes"
        SET "confirmation_token" = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
        WHERE "confirmation_token" IS NULL
    `)
    // Lock it down so future writes (which now must include the field) can't
    // create a NULL token.
    await db.execute(sql`
      ALTER TABLE "quotes"
        ALTER COLUMN "confirmation_token" SET NOT NULL
    `)
    // I11 minor: belt-and-braces UNIQUE index on the token.
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS "quotes_confirmation_token_idx"
        ON "quotes" ("confirmation_token")
    `)
    await db.execute(sql`COMMIT`)
  } catch (e) {
    await db.execute(sql`ROLLBACK`).catch(() => undefined)
    throw e
  }
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "quotes" DROP COLUMN IF EXISTS "confirmation_token"
  `)
  await db.execute(sql`
    DROP INDEX IF EXISTS "orders_payment_processor_intent_ref_idx"
  `)
  await db.execute(sql`
    ALTER TABLE "orders" DROP COLUMN IF EXISTS "payment_processor_intent_ref"
  `)
  await db.execute(sql`
    ALTER TABLE "orders" DROP COLUMN IF EXISTS "inventory_decremented"
  `)
}
