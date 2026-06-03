import type { Config, PayloadRequest } from 'payload'
import { expireQuotesTask } from './expireQuotes'
import { cleanGuestCartsTask } from './cleanGuestCarts'
import { retryFailedEmailTask } from './retryFailedEmails'
import { pruneProcessedEventsTask } from './pruneProcessedEvents'
import { pruneAuditLogTask } from './pruneAuditLog'
import { sweepAbandonedOrdersTask } from './sweepAbandonedOrders'

/**
 * Payload jobs configuration. Tasks queued via payload.jobs.queue() or run
 * on the schedule declared per-task below. The runner is invoked at
 * `POST /api/payload-jobs/run` — hit it from Vercel Cron, GitHub Actions,
 * or any external cron at any cadence (we wire Vercel Cron at the project
 * level in vercel.json).
 *
 * Job state lives in the auto-generated `payload-jobs` collection.
 *
 * H10 (M7) — runner access policy:
 *   Vercel Cron sends requests with `Authorization: Bearer <CRON_SECRET>`
 *   when CRON_SECRET is set on the project. We accept either that bearer
 *   OR an authenticated admin user (the default for ad-hoc /admin runs).
 *   Without this, Vercel's cron call hits the endpoint unauthenticated
 *   and Payload's default `admin-only` gate blocks it → jobs never run.
 */
function runnerAccess({ req }: { req: PayloadRequest }) {
  // Admin user via the Payload admin UI — keep this so manual runs work.
  if (req.user?.role === 'admin') return true
  // Vercel Cron auth: bearer token that matches the CRON_SECRET env. The
  // header is set automatically by Vercel's cron runtime when the env is
  // configured on the project. Without CRON_SECRET, no bearer ever passes.
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const auth = req.headers?.get?.('authorization') ?? ''
  // m15 (Phase 2): constant-time compare via `timingSafeEqual` so an
  // attacker can't infer the secret byte-by-byte from response-time
  // diffs. Length-check first because `timingSafeEqual` throws on
  // mismatched-length buffers; the early-return collapses the timing
  // side channel for length too (both branches are O(1)).
  const expectedBearer = `Bearer ${expected}`
  if (auth.length !== expectedBearer.length) return false
  // Lazy-require to keep the edge-runtime-incompatible `node:crypto`
  // out of any future edge-deployable code path that imports this file
  // transitively.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { timingSafeEqual } = require('node:crypto') as typeof import('node:crypto')
  return timingSafeEqual(Buffer.from(auth), Buffer.from(expectedBearer))
}

export const jobs: Config['jobs'] = {
  tasks: [
    { ...expireQuotesTask, schedule: [{ cron: '7 * * * *', queue: 'default' }] },
    { ...cleanGuestCartsTask, schedule: [{ cron: '15 4 * * *', queue: 'default' }] },
    // I7 (M8): daily prune of the processed-events idempotency ledger.
    { ...pruneProcessedEventsTask, schedule: [{ cron: '30 3 * * *', queue: 'default' }] },
    // K5 (round-5 privacy M3): weekly prune of audit-log rows older than 7y.
    { ...pruneAuditLogTask, schedule: [{ cron: '45 3 * * 0', queue: 'default' }] },
    // L1 (chaos C1 mitigation): every 15 min, cancel pending_payment orders
    // older than 30 min so inventory burnt on processor-timeout / revert
    // failure auto-recovers without operator intervention.
    { ...sweepAbandonedOrdersTask, schedule: [{ cron: '*/15 * * * *', queue: 'default' }] },
    retryFailedEmailTask, // event-driven, no schedule
  ],
  // Run any due scheduled tasks whenever the runner endpoint is hit.
  autoRun: [
    {
      cron: '0 * * * *',
      queue: 'default',
      limit: 25,
    },
  ],
  shouldAutoRun: () => process.env.PAYLOAD_JOBS_DISABLE !== 'true',
  // I7 (M9): purge completed job rows so the payload-jobs collection
  // doesn't accumulate forever. Payload's built-in flag deletes the row
  // after the task finishes successfully (failures stay so we can debug).
  deleteJobOnComplete: true,
  access: {
    run: runnerAccess,
  },
}
