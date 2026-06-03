/**
 * Vitest global setup for integration tests.
 *
 * Responsibilities:
 *   1. Force DATABASE_URL to point at the dedicated test DB before any module
 *      under test reads it. Refuses to run if the resolved DB name doesn't
 *      end in "_test" — belt-and-braces guard against nuking the dev DB.
 *   2. Set NODE_ENV=test and a deterministic PAYLOAD_SECRET / site URL so
 *      payload.config can boot without surprises.
 *   3. Boot Payload once. Subsequent calls to `getPayload()` reuse this
 *      instance (it's cached in src/lib/payload.ts).
 *   4. Truncate domain tables before each test so individual tests start
 *      from a clean slate without paying the schema-push cost again.
 *   5. Mock `@/lib/email` so webhook tests don't try to talk to Resend.
 */
import { beforeAll, beforeEach, vi } from 'vitest'
import { Pool } from 'pg'

// ── 1. Environment setup ─────────────────────────────────────────────────
// NODE_ENV is typed as readonly by Node's types; assign via the indexed
// form so TS doesn't complain. This must happen before any module reads it.
;(process.env as Record<string, string>).NODE_ENV = 'test'
process.env.PAYLOAD_SECRET =
  process.env.PAYLOAD_SECRET ?? 'integration-test-secret-not-for-prod-use-only'
process.env.NEXT_PUBLIC_SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
// Stripe keys: tests mock the SDK, but verifyStripeWebhook still reads them
// to construct the client.
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? 'sk_test_dummy'
process.env.STRIPE_WEBHOOK_SECRET =
  process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_test_dummy'

const testUrl = pickTestUrl()
const dbName = new URL(testUrl).pathname.replace(/^\//, '')
if (!/_test$/.test(dbName)) {
  throw new Error(
    `[test setup] refusing to run: DATABASE_URL points at "${dbName}", ` +
      `which doesn't end in "_test". Set DATABASE_URL_TEST to a sibling DB ` +
      `(e.g. bangarah_test) or run npm run test:integration:setup-db first.`,
  )
}
process.env.DATABASE_URL = testUrl
// Allow schema push so the first test run creates tables in the fresh test DB.
delete process.env.PAYLOAD_DISABLE_SCHEMA_PUSH

// ── 2. Mock the email layer ──────────────────────────────────────────────
// Hoisted by vi.mock so it applies before route modules import @/lib/email.
vi.mock('@/lib/email', () => ({
  sendOrderConfirmation: vi.fn().mockResolvedValue(undefined),
  sendVendorApprovalEmail: vi.fn().mockResolvedValue(undefined),
  sendVendorApproved: vi.fn().mockResolvedValue(undefined),
  sendQuoteStatusEmail: vi.fn().mockResolvedValue(undefined),
  sendQuoteResponse: vi.fn().mockResolvedValue(undefined),
  sendNewQuoteCustomer: vi.fn().mockResolvedValue(undefined),
  sendNewQuoteOps: vi.fn().mockResolvedValue(undefined),
  sendNewVendorOps: vi.fn().mockResolvedValue(undefined),
  OPS_EMAIL: 'ops@test.local',
}))

// ── 3. Payload init + truncate helpers ───────────────────────────────────
let pool: Pool | null = null

beforeAll(async () => {
  // Dynamically import after env is set so payload.config picks up DATABASE_URL.
  const { getPayload } = await import('@/lib/payload')
  const payload = await getPayload()
  pool = (payload.db as unknown as { pool: Pool }).pool
})

beforeEach(async () => {
  if (!pool) throw new Error('pool not initialized — beforeAll failed')
  // Truncate every domain table the money-path touches. CASCADE handles
  // relation child tables (orders_line_items, _rels, etc.). Identity is
  // restarted so ids are deterministic-ish across runs.
  //
  // We list tables explicitly rather than truncate-all so Payload's
  // payload_migrations and payload_preferences stay intact between tests.
  await pool.query(`
    TRUNCATE TABLE
      orders,
      products,
      vendors,
      refunds,
      processed_events,
      audit_log,
      payouts,
      quotes,
      pages,
      categories,
      media,
      users
    RESTART IDENTITY CASCADE
  `)
})

// No afterAll teardown: the setup file's lifecycle hooks fire per test file,
// but Payload's adapter caches a single pool across the whole run. Closing
// it after the first file would leave subsequent files unable to query.
// Vitest tears the worker down when the run ends, which releases handles.

function pickTestUrl(): string {
  if (process.env.DATABASE_URL_TEST) return process.env.DATABASE_URL_TEST
  const dev = process.env.DATABASE_URL
  if (!dev) {
    throw new Error(
      'Neither DATABASE_URL_TEST nor DATABASE_URL is set. Run ' +
        '`npm run test:integration:setup-db` first or set DATABASE_URL_TEST.',
    )
  }
  // Idempotent: Vitest 4 re-evaluates this setup file per test file in the
  // shared worker (isolate: false), and DATABASE_URL was already rewritten
  // by the first evaluation — don't append `_test` again.
  if (/_test(\?|$)/.test(new URL(dev).pathname)) return dev
  return dev.replace(/\/([^/?]+)(\?|$)/, '/$1_test$2')
}
