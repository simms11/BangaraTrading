/**
 * Final audit (Phase 5.20) — baseline migration regression test.
 *
 * The blocking issue this guards: prior to the baseline migration, a
 * clean production database with PAYLOAD_DISABLE_SCHEMA_PUSH=true would
 * abort on first deploy because the only migrations were ALTERs against
 * tables that schema-push (disabled in prod) never created. The baseline
 * migration creates the full schema and must:
 *   1. be registered FIRST in the migrations array, and
 *   2. apply cleanly to a brand-new empty database.
 *
 * This test provisions a throwaway database, applies the baseline SQL
 * embedded in the migration file, and asserts the full schema appears.
 * It deliberately avoids the Payload CLI (which the strict-Node local
 * env can't run) and the drizzle layer — it exercises the raw SQL that
 * actually ships, which is the artifact that matters.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Pool } from 'pg'
import { migrations } from '@/payload/migrations'

const SCRATCH_DB = 'bangarah_baseline_regression'

function adminUrl(): string {
  const base = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL!
  // Point at the default 'postgres' maintenance DB for CREATE/DROP.
  return base.replace(/\/[^/?]+(\?|$)/, '/postgres$1')
}
function scratchUrl(): string {
  const base = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL!
  return base.replace(/\/[^/?]+(\?|$)/, `/${SCRATCH_DB}$1`)
}

function extractBaselineSql(): string {
  const file = readFileSync(
    resolve(process.cwd(), 'src/payload/migrations/00000000_baseline.ts'),
    'utf8',
  )
  // BASELINE_SQL is a single backtick-delimited literal; the SQL contains
  // no backticks (verified at authoring time), so the first pair delimits it.
  const m = file.match(/const BASELINE_SQL = `([\s\S]*?)`\n/)
  if (!m) throw new Error('Could not extract BASELINE_SQL from baseline migration')
  return m[1]
}

function extractGuardSql(): string {
  const file = readFileSync(
    resolve(process.cwd(), 'src/payload/migrations/00000000_baseline.ts'),
    'utf8',
  )
  // The up() existence guard: `await db.execute(sql`<query>`)`.
  const m = file.match(/db\.execute\(sql`([^`]*to_regclass[^`]*)`\)/)
  if (!m) throw new Error('Could not extract the existence-guard query from baseline migration')
  return m[1]
}

describe('Baseline migration (Phase 5.20)', () => {
  it('is registered first in the migrations array', () => {
    expect(migrations[0]?.name).toBe('00000000_baseline')
  })

  it('existence-guard query is valid SQL (catches the doubled-quote regression)', async () => {
    // The up() guard runs BEFORE BASELINE_SQL; a syntax error there (e.g.
    // the `to_regclass(''public.orders'')` doubled-quote typo) aborts
    // every clean prod deploy yet never touches BASELINE_SQL — so the
    // "applies cleanly" test below would NOT catch it. Run the actual
    // extracted guard query against the populated test DB: a malformed
    // guard throws a Postgres syntax error and fails this test.
    const guardSql = extractGuardSql()
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL_TEST || process.env.DATABASE_URL!,
    })
    try {
      const r = await pool.query(guardSql)
      // orders exists in the test DB → the guard must resolve it.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((r.rows[0] as any)?.rel).toBe('orders')
    } finally {
      await pool.end()
    }
  })

  it('applies cleanly to a brand-new empty database', async () => {
    const admin = new Pool({ connectionString: adminUrl() })
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`)
      await admin.query(`CREATE DATABASE ${SCRATCH_DB}`)
    } finally {
      await admin.end()
    }

    const scratch = new Pool({ connectionString: scratchUrl() })
    try {
      const sql = extractBaselineSql()
      // node-postgres runs a multi-statement string via the simple query
      // protocol — exactly how the migration's sql.raw() executes it.
      await scratch.query(sql)

      const tables = await scratch.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM pg_tables WHERE schemaname='public'`,
      )
      const enums = await scratch.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM pg_type WHERE typtype='e'`,
      )
      // 29 base tables (payload_migrations excluded — runner-managed) + 24 enums.
      expect(Number(tables.rows[0].count)).toBeGreaterThanOrEqual(29)
      expect(Number(enums.rows[0].count)).toBeGreaterThanOrEqual(24)

      // Spot-check the money-critical tables + a junction table exist.
      for (const t of [
        'orders',
        'orders_line_items',
        'products',
        'vendors',
        'payouts',
        'payouts_lines',
        'refunds',
        'quotes',
        'users',
        'users_sessions',
      ]) {
        const r = await scratch.query<{ rel: string | null }>(
          `SELECT to_regclass($1) AS rel`,
          [`public.${t}`],
        )
        expect(r.rows[0].rel).toBe(t)
      }
    } finally {
      await scratch.end()
    }
  })

  afterAll(async () => {
    const admin = new Pool({ connectionString: adminUrl() })
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`)
    } catch {
      // best-effort cleanup
    } finally {
      await admin.end()
    }
  })
})
