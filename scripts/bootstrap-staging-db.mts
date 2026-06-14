/**
 * Track B staging bootstrap.
 *
 * Applies the 7 shipped migrations to an EMPTY Neon Postgres via plain `pg`,
 * then records them in payload_migrations so the app (deployed with
 * PAYLOAD_DISABLE_SCHEMA_PUSH=true) sees an already-migrated database.
 *
 * Faithful-artifact strategy: we import the real migration modules and run
 * their actual up() functions. The ONLY non-pg dependency is drizzle's
 * PgDialect, used SOLELY to render each static `sql`...`` / sql.raw()
 * template to text. Every statement executes over a single plain `pg`
 * Client (one connection, so 5_11's BEGIN/COMMIT block is honored).
 *
 * Idempotent: baseline self-guards (no-ops if public.orders exists), every
 * other migration is IF NOT EXISTS / CREATE OR REPLACE, and the
 * payload_migrations inserts are NOT EXISTS-guarded. Aborts on a non-empty
 * DB unless ALLOW_NONEMPTY=1.
 *
 * Usage:
 *   DATABASE_URL='postgresql://…?sslmode=require' \
 *     npx tsx scripts/bootstrap-staging-db.mts
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import pg from 'pg'

const require = createRequire(import.meta.url)

// Absolute path to the SAME drizzle install @payloadcms/db-postgres uses, so
// the migrations' `sql` and our PgDialect/`sql` come from one module instance.
const NESTED_DRIZZLE = path.resolve(
  process.cwd(),
  'node_modules/@payloadcms/db-postgres/node_modules/drizzle-orm',
)

// The migration modules `import { sql } from '@payloadcms/db-postgres'`, which
// transitively loads `payload`'s env bootstrap — that crashes under tsx
// (@next/env has no `default` export). The only runtime value the migrations
// need from that import is `sql` (a re-export of drizzle's sql); everything
// else is types. Intercept the CJS require for that one specifier and return a
// minimal module exposing `sql` from the same nested drizzle, so importing the
// migrations never touches `payload`. (This is the Track B "B2 is broken"
// workaround, contained to a single specifier.)
function patchDbPostgresRequire(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Mod = require('node:module') as any
  const orig = Mod._load
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Mod._load = function (request: string, ...rest: any[]) {
    if (request === '@payloadcms/db-postgres') {
      return { sql: require(NESTED_DRIZZLE).sql }
    }
    return orig.call(this, request, ...rest)
  }
}

// Load PgDialect from the SAME drizzle the migrations' `sql` came from, so
// the rendered SQL objects are recognized. Render-only; never touches the DB.
function loadPgDialect(): new () => { sqlToQuery: (q: unknown) => { sql: string; params: unknown[] } } {
  return require(path.join(NESTED_DRIZZLE, 'pg-core')).PgDialect
}

// Byte-for-byte the table @payloadcms/drizzle's runner materializes for the
// predefined `payload-migrations` collection (id serial PK, name text->varchar,
// batch number->numeric, created_at then updated_at timestamp(3) tz default
// now() not null). Verified against drizzle-kit's generated DDL for the exact
// pgTable the adapter builds. Only addition is `IF NOT EXISTS` for re-run
// safety, which does not change the resulting table shape.
const PAYLOAD_MIGRATIONS_DDL = `CREATE TABLE IF NOT EXISTS "payload_migrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar,
	"batch" numeric,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
)`

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')

  // Must run before importing the migrations (which pull in db-postgres).
  patchDbPostgresRequire()
  const { migrations } = (await import('../src/payload/migrations')) as {
    migrations: Array<{ name: string; up: (a: unknown) => Promise<void> }>
  }

  const names = migrations.map((m) => m.name)
  if (names.length !== 7) {
    throw new Error(`Expected 7 migrations, found ${names.length}: ${names.join(', ')}`)
  }
  console.log('Migrations to apply (registry order):')
  names.forEach((n, i) => console.log(`  ${i + 1}. ${n}`))

  const PgDialect = loadPgDialect()
  const dialect = new PgDialect()

  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()

  // db shim: render the drizzle SQL object to text, execute over plain pg.
  // No params arg when params are empty, so multi-statement strings
  // (BASELINE_SQL via sql.raw) use the simple query protocol.
  const db = {
    execute: async (arg: unknown) => {
      const { sql, params } = dialect.sqlToQuery(arg)
      return params && params.length ? client.query(sql, params) : client.query(sql)
    },
  }

  try {
    // Safety: this targets an EMPTY DB. Refuse if already populated.
    const reg = await client.query(`SELECT to_regclass('public.payload_migrations') AS t`)
    if (reg.rows[0].t && !process.env.ALLOW_NONEMPTY) {
      const cnt = await client.query(`SELECT count(*)::int AS c FROM payload_migrations`)
      if (cnt.rows[0].c > 0) {
        throw new Error(
          `payload_migrations already has ${cnt.rows[0].c} row(s); this script ` +
            `targets an empty DB. Set ALLOW_NONEMPTY=1 to override intentionally.`,
        )
      }
    }

    console.log('\nCreating payload_migrations bookkeeping table…')
    await client.query(PAYLOAD_MIGRATIONS_DDL)

    for (const m of migrations) {
      process.stdout.write(`Applying ${m.name} … `)
      const start = Date.now()
      // up() only destructures { db }; payload/req are unused by these files.
      await (m.up as (a: { db: typeof db }) => Promise<void>)({ db })
      console.log(`ok (${Date.now() - start}ms)`)
    }

    console.log('\nRecording migrations (batch 1, no dev sentinel)…')
    for (const name of names) {
      await client.query(
        `INSERT INTO payload_migrations (name, batch)
         SELECT $1::varchar, 1
         WHERE NOT EXISTS (SELECT 1 FROM payload_migrations WHERE name = $1::varchar)`,
        [name],
      )
    }

    // ---------------------------- Verification ----------------------------
    console.log('\n=== Verification ===')
    const recorded = await client.query(
      `SELECT name, batch::int AS batch FROM payload_migrations ORDER BY id`,
    )
    console.log('payload_migrations rows:')
    recorded.rows.forEach((r: { batch: number; name: string }) =>
      console.log(`  [batch ${r.batch}] ${r.name}`),
    )

    const dev = await client.query(
      `SELECT count(*)::int AS c FROM payload_migrations WHERE batch = -1 OR name = 'dev'`,
    )
    const trigger = await client.query(
      `SELECT tgname FROM pg_trigger WHERE tgname = 'refunds_cap_check' AND NOT tgisinternal`,
    )
    const fn = await client.query(`SELECT 1 FROM pg_proc WHERE proname = 'refunds_enforce_cap'`)
    const tables = await client.query(
      `SELECT count(*)::int AS c FROM pg_tables WHERE schemaname = 'public'`,
    )
    const enums = await client.query(`SELECT count(*)::int AS c FROM pg_type WHERE typtype = 'e'`)

    const checks: Array<[string, boolean]> = [
      ['7 migrations recorded', recorded.rowCount === 7],
      ['all rows batch = 1', recorded.rows.every((r: { batch: number }) => r.batch === 1)],
      ['migration names match registry', recorded.rows.map((r: { name: string }) => r.name).join('|') === names.join('|')],
      ['no dev sentinel (batch -1 / name=dev)', dev.rows[0].c === 0],
      ['refunds_cap_check trigger present', trigger.rowCount === 1],
      ['refunds_enforce_cap() function present', fn.rowCount === 1],
      [`>= 30 public tables (got ${tables.rows[0].c})`, tables.rows[0].c >= 30],
      [`>= 24 enums (got ${enums.rows[0].c})`, enums.rows[0].c >= 24],
    ]

    console.log('')
    let ok = true
    for (const [label, pass] of checks) {
      console.log(`  ${pass ? '✓' : '✗'} ${label}`)
      if (!pass) ok = false
    }

    if (!ok) {
      console.error('\n✗ Verification FAILED — do NOT redeploy.')
      process.exitCode = 1
    } else {
      console.log('\n✓ Bootstrap complete. Safe to redeploy on Vercel and smoke-test.')
    }
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
