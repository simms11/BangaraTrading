# Operations Runbook

First-90-days playbook for the Bangarah Trading marketplace.

## At a glance

- **Stack**: Next.js 15 (Vercel), Payload CMS 3, Postgres (Neon), Stripe + Flutterwave, Resend (email), Upstash Redis (rate limiting), Cloudflare R2 (uploads), Sentry (observability).
- **Critical env vars** (refuse-to-boot list, see `src/payload.config.ts`):
  `PAYLOAD_SECRET`, `DATABASE_URL`, `NEXT_PUBLIC_SITE_URL`, `RESEND_API_KEY`,
  `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`,
  `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`,
  `PAYLOAD_DISABLE_SCHEMA_PUSH=true`.
- **Health endpoint**: `GET /api/health` — checks DB + dead-letter email backlog. Returns 503 with detail on failure.

## Incident playbook

### "Customers aren't getting confirmation emails"
1. `curl https://<site>/api/health` — look for `jobs.failedEmailDeadLetter > 0`.
2. Check Sentry for `area: email, kind: retry_failed` issues.
3. Verify `RESEND_API_KEY` is valid in Vercel env.
4. Re-queue affected orders via Payload admin → Orders → resend confirmation
   (currently manual; see `src/payload/jobs/retryFailedEmails.ts`).

### "Stripe webhook is broken"
1. Stripe dashboard → Developers → Webhooks → check delivery attempts.
2. Verify `STRIPE_WEBHOOK_SECRET` matches the endpoint signing secret.
3. Replay specific events from the Stripe dashboard ("Resend webhook").
4. Idempotency is keyed on Stripe event id (see `src/lib/idempotency.ts`),
   so replays are safe.

### "Payouts double-paid a vendor"
1. The Postgres advisory lock at `src/lib/payouts.ts:53-64` should prevent
   this. If it happened, check `payouts` table for two rows with the same
   `lines.orderRef` ids overlapping.
2. Mark the duplicate as `status: cancelled` (the transition allowlist
   blocks `paid → *` — see Payouts beforeChange; you'll need to use the
   underlying SQL for clawback OR create a negative compensating payout).
3. Audit-log row is automatically created.

### "Inventory drifted"
1. Check Sentry for `area: inventory, kind: revert_failed | release_failed`.
2. Audit-log `kind: inventory.revert_failed` rows have product/quantity/orderNumber.
3. Manual reconciliation via Payload admin → Products → adjust quantity.

### "DB outage"
1. Neon dashboard → check status.
2. If Neon is down, the app's `/api/health` returns 503. Most reads
   degrade to empty / static.
3. Restore from Neon point-in-time recovery if data was lost (per Neon
   plan; check retention window).

### "Need to roll back a deploy"
1. Vercel dashboard → Deployments → click prior good deploy → "Promote to
   Production".
2. If a migration shipped in the bad deploy, DO NOT roll back without
   running the migration's `down` (see `src/payload/migrations/`).
   Run `npm run db:migrate -- down` against the migration name to revert.

## Routine maintenance

- **Cron**: Vercel Cron at `*/15 * * * *` hits `/api/payload-jobs/run`.
  Verify in Vercel dashboard → Settings → Cron Jobs.
- **Prune jobs** (run daily/weekly via the cron above):
  - `pruneProcessedEvents` — 90d retention on webhook idempotency.
  - `pruneAuditLog` — 7y retention on audit log (compliance window).
  - `cleanGuestCarts` — sweep abandoned guest carts.
  - `expireQuotes` — flip past-validity quotes to expired.
- **Secret rotation**: rotate `PAYLOAD_SECRET` invalidates all sessions
  (forces re-login). Rotate `STRIPE_WEBHOOK_SECRET` requires updating
  the Stripe dashboard endpoint config in lockstep.

## Backup / DR

- **Database**: Neon provides daily backups; promote a branch from
  point-in-time recovery for disaster.
- **R2 uploads**: object-level versioning is enabled in the bucket. Use
  `wrangler r2 object` to restore previous versions.
- **Audit-log retention**: 7 years (`src/payload/jobs/pruneAuditLog.ts`).
- **Order retention**: indefinite for the current codebase. If
  compliance requires deletion, the audit-log retention sets the floor.

## GDPR / POPIA data-subject requests

- **Right to access**: query Payload admin → Users → find user →
  exports JSON of their record + related orders/quotes.
- **Right to erasure**: customer can self-serve via `/account` →
  "Delete my account" (anonymises the User row, retains orders for
  financial-record compliance).
- **Sub-processor list**: see `/privacy` page in production; update
  whenever a new processor is added (Upstash, Sentry, PostHog, etc).

## Currency / locale

- All amounts are stored as integer minor units (cents).
- Supported currencies (two-decimal only): NAD, ZAR, USD, GBP, EUR.
- Adding a zero-decimal currency (XAF, RWF) requires updating the
  `* 100` math in `src/app/(payload)/api/webhooks/flutterwave/route.ts`
  and the `formatPrice` minimumFractionDigits.

## Performance tuning

- `DATABASE_POOL_MAX` — Vercel concurrent function instances × this
  value must stay under Neon's connection cap. Recommended: 3 on
  Vercel Hobby/Pro, 10 on a single long-running node host.
- `getCurrentUser` LRU TTL is 30s. Trade-off: admin-demotion delay
  bounded at 30s on UI paths, 24h on direct REST calls (JWT expiry).
