import { sql, type MigrateUpArgs, type MigrateDownArgs } from '@payloadcms/db-postgres'

/**
 * L3 (round-5 sessions deferral) — switch Users.auth.useSessions to true.
 *
 * Payload v3 stores each login as a row in `users_sessions`. Logout
 * deletes the row; demoting an admin who has a live session can be done
 * by deleting their row → the JWT instantly invalidates. Closes the
 * round-3/4/5 "24h JWT staleness" gap completely.
 *
 * The schema-push in dev created this table automatically; this
 * migration captures the exact shape so `PAYLOAD_DISABLE_SCHEMA_PUSH=true`
 * production deploys get the same structure.
 *
 * Migration impact at deploy:
 *   - Every existing JWT becomes invalid (token-format change). All
 *     currently signed-in users must re-login on the first request
 *     after deploy.
 *   - One-time annoyance, no data loss.
 */
export const name = '20260521_phase_5_16_user_sessions'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "users_sessions" (
      "_order" integer NOT NULL,
      "_parent_id" integer NOT NULL,
      "id" varchar PRIMARY KEY NOT NULL,
      "created_at" timestamp(3) with time zone,
      "expires_at" timestamp(3) with time zone NOT NULL,
      CONSTRAINT "users_sessions_parent_id_fk"
        FOREIGN KEY ("_parent_id") REFERENCES "users"("id") ON DELETE CASCADE
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "users_sessions_order_idx"
      ON "users_sessions" ("_order")
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "users_sessions_parent_id_idx"
      ON "users_sessions" ("_parent_id")
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`DROP TABLE IF EXISTS "users_sessions"`)
}
