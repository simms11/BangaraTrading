/**
 * M12 — DB-level refund-cap trigger (fail-before / pass-after).
 *
 * The app-level cap check in Refunds.beforeChange reads the existing
 * refund sum BEFORE the in-flight row commits. On the no-`req` fallback
 * path (M9), the advisory lock brackets the READ but not the COMMIT, so
 * two concurrent writers can both pass the check and both land — an
 * over-cap pair of committed rows. The fix is a BEFORE INSERT OR UPDATE
 * trigger whose `SELECT … FOR UPDATE` on the parent order serialises the
 * entire check+write against every other refund write for that order,
 * regardless of which connection or code path issues it.
 *
 * Tests 1–2 reproduce the race DETERMINISTICALLY at the SQL layer by
 * interleaving two explicit transactions (the exact interleaving the
 * production race produces, minus the timing luck):
 *   1. WITHOUT the trigger: both commit → over-cap pair lands (the bug).
 *   2. WITH the trigger: writer 2 blocks on the order row, then rejects
 *      with refund_cap_exceeded once writer 1 commits.
 * Tests 3–5 prove the Payload write path still works with the trigger
 * installed (over-cap concurrent creates net exactly one row; a
 * within-cap create succeeds; non-counted rows are never falsely
 * rejected).
 *
 * Ordering note: this file relies on in-file test order (vitest config
 * pins sequence.concurrent=false and fileParallelism=false) — test 1
 * drops the trigger, test 2 re-applies it, tests 3–5 assume it present.
 * afterAll re-applies UP_SQL so the rest of the suite runs in the
 * post-migration state.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool, type PoolClient } from 'pg'
import { getPayload } from '@/lib/payload'
import { createOrderFromCart, markOrderPaid } from '@/lib/orders'
import { createProduct, cartFor, TEST_ADDRESS } from '../helpers/fixtures'
import {
  UP_SQL,
  DOWN_SQL,
} from '@/payload/migrations/20260604_phase_5_25_refund_cap_trigger'
import type { Order } from '@/payload-types'

let pool: Pool

beforeAll(() => {
  // setup.ts has already rewritten DATABASE_URL to the *_test DB (and
  // refuses to run otherwise), so this pool can only touch the test DB.
  pool = new Pool({ connectionString: process.env.DATABASE_URL! })
})

afterAll(async () => {
  // Leave the test DB in the post-migration state for the rest of the run.
  for (const stmt of UP_SQL) await pool.query(stmt)
  await pool.end()
})

async function seedPaidOrder(): Promise<Order> {
  const product = await createProduct({ quantity: 5 })
  const order = await createOrderFromCart({
    cart: cartFor([{ product, quantity: 2 }]),
    customerEmail: 'm12@test.local',
    shipping: TEST_ADDRESS,
    billing: TEST_ADDRESS,
    shippingMethodId: 'pickup',
  })
  await markOrderPaid(order.id, {
    processor: 'stripe',
    processorRef: `cs_${order.orderNumber}`,
    processorIntentRef: `pi_${order.orderNumber}`,
  })
  return order
}

// Raw INSERT mirrors what any code path's commit ultimately does — the
// trigger must hold regardless of which client/ORM issued the write.
function insertRefund(
  c: PoolClient | Pool,
  orderId: number,
  amount: number,
  ref: string,
) {
  return c.query(
    `INSERT INTO refunds (reference, order_id, status, amount_minor, currency, reason)
     VALUES ($1, $2, 'pending', $3, 'NAD', 'requested_by_customer')`,
    [ref, orderId, amount],
  )
}

async function refundTotals(orderId: number): Promise<{ n: number; sum: number }> {
  const { rows } = await pool.query<{ n: string; sum: string }>(
    `SELECT count(*)::text AS n, COALESCE(SUM(amount_minor), 0)::text AS sum
     FROM refunds WHERE order_id = $1`,
    [orderId],
  )
  return { n: Number(rows[0].n), sum: Number(rows[0].sum) }
}

describe('M12 — refund cumulative-cap DB trigger', () => {
  it('FAIL-BEFORE: without the trigger, interleaved writers commit an over-cap pair', async () => {
    for (const stmt of DOWN_SQL) await pool.query(stmt) // ensure trigger absent
    const order = await seedPaidOrder()
    const amount = Math.ceil(order.totalMinor * 0.8)
    const c1 = await pool.connect()
    const c2 = await pool.connect()
    try {
      await c1.query('BEGIN')
      await c2.query('BEGIN')
      // Both pre-commit cap reads would see "cap available" here — the race.
      await insertRefund(c1, order.id, amount, `m12_a_${order.orderNumber}`)
      await insertRefund(c2, order.id, amount, `m12_b_${order.orderNumber}`)
      await c1.query('COMMIT')
      await c2.query('COMMIT')
    } finally {
      c1.release()
      c2.release()
    }
    const { n, sum } = await refundTotals(order.id)
    // The bug: 160% of the order total committed as refunds.
    expect(n).toBe(2)
    expect(sum).toBeGreaterThan(order.totalMinor)
  })

  it('PASS-AFTER: with the trigger, writer 2 blocks on the order row, then rejects', async () => {
    for (const stmt of UP_SQL) await pool.query(stmt) // apply the migration SQL
    const order = await seedPaidOrder()
    const amount = Math.ceil(order.totalMinor * 0.8)
    const c1 = await pool.connect()
    const c2 = await pool.connect()
    try {
      await c1.query('BEGIN')
      // Takes the order-row lock via the trigger's FOR UPDATE.
      await insertRefund(c1, order.id, amount, `m12_c_${order.orderNumber}`)
      await c2.query('BEGIN')
      const blocked = insertRefund(c2, order.id, amount, `m12_d_${order.orderNumber}`)
      let settled = false
      blocked.then(
        () => (settled = true),
        () => (settled = true),
      )
      await new Promise((r) => setTimeout(r, 250))
      // Proof of serialisation: writer 2 is parked behind writer 1's lock.
      expect(settled).toBe(false)
      await c1.query('COMMIT')
      // Lock released → writer 2 re-reads committed state → cap trips.
      await expect(blocked).rejects.toThrow(/refund_cap_exceeded/)
      await c2.query('ROLLBACK')
    } finally {
      c1.release()
      c2.release()
    }
    const { n, sum } = await refundTotals(order.id)
    expect(n).toBe(1) // exactly one landed
    expect(sum).toBeLessThanOrEqual(order.totalMinor)
  })

  it('with the trigger, two concurrent over-cap payload.creates net exactly one refund', async () => {
    const order = await seedPaidOrder()
    const payload = await getPayload()
    const amount = Math.ceil(order.totalMinor * 0.8)
    const mk = (ref: string) =>
      payload.create({
        collection: 'refunds',
        overrideAccess: true,
        data: {
          reference: ref,
          order: order.id,
          status: 'pending',
          amountMinor: amount,
          currency: order.currency,
          reason: 'requested_by_customer',
          processor: 'manual',
        },
      })
    const results = await Promise.allSettled([
      mk(`m12_e_${order.orderNumber}`),
      mk(`m12_f_${order.orderNumber}`),
    ])
    // One admitted (app check or trigger rejects the other — either layer
    // may fire first; the invariant is the committed outcome).
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const { sum } = await refundTotals(order.id)
    expect(sum).toBeLessThanOrEqual(order.totalMinor)
  })

  it('with the trigger, a within-cap refund (exactly the order total) still succeeds', async () => {
    const order = await seedPaidOrder()
    const payload = await getPayload()
    const r = await payload.create({
      collection: 'refunds',
      overrideAccess: true,
      data: {
        reference: `m12_g_${order.orderNumber}`,
        order: order.id,
        status: 'pending',
        amountMinor: order.totalMinor, // == cap: allowed, not over it
        currency: order.currency,
        reason: 'requested_by_customer',
        processor: 'manual',
      },
    })
    expect(r.id).toBeTruthy()
  })

  it('skip branch: touching a non-counted (failed) row is not rejected when the order is at cap', async () => {
    const order = await seedPaidOrder()
    const failedRef = `m12_h_${order.orderNumber}`
    // A failed 80% refund (does not count toward the cap)…
    await insertRefund(pool, order.id, Math.ceil(order.totalMinor * 0.8), failedRef)
    await pool.query(`UPDATE refunds SET status = 'failed' WHERE reference = $1`, [failedRef])
    // …then a legitimate full refund, allowed precisely because failed
    // rows don't count…
    await insertRefund(pool, order.id, order.totalMinor, `m12_i_${order.orderNumber}`)
    // …then ANY update touching the failed row must not throw. Without
    // the trigger's skip branch this raises refund_cap_exceeded
    // (existing 1.0×total + NEW 0.8×total > total).
    await expect(
      pool.query(`UPDATE refunds SET description = 'ops annotation' WHERE reference = $1`, [
        failedRef,
      ]),
    ).resolves.toBeTruthy()
  })
})
