/**
 * One-time test DB bootstrap. Creates (or recreates) the database named
 * by DATABASE_URL_TEST so Vitest has a clean Postgres to push schema into.
 *
 * Usage:
 *   DATABASE_URL_TEST=postgres://user@localhost:5432/bangarah_test \
 *     npm run test:integration:setup-db
 *
 * If DATABASE_URL_TEST is unset, we derive a sibling DB name with `_test`
 * appended to whatever is in DATABASE_URL — convenient for local dev.
 */
import { Client } from 'pg'

async function main() {
  const url = pickTestUrl()
  const { admin, dbName } = splitUrl(url)
  if (!/_test$/.test(dbName)) {
    console.error(
      `Refusing to bootstrap a DB whose name doesn't end in "_test": ${dbName}. ` +
        `This prevents accidentally wiping the dev database.`,
    )
    process.exit(1)
  }
  const client = new Client({ connectionString: admin })
  await client.connect()
  try {
    // Drop any sessions still attached so DROP DATABASE succeeds.
    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [dbName],
    )
    await client.query(`DROP DATABASE IF EXISTS "${dbName}"`)
    await client.query(`CREATE DATABASE "${dbName}"`)
    console.log(`✓ Test DB "${dbName}" recreated. Vitest will push schema on first run.`)
  } finally {
    await client.end()
  }
}

function pickTestUrl(): string {
  if (process.env.DATABASE_URL_TEST) return process.env.DATABASE_URL_TEST
  const dev = process.env.DATABASE_URL
  if (!dev) {
    throw new Error(
      'Neither DATABASE_URL_TEST nor DATABASE_URL is set. Set one before running.',
    )
  }
  // Append `_test` to the dev DB name.
  return dev.replace(/\/([^/?]+)(\?|$)/, '/$1_test$2')
}

function splitUrl(url: string): { admin: string; dbName: string } {
  const u = new URL(url)
  const dbName = u.pathname.replace(/^\//, '')
  u.pathname = '/postgres'
  return { admin: u.toString(), dbName }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
