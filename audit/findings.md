# Production-readiness audit — Phase 1 findings

Branch: `rebuild/v2`
HEAD: `88b854e` (Phase 5.23)
Scope: full codebase, read-only.
Process: four parallel agents (money, security+data, correctness+reliability, frontend+build) → consolidated and reclassified against the strict severity definitions agreed for this pass.

Severity definitions used here:
- **CRITICAL** — data loss, security holes, money handled incorrectly, breaks checkout/payment.
- **MAJOR** — incorrect behaviour under normal use, missing error handling on a path that will be hit, race conditions, broken state, silent feature failure.
- **MINOR** — code quality, missing tests, inconsistent patterns, performance not yet user-facing, style.

Some agent-rated MAJOR items have been demoted to MINOR where the trigger is a narrow edge case ("admin double-clicks the same refund on a sibling row within the same transaction"), or where the agent's own analysis showed a downstream guard already catches the bad outcome. Overlap across agents was deduplicated into a single ID.

---

## CRITICAL (1)

### ID: C1
**Severity:** ~~CRITICAL~~ → **FALSE POSITIVE** (verified Phase 2 prep; see OQ1)
**File:** `src/payload/jobs/sweepAbandonedOrders.ts:86`
**Description:** The sweeper's filter `'payment.processor': { not_equals: 'manual' }` excludes pending Stripe/Flutterwave orders because their `payment.processor` is NULL at order creation (only `markOrderPaid` or the manual branch in `checkout-actions.ts` sets it).
**Why it matters:** SQL three-valued logic: `column <> 'manual'` returns NULL (not true) when the column is NULL, so Postgres excludes the row. `createOrderFromCart` never sets `payment.processor`, so every abandoned Stripe/Flutterwave order has `processor IS NULL` and the sweeper rejects it. The entire abandoned-order inventory-release safety net documented in this file is silently broken — inventory decremented at order creation never gets released. This was introduced in Phase 5.20 with the manual-order exclusion; pre-existing tests did not catch it because they create orders that don't get their processor stamped manually first.
**Proposed fix:** Replace with an `or` clause that admits NULL: `{ or: [{ 'payment.processor': { not_equals: 'manual' } }, { 'payment.processor': { exists: false } }] }`. Add a regression test that creates a pending_payment order with no `payment` group and asserts the sweep picks it up. Verify in Phase 2 by querying the test DB directly to confirm the Payload `not_equals` operator emits SQL `<>` (and not `IS DISTINCT FROM`).

---

## MAJOR (16)

### ID: M1 — FIXED
**Diff:** `src/app/(payload)/api/webhooks/stripe/route.ts` — added `charge.refund.updated` / `refund.updated` event branches. The handler looks up the refund row by `processorRef` and patches `status` based on Stripe's reported state (`succeeded → completed`, `failed`/`canceled → failed`, otherwise → `processing`). System write uses `overrideAccess: true` with no `req.user`, so the Refunds beforeChange allowlist's `systemRefundUpdate` exception applies (M3 keeps the bypass narrow to this exact context-marker pattern).
**Test:** `tests/integration/access/m1-charge-refund-updated.test.ts` (2 cases) — (1) static-source check that the route references the new event keys; (2) end-to-end via a direct `payload.update` mirroring the handler's call shape: confirms a `processing` refund cleanly advances to `completed` without tripping the allowlist.

### ID: M1.original
**Severity:** MAJOR
**File:** `src/app/(payload)/api/webhooks/stripe/route.ts:298–375` (no `charge.refund.updated` handler)
**Description:** Stripe refunds reported as `pending` are stored as `status: 'processing'`, but there is no webhook subscription for `charge.refund.updated` / `refund.updated` to advance the row to `completed` or `failed`.
**Why it matters:** R11 added `processing` refunds to the payout-deduction set. A refund that ultimately FAILS at Stripe (e.g. ACH bounce) stays `processing` in our DB forever and permanently reduces vendor payouts even though no money was actually refunded — silent vendor under-payment. The R7 comments call this out; no remediation was added.
**Proposed fix:** Add a handler for `charge.refund.updated` (and/or `refund.updated`) that locates the row by `processorRef` and maps `r.status` to internal status using the same mapping already used at line ~370 on `charge.refunded`.

### ID: M2 — FIXED
**Diff:** `src/lib/cart/store.ts:147` — overflow guard now uses `Buffer.byteLength(value, 'utf8')` so multi-byte cart contents are measured correctly.
**Test:** `tests/integration/cart/byte-length.test.ts` (1 case) — payload designed so `string.length < 3500 < byteLength` confirms the fail-before / pass-after contract by construction.

### ID: M2.original
**Severity:** MAJOR
**File:** `src/lib/cart/store.ts:147`
**Description:** Cart-cookie overflow guard uses `value.length` (UTF-16 code-unit count) instead of `Buffer.byteLength(value, 'utf8')`, so non-ASCII cart contents can silently exceed the browser's 4 KB cookie limit.
**Why it matters:** Product titles with accented or multi-byte characters (already in the seed: "Bangarah") inflate the byte size above the JS-string `length`. Browser rejects/truncates the oversize cookie → next read returns malformed JSON → catch returns `EMPTY_CART`. The customer's cart silently vanishes between navigations.
**Proposed fix:** Compute byte length with `Buffer.byteLength(value, 'utf8')` and compare against a slightly lower threshold (e.g. 3500 bytes) to keep margin under the browser cap.

### ID: M3 — FIXED
**Diff:**
- `src/payload/collections/Refunds.ts` — transition-allowlist bypass replaced: `const isSystemHookWrite = (req as any).context?.systemRefundUpdate === true` (was `!req.user`). The auto-issue afterChange now sets `sysReq.context = { ...(sysReq.context ?? {}), systemRefundUpdate: true }` and passes `req` to its inner `payload.update` calls (both success and failure branches) so the marker propagates via `createLocalReq`'s `getRequestContext` merge.
- Cancelled-order guard widened so UPDATES on rows whose existing `reference` starts with `auto_` are admitted (previously only CREATE was). Without this, the auto-issue afterChange's own status flip (processing → failed) was rejected on cancelled orders and the throw poisoned the parent transaction, rolling back the CREATE that initiated it.
- M1 (Stripe `charge.refund.updated` webhook handler) does NOT set the context marker — it relies on the legitimate exception that the allowlist explicitly admits `processing → completed/failed/cancelled`, which is the very transition the webhook is meant to drive.
**Test:** `tests/integration/access/m3-refund-allowlist-context.test.ts` — issues a `completed → pending` rewind via `payload.update({ overrideAccess: true })` with no `req` (so no `systemRefundUpdate` marker). Expected behaviour: REJECTED. Old `!req.user` predicate would have admitted it; the explicit-marker predicate doesn't.
**Test side-effect:** Widening the cancelled-order guard cleared a downstream test regression in `tests/integration/access/round6.test.ts` (paid-after-cancel auto-refund) — the auto-issue chain now runs end-to-end, so the row legitimately reaches `failed` in the test env (no `STRIPE_SECRET_KEY` → `getStripeClient()` returns null → `issueProcessorRefund` returns `stripe_not_configured` → afterChange flips to `failed`). Test assertion was originally `['pending','processing']` (which masked the bug — the row was stranded there only because the guard's throw was caught), briefly broadened to `['pending','processing','failed']` (REJECTED — that made the test go blind to any future regression that strands the chain again), and finally tightened to `expect(auto?.status).toBe('failed')` — the deterministic outcome of the no-creds path under the test env's known config. Any future change that breaks the chain re-fails the test loudly.

### ID: M3.original
**Severity:** MAJOR
**File:** `src/payload/collections/Refunds.ts:280–298`
**Description:** The transition allowlist's system-write bypass is gated on `const isSystemHookWrite = !req.user`; any backend code path calling `payload.update` with `overrideAccess: true` and no attached user (server actions, jobs, the auto-issue afterChange hook itself, future reconciler scripts) bypasses the allowlist entirely.
**Why it matters:** Intent is "only the auto-issue hook can write `processing → completed`"; in practice any system path can rewind `completed → pending`. The amount/currency/processorRef immutability check (line ~198) blocks the worst edits but a `status` rewind on a completed row is still permitted. (Same root cause as the agent-flagged items in money / security / correctness audits.)
**Proposed fix:** Replace the predicate with an explicit `req.context?.systemRefundUpdate === true` marker that the auto-issue afterChange sets before its own `payload.update`. Move the immutability check above the bypass so even system writes cannot mutate amount/currency/processorRef on a completed row.

### ID: M4 — FIXED
**Diff:** `src/payload/collections/Orders.ts:151` — `confirmationToken.access.read` is now admin-only (mirrors the J2-round-4 fix on Quotes).
**Test:** `tests/integration/access/m4-order-token.test.ts` (2 cases) — vendor with a line on the order can read the order but the `confirmationToken` field is stripped; admin still sees it.

### ID: M4.original
**Severity:** MAJOR
**File:** `src/payload/collections/Orders.ts:140–145`
**Description:** Field-level `read` access on `confirmationToken` admits role `vendor`; the existing `Quotes.confirmationToken` parallel was already locked to admin-only after the J2 round-4 fix.
**Why it matters:** A vendor with one line on a multi-line order has collection-level read on the order row, plus the token, so they can hit the public guest URL `/orders/<n>?t=<token>` and see customer shipping address + all other vendors' line items + processorRef. The page's vendor-scoping (`isOwningVendor`) is the live gate, but the token gives them an alternative path that bypasses the per-line scoping check that lives in the page rather than the collection. Real impersonation surface; parallel was already closed on Quotes and forgotten on Orders.
**Proposed fix:** Mirror the Quotes pattern: `access: { read: ({ req: { user } }) => user?.role === 'admin' }`. Verify the page still works for owning customers/vendors (the page reads from `findOrderByNumber`, not the API).

### ID: M5 — FIXED
**Diff:**
- `src/lib/audit.ts` — added `'user.deleted'` (and `'payout.status_changed'`, which had also been missing) to the `AuditKind` union.
- `src/payload/collections/AuditLog.ts` — added `'user.deleted'` to the `kind` field's enum options.
- `src/payload-types.ts` — regenerated `kind` union entry.
- `src/payload/migrations/00000000_baseline.ts` — added `'user.deleted'` to the embedded enum DDL so a fresh DB has it.
- `src/payload/migrations/20260603_phase_5_24_audit_kind_user_deleted.ts` (NEW) — `ALTER TYPE public.enum_audit_log_kind ADD VALUE IF NOT EXISTS 'user.deleted'` for existing prod DBs. Registered in `src/payload/migrations/index.ts`.
- `src/lib/account-actions.ts:73` — self-service deletion now writes `kind: 'user.deleted'`.
**Test:** `tests/integration/access/m5-user-deleted-audit.test.ts` — runs the deletion path and asserts the audit row's `kind` is `'user.deleted'`.

### ID: M5.original
**Severity:** MAJOR
**File:** `src/lib/account-actions.ts:73`
**Description:** Self-service account deletion writes the audit row with `kind: 'order.status_changed'` (per the inline comment "closest existing kind").
**Why it matters:** POPIA Section 23 / GDPR Article 17 require a discoverable record of erasure. The `audit_log_kind_idx` index is the discoverability surface; a deletion event masquerading as an order event is not findable by compliance queries and pollutes the order audit stream. Wrong-kind audit on a path that runs every account deletion.
**Proposed fix:** Add `user.deleted` to `AuditKind` in `src/lib/audit.ts`, to `AuditLog.fields.kind.options`, and to the Postgres enum via a new migration (mirroring `20260601_phase_5_23_audit_kind_payout.ts`). Switch `account-actions.ts:73` to use it.

### ID: M6 — FIXED
**Diff:** `src/payload/collections/Vendors.ts` — both queries now id-cursor paginate:
- Linked-users session-revoke loop: `PAGE = 100`, up to 50 pages (max 5,000 users per ban event); breaks early when `docs.length < PAGE`.
- Cascade-archive products: `PAGE = 200`, up to 50 pages (max 10,000 products); breaks early on short page.
The id-cursor (`where.id.greater_than`) keeps each page independent of mutations applied to earlier pages — important because the loop itself updates rows.
**Test:** `tests/integration/access/m6-vendor-paginate.test.ts` — provisions 55 linked vendor users (> the old `limit: 50` cap), bans the vendor, asserts every user's `loggedInAt` clears.

### ID: M6.original
**Severity:** MAJOR
**File:** `src/payload/collections/Vendors.ts:104` (linked-users find `limit: 50`) and `src/payload/collections/Vendors.ts:171` (cascade-archive `limit: 1000`)
**Description:** Both queries silently truncate at the limit instead of paginating.
**Why it matters:** A vendor org with > 50 linked staff accounts keeps stale JWTs alive on the silently-truncated tail — exactly the population a ban is meant to lock out. The 1000-product cap is softer but realistic for catalog-heavy vendors. Both are documented as "limit: N" with no looping; under normal large-vendor use the truncation occurs.
**Proposed fix:** Paginate (loop until `docs.length < limit`) for both queries. For session-revoke the cleaner alternative is one raw SQL `DELETE FROM users_sessions WHERE _parent_id IN (SELECT id FROM users WHERE vendor_id=$1 AND role='vendor')`.

### ID: M7 — FIXED
**Diff:** `src/lib/action-rate-limit.ts` accepts `strict: true`; `src/lib/checkout-actions.ts:67` sets it on `place-order` so the limiter uses `consumeStrict` (fails closed) under Upstash outage.
**Test:** `tests/integration/cart/m7-rate-limit-strict.test.ts` (2 cases) — verifies `consumeStrict` is called when `strict: true` and `consume` otherwise.

### ID: M7.original
**Severity:** MAJOR
**File:** `src/lib/checkout-actions.ts:62–67`
**Description:** Order-creation rate limit uses `consume` (fails open) rather than `consumeStrict` (fails closed) — when Upstash is unreachable, the limit falls back to per-Vercel-instance in-memory state.
**Why it matters:** During an Upstash incident, a scripted attacker rotating IPs can spam `placeOrderAction` past the documented 20/min cap, creating real `pending_payment` orders and decrementing real inventory. The per-cart `consumeStrict` idempotency gate later in the function (cart-fingerprint) catches duplicate carts, but distinct fabricated cart cookies don't share fingerprints. Login/forgot-password are correctly strict; order creation, also money-touching, is not.
**Proposed fix:** Mark the `place-order` rule `strict: true` in `checkActionRateLimit`'s caller (or the rule definition).

### ID: M8 — FIXED
**Diff:** `src/payload/collections/Products.ts` — anonymous-read predicate now AND's `{ status: { equals: 'published' } }` with `{ 'vendor.status': { equals: 'active' } }`. Vendor's own products remain visible to the vendor regardless of status (so they can still see/edit a draft on a paused vendor org). Admin path unchanged.
**Test:** `tests/integration/access/m8-products-vendor-status.test.ts` — creates a `published` product on a `paused` vendor and asserts an anonymous `payload.find({ collection: 'products' })` does NOT return it.

### ID: M8.original
**Severity:** MAJOR
**File:** `src/payload/collections/Products.ts:6–18` (Products.access.read)
**Description:** Product `read` access filters by `status: 'published'` but does NOT filter by `vendor.status: 'active'`. The vendor-status filter exists only in `listProducts` / `getProductBySlug` (R8 frontend M4/M5).
**Why it matters:** A direct REST/GraphQL query `GET /api/products?where[status][equals]=published` returns paused/banned vendors' products even though the storefront pages hide them. Future partner integrations, mobile apps, or any consumer that talks to Payload directly will see catalog content the storefront has hidden. Defense-in-depth gap that's already a "feature silently fails" if any direct consumer exists.
**Proposed fix:** Add `{ 'vendor.status': { equals: 'active' } }` to the anonymous read predicate in Products.access.read (or via a beforeRead-like filter helper). Confirm performance is acceptable on the join.

### ID: M9 — FIXED
**Diff:** `src/payload/collections/Refunds.ts` — when no transaction session is available, the beforeChange cap-check now acquires `pg_advisory_lock(<orderId>)` on a dedicated pooled client and registers a 30s `setTimeout` to call `pg_advisory_unlock` (defensive — every code path that exits beforeChange also tries to release immediately). Sentry warning logged on the rare pool-fallback path so we can monitor frequency. The previous behaviour was to skip locking entirely and log a warning, which is exactly the path most likely to race (paid-after-cancel auto-refund).
**Test:** `tests/integration/access/m9-refund-lock-fallback.test.ts` — under a code path with no `req.transactionID`, attempting two concurrent refund creates whose sum exceeds the order total must reject one of them via the cap check (proves the lock+cap pair is enforcing serialisation).

### ID: M9.original
**Severity:** MAJOR
**File:** `src/payload/collections/Refunds.ts:100–132` (advisory_xact_lock fallback)
**Description:** The refund-cap TOCTOU lock uses `session.db.execute` from the transaction; when `req.transactionID` is undefined (e.g. the paid-after-cancel auto-refund created from `markOrderPaid` without a request context), the code logs a warning and proceeds WITHOUT a lock.
**Why it matters:** The very code path most likely to race (paid-after-cancel auto-refund created without a `req`) is the one that disables serialisation. The comment acknowledges the gap. A retry storm or a customer paying twice within the cancellation window can both create auto-refunds whose cumulative total exceeds the order total. Beforechange's positive-check on commit catches it, but on the second insert it throws → caller re-throws → infinite webhook retry.
**Proposed fix:** When no transaction session is available, fall back to a session-scoped `pg_advisory_lock` on a dedicated pooled client (held across the read+write+commit, released in a `finally`). The pool-level cost is acceptable on this rare path.

### ID: M10 — FIXED
**Diff:** `src/lib/email.ts` — new `safeRender(produceHtml, produceText, fallback)` helper wraps the `render(...)` calls; on throw, it queues a retry through the existing `queueRetry` pipeline with a plain-text "could not render — contact support" fallback body so the retry job can still send something on the next attempt (and eventually dead-letter to Sentry if render keeps failing). All six `sendXxx` helpers (sendOrderConfirmation, sendNewQuoteCustomer, sendNewQuoteOps, sendQuoteResponse, sendNewVendorOps, sendVendorApproved) rewritten to use `safeRender` and early-return `{ ok: false, error }` on render failure. The render exception no longer escapes `sendXxx` → no longer escapes the webhook → `claimEvent` still applies but the retry chain is now in play.
**Test:** `tests/integration/access/m10-render-throw.test.ts` — uses `vi.unmock('@/lib/email')` to defeat the global mock in `setup.ts`, then `vi.mock('@react-email/render')` to force `render` to throw on order-confirmation, and asserts `sendOrderConfirmation` returns `{ ok: false, error: /render:/ }` instead of re-throwing.

### ID: M10.original
**Severity:** MAJOR
**File:** `src/lib/email.ts` (`sendOrderConfirmation` and siblings)
**Description:** `await render(<Template props />)` happens inside the `sendXxx` helper, BEFORE `send()`'s try/catch. A render-time exception (e.g. a future prop-shape regression) escapes both `send()` and `queueRetry`, propagates up through the Stripe webhook, and returns 500 — but `claimEvent` has already committed.
**Why it matters:** On the next Stripe redelivery `hasEvent` short-circuits and no email is ever sent. Order is paid, customer never gets the confirmation, ops has no signal. Silent feature failure on any future template prop drift.
**Proposed fix:** Wrap the `render(...)` call inside each `sendXxx` helper in its own try/catch that routes to `queueRetry` (or returns `{ ok: false, error }`). Add a tiny render-smoke test per template so prop drift fails CI.

### ID: M11 — ATTEMPTED AND REVERTED (Phase 2); OPEN, scope changed
**Severity:** MINOR (was MAJOR; OQ5 already demoted it because no current code path triggers the fallback)
**File:** `src/payload/collections/Users.ts` and `src/payload/collections/Vendors.ts`
**Phase 2 attempt + reason for revert:** Replaced the `setImmediate` fallback with `await doRevoke()` so the revoke runs synchronously when `after()` throws (no Next request context). The full integration suite immediately broke — 7 tests in `tests/integration/orders/create-order.test.ts` failed with `timeout exceeded when trying to connect`. Diagnosis: awaiting `doRevoke()` from inside Users.afterChange runs `audit()` (which calls `payload.create({collection: 'audit-log'})`) while the OUTER Users transaction is still open. The audit create starts a NEW transaction needing another pool connection; under the suite, the chain back-pressures the pool until `pool.connect()` times out. The original `setImmediate` shape was correct in ordering — it runs AFTER the outer transaction commits and releases its connection. Both files reverted. Test file removed.
**Why the simple "await synchronously" fix can't work as-is:** the revoke needs to happen AFTER the outer transaction commits, not WITHIN its lifetime. Doing the work inside afterChange forces pool overlap. The `setImmediate` queue runs after the await chain unwinds, which is after commit — exactly the right ordering for an in-process Node runtime. Vercel serverless is what breaks `setImmediate` because the function instance may be torn down before the queue drains.
**Proper fix (deferred to a future session — outside Phase 2's "smallest change" scope):**
1. Move the revoke chain to Payload's `afterOperation` collection hook (post-commit), so the synchronous-await happens AFTER the transaction is closed and its connection released. Verify it doesn't break the `req`-carrying happy path.
2. OR: when `after()` throws, enqueue a Payload job (`revokeUserSessions`) rather than calling `setImmediate`. The job runs in its own transaction context cleanly. Adds a small job-type but is durable across instance teardown.
**Status:** OPEN. M11 stays as MINOR per OQ5 — currently unreachable in code (no non-HTTP path calls `payload.update` on Users/Vendors). Becomes real if a future job/CLI ever touches Users.role; revisit then with one of the two proper fixes above. **The Phase 2 attempt is a worked example of "stop if the fix breaks something else."**

### ID: M12 — REOPENED (status: OPEN; was incorrectly closed-by-design — see verdict below)
**Why reopened:** The earlier close-by-design relied on M9's advisory lock fully bracketing the write. The M9 fallback path (no `req.transactionID`) takes `pg_advisory_lock` on a POOLED CLIENT, separate from the Payload-managed transaction connection that actually commits the row. The lock therefore brackets the cap-check READ but does NOT bracket the COMMIT — between cap-check-pass and commit-lands, a second worker can read pre-commit state and also see "cap available". The in-code comment in `src/payload/collections/Refunds.ts:124–127` admits exactly this: "it doesn't strictly bracket the write, but it shrinks the race window dramatically." Per-row `idempotencyKey` (existing) only dedupes retries of the SAME row; concurrent SIBLING rows with distinct references have distinct keys and Stripe processes both. The paid-after-cancel auto-refund path is the canonical no-`req` caller, so the residual window is real and reachable in production.

The transaction-session path (when `req.transactionID` IS set) uses `pg_advisory_xact_lock` on the transaction connection, which IS released at COMMIT — that path is race-free. The remaining exposure is exclusively the no-`req` / fallback path.

**Proposed durable fix (DB-level cap, independent of code path):** Add a `BEFORE INSERT OR UPDATE` trigger on `refunds` that:
1. `SELECT total_minor FROM orders WHERE id = NEW.order_id FOR UPDATE` — acquires a row-level exclusive lock on the order row, serialising ALL refund writes against that order regardless of which client/transaction they originate from (the lock is held until the inserting transaction commits/rolls back).
2. Computes `existing := COALESCE((SELECT SUM(amount_minor) FROM refunds WHERE order_id = NEW.order_id AND status IN ('completed','processing','pending') AND id IS DISTINCT FROM NEW.id), 0)`.
3. `IF existing + NEW.amount_minor > order.total_minor THEN RAISE EXCEPTION 'refund_cap_exceeded order=% existing=% incoming=% total=%' ...`

This is a closed atomic check inside the same transaction as the write, with row-level locking on the order so concurrent inserts queue. It supersedes the application-level cap-check (the app check stays for friendlier error messages; the trigger is the durable backstop the codepath cannot bypass). Belt-and-braces it pairs with the existing per-row `idempotencyKey` on the Stripe call to defend against Stripe-side duplicate-issuance from any future retry shape.

**Why DB-level not application-level:** No reasonable amount of beforeChange/advisory-lock plumbing can both (a) bracket the COMMIT of a Payload-managed transaction when running OUTSIDE that transaction's connection, and (b) survive future Payload internals changes that move when init/commit happens. A trigger sits below the ORM and is the only place the constraint can be enforced atomically with the write itself.

**Migration shape:** new SQL migration `20260603_phase_5_25_refund_cap_trigger.ts` — CREATE FUNCTION + CREATE TRIGGER (BEFORE INSERT OR UPDATE) on `refunds`; down() drops both.

**Test plan when implemented:** under the no-`req` path, fire two concurrent `payload.create({ collection: 'refunds', overrideAccess: true, ... })` whose sum exceeds order total; ASSERT exactly one succeeds and the other rejects with `refund_cap_exceeded`. Without the trigger the test will FAIL (both can succeed under the current race window — the existing app-level cap check passes for both); with the trigger it will pass.

**Status:** OPEN — fix not applied this session. Should ship as part of a Phase 5.25 (or Phase 3 of this audit) once we have appetite for a DB migration and a real-build verification path.

### ID: M12.original
**Severity:** MAJOR
**File:** `src/payload/collections/Refunds.ts:308–367` (auto-issue afterChange)
**Description:** The auto-issue hook calls `issueProcessorRefund` outside the transaction. Two refund rows for the same order, inserted near-simultaneously, both pass the per-row cumulative-cap (each excludes itself from the sum) and both reach the afterChange, which then calls `client.refunds.create` on Stripe twice against the same charge.
**Why it matters:** Cap math is per-row; the cap-lock serialises inserts but releases at commit before the afterChange chain. Stripe will process both refunds up to the charge total. Real-money over-refund window for concurrent admin actions.
**Proposed fix:** Pass `idempotencyKey` to `Stripe.refunds.create` (use the refund row id) — Stripe will dedupe at the API. The drizzle session lock would also help but the idempotency key is the clean fix.

### ID: M13 — FIXED
**Diff:** `src/payload/jobs/sweepAbandonedOrders.ts` — the `complete`-session recovery branch (post `markOrderPaid`) now (1) resolves the recipient email via the order/customer relation, (2) builds the itemized email props (orderNumber, currency, total, lines, shipping) from the recovered order, (3) calls `sendOrderConfirmation`, and (4) `claimEvent`s a synthetic event id `sweeper:<sessionId>` against the same `events` ledger Stripe's `claimEvent` uses, so a delayed real `checkout.session.completed` redelivery is short-circuited by `hasEvent` and the customer is NOT double-emailed.
**Test:** `tests/integration/access/m13-sweeper-recovery-email.test.ts` — drives the sweeper against a `pending_payment` order whose Stripe session was completed via mock, verifies (a) `markOrderPaid` ran (b) the synthetic event id was claimed (c) the email send pathway was invoked.

### ID: M13.original
**Severity:** MAJOR
**File:** `src/payload/jobs/sweepAbandonedOrders.ts:160–180` (webhook-miss recovery)
**Description:** When the sweeper finalises an order via `markOrderPaid` because the Stripe session is `complete` but the webhook never arrived, it does NOT send the order confirmation email and does NOT claim a synthetic event so a delayed real webhook can email idempotently.
**Why it matters:** Customer pays, sweeper recovers the order to `paid`, customer never receives confirmation. Until/unless Stripe redelivers the original webhook (which may have aged out beyond 72h), the customer has no proof of order. Feature silently fails on every webhook-miss recovery.
**Proposed fix:** After `markOrderPaid` in the sweeper, call `sendOrderConfirmation` with `resolveOrderEmail(order)` and `claimEvent` against a synthetic key (e.g. `sweeper:<sessionId>`) so a later real webhook short-circuits.

### ID: M14 — FIXED
**Diff:** `src/app/layout.tsx` — removed the `icons` metadata block that referenced two assets missing under `public/`. Next's file-based icons convention will pick up `src/app/icon.png` / `public/favicon.ico` automatically when they're added.
**Test:** `tests/integration/access/m14-no-favicon-404.test.ts` — scans the metadata block for any `/`-prefixed icon/image path and asserts the file exists under `public/`.

### ID: M14.original
**Severity:** MAJOR
**File:** `src/app/layout.tsx:54–57` + `public/`
**Description:** Root metadata declares `icons.icon = '/favicon.ico'` and `icons.apple = '/apple-touch-icon.png'`, but neither file exists under `public/`.
**Why it matters:** Every page request 404s the favicon and (on iOS) the apple-touch-icon. Log noise; broken tab favicon on every browser; broken Add-to-Home-Screen icon. Easily observed.
**Proposed fix:** Either ship the assets to `public/` or remove the explicit `icons` block and use the file-based `src/app/icon.png` / `src/app/apple-icon.png` conventions Next supports.

### ID: M15 — FIXED
**Diff:** `src/app/not-found.tsx` — now async; awaits `readCart()` + `getCurrentUser()` and passes real `cartCount` / `isSignedIn` to `<SiteHeader/>`.
**Test:** `tests/integration/access/m15-not-found.test.ts` — static-source check that the component reads cart + user and passes computed props (not hard-coded zeros).

### ID: M15.original
**Severity:** MAJOR
**File:** `src/app/not-found.tsx:7–28`
**Description:** Root `NotFound` renders `<SiteHeader cartCount={0} isSignedIn={false} />` with hard-coded zeros — it does not `await readCart()` or `await getCurrentUser()`.
**Why it matters:** A user who mistypes any URL sees a header that forgets their cart count and their signed-in state. Looks like a session/cart loss; real customers will re-add or re-login. Trivially reproducible on every 404.
**Proposed fix:** Make `NotFound` async, await `readCart()` and `getCurrentUser()`, and pass through (mirrors the marketing layout).

### ID: M16 — FIXED
**Diff:** `src/app/(staff)/admin-reports/page.tsx` — renders a "Data truncated" banner above the stats grid when `report.truncated` is true.
**Test:** `tests/integration/access/m16-truncated-banner.test.ts` — static-source check that the page references `report.truncated` and the banner text.

### ID: M16.original
**Severity:** MAJOR
**File:** `src/app/(staff)/admin-reports/page.tsx` (consumer) / `src/lib/queries/admin-reports.ts:253–259`
**Description:** `getAdminReport` returns `truncated: boolean` set when any of its 4 `limit: 1000` queries hit the cap; the admin page does not render this flag anywhere.
**Why it matters:** An admin past 1000 orders/payouts/refunds sees a dashboard that silently under-reports lifetime GMV, outstanding payouts and refund totals, with no warning. The data layer detects it; the UI swallows it. Defeats the purpose of round-4 J5.
**Proposed fix:** Render a small "Data truncated — figures are partial" banner above the stats grid when `report.truncated` is true.

---

## MINOR (28)

### ID: m1
**Severity:** MINOR
**File:** `src/lib/orders.ts:594–706` (paid-after-cancel auto-refund reference)
**Description:** Auto-refund reference is `auto_${processor}_${(processorIntentRef ?? processorRef).slice(0, 24)}`; two distinct Stripe events for the same paid-after-cancel order (e.g. retry with rotated event_id) could collide on the unique-reference constraint, throw, and trigger an infinite webhook retry loop.
**Why it matters:** Edge case requiring two distinct event ids on the same order both hitting the cancelled branch. The Refunds beforeChange cap catches over-refund commit; the throw on the unique-violation re-throws into the webhook. Narrow but real.
**Proposed fix:** Pre-check `payload.find({ collection: 'refunds', where: { reference: { equals: ref } } })`; if exists treat as success.

### ID: m2
**Severity:** MINOR
**File:** `src/payload/collections/Refunds.ts:308–325`
**Description:** Manual-processor refunds parked in `processing` indefinitely have no stale-refund sweep / SLA timer.
**Why it matters:** Ops process gap; not "wrong behaviour", just no visibility on stuck rows. Documented as intentional ("manual refunds need bank-transfer confirmation").
**Proposed fix:** Scheduled job (sibling of `sweepAbandonedOrders`) that Sentry-warns on `processing` manual refunds older than ~7 days.

### ID: m3
**Severity:** MINOR
**File:** `src/lib/orders.ts:734–763` (cancelOrderAndReleaseInventory)
**Description:** Final audit `order.status_changed` is emitted unconditionally even when the inventory-release loop hit its 10s deadline and audited an `inventory.revert_failed`. The status audit doesn't reflect the partial-release reality.
**Why it matters:** Observability gap; both audits are present but operators have to correlate them.
**Proposed fix:** Include `releasedProductIds.length` vs `lineItemsToRelease.length` in the final audit `notes`.

### ID: m4
**Severity:** MINOR
**File:** `src/lib/payouts.ts:111–145`
**Description:** Existing-payouts query uses `limit: 1000` and aborts with "contact engineering" once a vendor accumulates more than 1000 lifetime payouts.
**Why it matters:** Hard ceiling reached only on per-order or daily payout cadences; with monthly it's ~83 years. Not breaking today.
**Proposed fix:** Cursor-paginate the existing-payouts query and accumulate `coveredOrderIds` across pages.

### ID: m5
**Severity:** MINOR
**File:** `src/lib/payouts.ts:255–258` (and `admin-reports.ts:179`)
**Description:** Multi-vendor pro-rata refund allocation rounds each vendor share independently; the sum can drift by up to N-1 minor units (cents) from `goodsRefund`.
**Why it matters:** Sub-cent drift per refund; accumulates but is small. Internal dashboards agree with the statement generator, just slightly off "true" total.
**Proposed fix:** Allocate the last vendor as `goodsRefund - sum(others)` so rounding remainder lands consistently.

### ID: m6
**Severity:** MINOR
**File:** `src/lib/orders.ts:435–456` (markOrderPaid orderId parameter)
**Description:** Signature accepts `string | number`; raw SQL interpolation passes through. Today's callers all pass numeric ids.
**Why it matters:** Defense-in-depth — if a future caller passes an orderNumber by accident, Postgres errors and the webhook 500s.
**Proposed fix:** Top of function: `const id = requireId(orderId)` then pass `id` to all queries.

### ID: m7
**Severity:** MINOR
**File:** `src/lib/payments/manual.ts:25`
**Description:** Manual `processorRef` is `manual_${orderNumber}` — deterministic and not unique across reissue.
**Why it matters:** Cosmetic; orderNumber regen is already collision-resistant via nanoid(6).
**Proposed fix:** Append a short nanoid: `manual_${orderNumber}_${nanoid(8)}`.

### ID: m8
**Severity:** MINOR
**File:** `src/lib/orders.ts:206` (cart action also defaults the same)
**Description:** Default shipping `weightGrams = 500` per item when a product hasn't set it.
**Why it matters:** A vendor publishing without entering weight ships at the lightest tier, under-charging on heavy goods. Caught at data-entry today (admin UX prompts weight), so it's a fail-safe default, not a normal-use bug.
**Proposed fix:** Make `Products.shipping.weightGrams` required at the schema level (with a backfill migration).

### ID: m9
**Severity:** MINOR
**File:** `src/lib/quotes.ts:326`
**Description:** Quote-converted orders are written with `totalMinor: subtotalMinor` (no shipping, no tax).
**Why it matters:** Documented B2B convention — vendor bills shipping separately or bakes it into `unitPriceQuoteMinor`. No UI signal of the convention.
**Proposed fix:** Add a comment on the field + surface "Shipping included in line prices (B2B quote)" on the order page.

### ID: m10
**Severity:** MINOR
**File:** `src/lib/orders.ts:485–521` (happy-path tax reconcile inside markOrderPaid)
**Description:** Conditional UPDATE to status is raw SQL gated on `status='pending_payment'`; the follow-up `payload.update({ totalMinor, taxMinor })` is unconditional.
**Why it matters:** A concurrent admin flipping status while the reconcile is in flight could allow totals to be written onto a non-paid row. Window is narrow; today only the webhook + sweeper call this branch.
**Proposed fix:** Use a conditional raw-SQL `UPDATE ... WHERE status='paid'` for the reconcile, matching the status-flip pattern.

### ID: m11
**Severity:** MINOR
**File:** `src/lib/orders.ts:564–705` (priorRefunds find limit 50)
**Description:** Paid-after-cancel dedupe uses `limit: 50` on prior refunds; > 50 chunked refunds make the sum under-count.
**Why it matters:** Edge case; > 50 partial refunds per order is extremely rare.
**Proposed fix:** Replace the loop with a single `SUM(amount_minor)` raw query.

### ID: m12
**Severity:** MINOR
**File:** `src/payload/collections/Refunds.ts:447–486` (clawback overlap check)
**Description:** Refund afterChange runs the payout-overlap SQL on a separate pool connection while the refund's transaction is still open. Under refund-burst concurrency with pool max=10 the second connection per refund pressures the pool.
**Why it matters:** Pool pressure, not exhaustion — but real under burst.
**Proposed fix:** Move the overlap check into an `after()` callback that runs after commit; the alert is Sentry-level, not transactional.

### ID: m13
**Severity:** MINOR
**File:** `src/lib/email.ts` and `src/payload/jobs/retryFailedEmails.ts`
**Description:** R11 added `clearTimeout` on the Promise.race, but the Resend SDK has no `AbortSignal` wired — when the 8s timer fires, the pending `client.emails.send` socket continues to hold a HTTP slot until Resend itself times out.
**Why it matters:** Slow socket leak during a Resend outage. Not user-facing today; turns a soft outage into a hard one.
**Proposed fix:** Use `AbortController` on whatever fetch backend Resend exposes, or fall back to direct fetch with `signal: AbortSignal.timeout(8000)`.

### ID: m14
**Severity:** MINOR
**File:** `src/lib/rate-limit.ts:139–147`
**Description:** `consume` (non-strict) silently falls back from Upstash to in-memory when Upstash returns null/error. No metric or alert is emitted.
**Why it matters:** Observability gap — rate limits weaken silently during Upstash incidents.
**Proposed fix:** Sentry.captureMessage at most once/minute (use the local bucket itself to dedupe).

### ID: m15
**Severity:** MINOR
**File:** `src/payload/jobs/index.ts:31–35`
**Description:** Cron runner auth compares the Bearer token with `===` rather than constant-time compare.
**Why it matters:** Theoretical timing side channel on a 32+ char secret.
**Proposed fix:** Use `timingSafeEqual` after a length check.

### ID: m16
**Severity:** MINOR
**File:** `src/payload/jobs/sweepAbandonedOrders.ts:44–62`
**Description:** Overlap-guard advisory lock is session-scoped and held across the full batch; a connection drop mid-batch releases the lock to the next cron tick while the original handler is still running.
**Why it matters:** Edge resilience gap.
**Proposed fix:** Cap the per-tick batch + iteration count; or periodically refresh the lock.

### ID: m17
**Severity:** MINOR
**File:** `src/payload.config.ts:77–123`
**Description:** Prod env hard-fail list omits `FLUTTERWAVE_SECRET_KEY` and `FLUTTERWAVE_WEBHOOK_SECRET` (Stripe variants are validated).
**Why it matters:** A prod deploy without Flutterwave keys silently drops Flutterwave as a payment option; inconsistent with the Stripe policy.
**Proposed fix:** Add both to the list, or document explicitly that Flutterwave is optional.

### ID: m18
**Severity:** MINOR
**File:** `src/app/(payload)/api/health/route.ts:84–97`
**Description:** Unauthenticated `/api/health` returns `uptime`, `version`, `checks.db.latencyMs`, and the email dead-letter count.
**Why it matters:** Mild fingerprinting/reconnaissance signal.
**Proposed fix:** Gate the detail behind `X-Health-Key`, or strip latency + dead-letter count from the unauthenticated response.

### ID: m19
**Severity:** MINOR
**File:** `src/app/(payload)/api/admin/payouts/export.csv/route.ts:38–45`
**Description:** GET handler reads `status` and `vendorId` from query, fed to `payload.find` with no Zod gate.
**Why it matters:** Admin-only endpoint; Payload parameterises the SQL so no injection. A malformed value (e.g. non-numeric `vendorId`) causes an unhelpful 500.
**Proposed fix:** Zod-validate both before composing the `where`.

### ID: m20
**Severity:** MINOR
**File:** `src/lib/auth-actions.ts:191`, `Users.ts:115`, `Vendors.ts:123`, `auth-actions.ts:243` (4 sites)
**Description:** Four call sites repeat `DELETE FROM users_sessions WHERE _parent_id = $1` against the raw pool.
**Why it matters:** Each is parameterised today; code quality / consistency. A typo in a future hook could land an injection.
**Proposed fix:** Extract `revokeUserSessions(payload, userId)` shared helper.

### ID: m21
**Severity:** MINOR
**File:** `src/lib/checkout-actions.ts:338` (redirect after startCheckout)
**Description:** `redirect(redirectTarget)` uses the value returned from the processor's `startCheckout().redirectUrl` without validating the host against an allow-list.
**Why it matters:** Trusted source under TLS; theoretical SDK-response tamper.
**Proposed fix:** Validate `new URL(redirectTarget).host` against `checkout.stripe.com` / `*.flutterwave.com`.

### ID: m22
**Severity:** MINOR
**File:** `src/components/shop/pagination.tsx:33–47`
**Description:** Renders one `<Link>` per page (no truncation/ellipsis).
**Why it matters:** With PAGE_SIZE=12 and a thousand products this is 84 anchors — Next 15 prefetches them on hover/intersection.
**Proposed fix:** Window to current ±2 plus first/last with ellipsis.

### ID: m23
**Severity:** MINOR
**File:** `src/app/(marketing)/shop/page.tsx:26–36`
**Description:** `?page=` not clamped to `totalPages`; `?page=99999` returns the empty-state instead of 404 or redirect to page 1.
**Why it matters:** Soft-404 SEO surface.
**Proposed fix:** After `listProducts`, if `page > totalPages && totalDocs > 0` return `notFound()` or redirect to `?page=1`.

### ID: m24
**Severity:** MINOR
**File:** `src/components/checkout/shipping-picker.tsx:86`
**Description:** `document.querySelector('form')` selects the first form on the page.
**Why it matters:** Works today; fragile if a future header form is added above checkout.
**Proposed fix:** Pass a ref to the surrounding `<form>` or use `event.currentTarget.form`.

### ID: m25
**Severity:** MINOR
**File:** `src/app/sitemap.ts:21–26`
**Description:** Every URL emits `lastModified: now`.
**Why it matters:** Tells Googlebot every URL changes simultaneously every poll — signal becomes noise, crawl-priority on real changes is lost.
**Proposed fix:** Return `updatedAt` per row from the underlying query helpers and emit `new Date(doc.updatedAt)`.

### ID: m26
**Severity:** MINOR
**File:** `src/components/site/site-header.tsx` (and `public/logo.png`)
**Description:** The header (logo + nav + cart) is marked `'use client'` for a scroll-pixel state and mobile-menu toggle; `public/logo.png` is 1.45 MB and rendered at 48×48 with `priority`.
**Why it matters:** Bundle/hydration cost across every marketing page; LCP regression on cold cache mobile.
**Proposed fix:** Compress/resize the logo to a small SVG or ≤30KB PNG; extract just the scroll listener + mobile toggle into a client island and keep the rest server-rendered.

### ID: m27
**Severity:** MINOR
**File:** `src/app/layout.tsx:39–52` (and product page metadata)
**Description:** OG defines `siteName`/`url` but no default `images`; Twitter card declared `summary_large_image` with no `images` field.
**Why it matters:** Social shares (LinkedIn/Slack/WhatsApp/Twitter) on home/shop/vendors render without preview images.
**Proposed fix:** Add a default 1200×630 OG image and matching Twitter `images`.

### ID: m28
**Severity:** MINOR
**File:** `src/app/(payload)/api/graphql-playground/route.ts:11–15`
**Description:** Production gate returns 404 from the GET handler, but the playground module is still imported and bundled into the prod serverless function.
**Why it matters:** ~150KB of GraphiQL UI in prod cold-start.
**Proposed fix:** Dynamic-import the playground inside the non-prod branch.

---

## OPEN QUESTIONS — RESOLVED IN PHASE 2 PREP

### OQ1 (C1 sweeper filter) — **FALSE POSITIVE**
Evidence: `node_modules/@payloadcms/drizzle/dist/queries/parseParams.js` line ~?? — the adapter explicitly emits `or(isNull(col), ne(col, value))` for `not_equals` against a non-null value, so NULL rows ARE included. Confirmed empirically by `tests/integration/probes/oq1-not-equals-null.test.ts` (passed). **C1 is not a bug.** No fix needed.

### OQ2 (M3 / M9 req.context propagation) — **CONFIRMED**
Evidence: `node_modules/payload/dist/utilities/createLocalReq.js` line 86 — `req.context = getRequestContext(req, context)` MERGES context when a `req` is passed to a nested operation. Caveat: the auto-issue hook currently does NOT pass `req` to its inner `payload.update`, so context doesn't reach the inner beforeChange today. The M3 fix needs the hook to (a) set `req.context.systemRefundUpdate = true` and (b) explicitly pass `req` to the inner update.

### OQ3 (M4 Order.confirmationToken readers) — **CONFIRMED, SAFE TO LOCK ADMIN-ONLY**
Evidence: grep across `src/**`. Only readers are: (i) `src/app/(marketing)/orders/[orderNumber]/page.tsx:75-76` which reads via `findOrderByNumber` with `overrideAccess: true` (field-level access doesn't gate it), and (ii) `src/lib/checkout-actions.ts:179` which reads on the freshly-returned create result on the same request. No vendor surface depends on the token.

### OQ4 (M8 direct Products consumers) — **CONFIRMED for the REST surface**
Evidence: all internal Products reads route through `listProducts`/`getProductBySlug`/`getProductsByIds`/`listRelatedProducts`/`listProductSlugs` (which all already filter `vendor.status: 'active'`). But Payload's auto-exposed `/api/products` REST endpoint is still subject to the collection's `access.read`, which only filters `status: 'published'`. Defense-in-depth gap on the REST surface; today's storefront doesn't suffer it. Severity holds (MAJOR for the REST surface).

### OQ5 (M11 after() fallback) — **DEMOTED TO MINOR**
Evidence: grep finds NO non-HTTP path that calls `payload.update` on Users or Vendors. The `after()` → `setImmediate` fallback is documented but currently unreachable. If a future CLI/job touches Users.role, it becomes real. Reclassified as MINOR.

### OQ6 (M12 Stripe idempotencyKey) — **PARTIALLY ADDRESSED**
Evidence: `node_modules/stripe/types/RefundsResource.d.ts:133-134` — `RequestOptions` second-arg supports `idempotencyKey`. Already wired in `src/lib/payments/refund.ts:99` as `bangarah_refund_${refund.reference}` (per-row key, prevents same-row network retries from double-refunding). Does NOT dedupe SIBLING refund rows (different references = different keys). M12 stays MAJOR; the fix is either an in-afterChange cap re-check or a shared per-order idempotency key.

---

## UPDATED COUNT BY SEVERITY

- **CRITICAL: 0** (C1 was the only one; verified false positive)
- **MAJOR: 15** (M11 demoted)
- **MINOR: 29** (M11 added)
- False positives: 1 (C1)

## PHASE 2 PROGRESS (MAJORs)

- **CODE-VERIFIED (tests + lint + tsc + subsequent-deploy build) for 14, NOT YET cold-deploy-build-verified:** M1, M2, M3, M4, M5, M6, M7, M8, M9, M10, M13, M14, M15, M16.
- **REOPENED (1):** M12 — earlier close-by-design was incorrect (M9's no-`req` fallback doesn't bracket the COMMIT). Now OPEN with a DB-trigger proposal as the durable cross-codepath fix. Will be scheduled deliberately; NOT applied speculatively this session.
- **DEMOTED IN PREP (1):** M11 (moved to MINOR)
- **Verification status:**
  - Full integration suite: **147/147 passing** across 45 files (updated at Phase 2 close-out; was 133/133 before the minors batch).
  - Lint: **clean**.
  - `tsc --noEmit`: **clean**.
  - `npm run build` against an already-migrated DB ("subsequent deploy"): **passes** (exit 0; 22/22 static pages generated — updated at close-out; was 20/20 before m27 added the two OG image routes). The B4 Sentry warning is FIXED (see close-out); remaining warnings (Upstash edge-runtime notice, webpack cache big-strings) are pre-existing and cosmetic.
  - `npm run build` from a genuinely empty DB ("cold deploy"): **NOT PROVEN — empirically confirmed to FAIL.** B1 (broken runtime-migrate + worker race) and B2 (CLI broken on every Node version) are both confirmed reproducible; both require architectural work that is outside Phase 2's audit/fix mandate.
- **Why the gate is unmet:** the passing "subsequent deploy" build above used the existing schema-pushed test DB with `payload_migrations` hand-populated to mark all six migrations as already-run. That is the state every existing operator's DB is in today, but it is NOT the state a fresh-DB cold deploy lands in. The cold-deploy path (`createdb` → either pre-build migrate or build-time auto-migrate → `next build`) is broken in two coupled ways documented as B1 + B2 below. Phase 2 attempted fixes for both; neither closes cleanly without a deliberate architectural decision (pre-build migrate step + tooling rework).
- **Honest framing for the MAJORs:** the 14 fixes are correct, tested, lint/tsc-clean, and the build passes against any operational DB. They do NOT regress the cold-deploy path — they neither cause nor fix B1/B2, which both pre-existed Phase 2 and are surfaced for the first time in this audit. Marking them FIXED in code terms is honest; marking them "deploy-verified" requires closing B1/B2 first.
- **Recommended next step:** treat B1+B2 as their own work package (estimated: half-day to one day of focused tooling work, plus an architectural decision about pre-build vs runtime migrate). Phase 2's per-MAJOR fixes don't need to wait for that.

## DEPLOYMENT READINESS — SEPARATE WORK PACKAGE

The findings below were surfaced by Phase 2's attempt to verify the MAJORs against a clean from-empty build. **B5 (no migrate step in any pipeline) and B2 (`payload migrate` CLI broken on every supported Node version) are one coupled deployment work package, not Phase 2 fixes.** B2 blocks B5's fix (you can't wire up a pre-deploy migrate step until the CLI runs). B1 is downgraded to INFO as a symptom of B5. B3 is informational. B4 is folded into the Phase 2 MINOR grouping below.

**Entry point: B5.** Start by running the production `payload_migrations` query (see B5 caveat) to confirm or refute the inference. Then choose a runner (Vercel `buildCommand` vs CI release step), fix B2 in service of that choice, wire the step, prove cold deploy works against a genuinely empty DB. Treat as a focused half-day-to-one-day session separate from this audit.

**Build-hang diagnosis (Phase 2 close-out, 2026-06-03) — inherit this:** every "hung build" observed during Phase 2 (three occurrences) was the SAME root cause: when `payload_migrations` contains the dev-mode sentinel row (`name='dev', batch=-1` — re-inserted by any schema-push test run) and `PAYLOAD_DISABLE_SCHEMA_PUSH=true`, Payload's migrate-on-init path stops at an **interactive y/N prompt** ("you've run Payload in dev mode… data loss will occur. Proceed?") inside the non-TTY `next build` worker, which waits forever. It was never a dead network endpoint. Fix for the deploy work package: the pre-build migrate step must run against a DB without the dev sentinel (or assert its absence and fail loudly); locally, `DELETE FROM payload_migrations WHERE name='dev' AND batch=-1` before any build that follows a test-suite run.

Phase 2 is not touching deploy tooling further. The findings below are recorded so the deployment work package has a starting point.

## PHASE 2 BUILD FINDINGS (surfaced by attempting a clean build)

### B5 — There is no migration step in any deploy pipeline (the load-bearing finding)
**Severity:** MAJOR (deployment-readiness — supersedes the B1 architectural framing)
**Pipeline audit (2026-06-03), all evidence from the repo:**

- **`vercel.json`** — defines crons + per-route `maxDuration` only. No `buildCommand`, no `installCommand`, no pre/post-build hook. Vercel uses its defaults: `npm install` + `npm run build`. No invocation of `db:migrate`.
- **`Dockerfile`** — none present (confirmed by `ls`).
- **`.github/workflows/ci.yml`** — three jobs (quality, integration, e2e, lighthouse) all on Node 20. None calls `db:migrate`. The integration job's only DB-bootstrap step is `npm run test:integration:setup-db`, which `DROP DATABASE … _test; CREATE DATABASE … _test` and then lets vitest's first call to `getPayload()` push the schema. That is dev-mode schema push, not migrations.
- **`package.json` scripts** — no `prebuild`, `postbuild`, `postinstall`, `release`, `deploy`, or any chain that invokes `db:migrate`. The three `db:migrate*` scripts exist but nothing calls them.
- **`OPS.md`** — single reference to migrations, in the "rolling back a deploy" runbook (`npm run db:migrate -- down`). No forward-migration runbook.
- **`README.md`** — local dev section says `npm run dev`; no production migrate instructions.
- **`ROADMAP.md` line 130** — checkbox `[x] Real Postgres migrations — db:migrate, db:migrate:create, db:migrate:status npm scripts; PAYLOAD_DISABLE_SCHEMA_PUSH=true for production deploys; migrations registry at src/payload/migrations/index.ts.` This describes the *existence* of scripts and a registry — NOT a wired-up deploy step.
- **`.env.example` lines 103–106** — `# CI/CD must run `npm run db:migrate` before serving traffic.` This comment **describes a process that doesn't exist anywhere in the repo's pipeline.** The default in the same file is `PAYLOAD_DISABLE_SCHEMA_PUSH=false` (i.e. schema-push on, "dev mode").

**What's actually happening on every deploy today:** the prod DB has its schema from a `next dev` schema-push at some point in its history (probably the very first deploy, when `PAYLOAD_DISABLE_SCHEMA_PUSH` wasn't yet `true`, or from a hand-run dev session against the prod DB). Subsequent deploys see an already-populated `payload_migrations` table containing `name='dev', batch=-1` — Payload's sentinel for "dev-mode push happened here" — and either prompt for migration (in interactive contexts) or fail at boot. The migrations registry has never materialised a single schema object in production. The Phase 5.20 baseline + Phase 5.11 / 5.16 / 5.18 / 5.23 / 5.24 ALTER migrations are dead code in deploy terms.

**Why this is the load-bearing finding, not B1:** the user is correct — a cold deploy migrates ONCE, single-process, via `payload migrate` BEFORE `next build`. That pattern doesn't have B1's worker race because there are no workers; the CLI creates `payload_migrations` first and runs migrations serially. **B1's "workers race on DDL" failure is a symptom of migrating the wrong way — by letting parallel `next build` workers each call `getPayload()`.** That only happens because no pre-build migrate step exists. Fix this finding (wire up a pre-build migrate step), and B1 dissolves.

**Latent risk:** the project has never been cold-deployed in its claimed "production" mode. Any fresh prod environment (DR rebuild, new region, staging refresh, dev→prod cutover) will fail — at minimum because no automated step applies the schema, at worst because nobody has tested whether the baseline can actually be applied successfully to an empty DB without the schema-push fallback.

**Caveat — this is inferred from the repo, not confirmed against prod.** Confirming check: query the actual production `payload_migrations` table. If it contains only `(name='dev', batch=-1)` and none of the six real migration names (`00000000_baseline`, `20260521_phase_5_11`, `20260521_phase_5_16_user_sessions`, `20260526_phase_5_18_indexes_and_constraints`, `20260601_phase_5_23_audit_kind_payout`, `20260603_phase_5_24_audit_kind_user_deleted`), B5 is proven. If it contains some or all of the real names, somebody ran `db:migrate` against prod manually at least once and the inference is partly wrong; revisit accordingly. To be run by the user against prod — not attempted from this session.

**Proposed fix (gated on B2 first):**
1. Close B2 so `npm run db:migrate` actually runs.
2. Add a pre-deploy migrate step. Pick one:
   - **Vercel** — `vercel.json` `"buildCommand": "npm run db:migrate && npm run build"`. Migrate runs once on the build machine before `next build`.
   - **CI** — add a step in `.github/workflows/ci.yml` (and any pre-prod deploy workflow) that runs `npm run db:migrate` against the target DB before promoting.
   - **Docker** — N/A here (no Dockerfile).
3. Test the cold deploy: provision a genuinely empty DB, run the new migrate step, run `next build`, verify schema is correctly materialised and the build passes. Document the runbook in OPS.md.
4. Flip `.env.example` default to `PAYLOAD_DISABLE_SCHEMA_PUSH=true` so new operators don't accidentally re-enable dev-mode push against prod (and so the comment "CI/CD must run db:migrate" actually matches the reality once #2 is in place).
5. Add a CI smoke test that catches regressions: provision a fresh `_cold` test DB in CI, run `db:migrate`, then `next build`, then teardown. If this passes once, the project is genuinely cold-deployable; if it breaks in a future change, CI flags it before prod.

**Status:** OPEN. The load-bearing pipeline finding. Not closing in Phase 2.

### B1 — (downgraded) Build-worker DDL race is a SYMPTOM of B5, not a standalone bug
**Severity:** INFO (was MAJOR — reclassified after B5 analysis)
**Why downgraded:** B1 only reproduces when `next build` itself triggers migrations through build-time `getPayload()` calls. That code path is the WRONG migration path; the correct path is a single-process `payload migrate` BEFORE `next build`. Once B5 is closed (pre-deploy migrate step wired up), the build sees an already-migrated DB and never triggers the runtime migrator concurrently. The "two coupled root causes" framing in my prior write-up confused the symptom with the disease — the underlying disease is B5 (no migrate step in the pipeline), and the parallel-worker DDL collisions only manifest because we forced migration into a parallel-by-design context. Keeping this entry as INFO so the empirical reproduction is recorded for future debugging, but it's not a fix target on its own.

**Original empirical observation (kept for the record):**
**Severity:** MAJOR (deployment-readiness)
**Reproduced empirically (2026-06-03) on Node 22 LTS, fresh `createdb bangarah_cold_deploy` + `next build`:**

**Cause 1 — Payload's runtime migrator does not bootstrap `payload_migrations`.** When `getPayload()` is called from a build-time route module (`src/app/sitemap.ts`, `src/app/(marketing)/products/[slug]/page.tsx` `generateStaticParams`, etc.) against an empty DB with `PAYLOAD_DISABLE_SCHEMA_PUSH=true`, Payload's runner calls each migration's `up()` and then attempts `INSERT INTO public.payload_migrations (id, name, batch, updated_at, created_at) VALUES (...)` to record completion. The tracking table doesn't exist; the INSERT fails with `relation "payload_migrations" does not exist`; the surrounding transaction (which contains all of `BASELINE_SQL`) rolls back; the DB returns to empty; the build aborts.

This is unrecoverable without intervention: each subsequent build worker hits the same failure and rolls back. The runner clearly expects the operator to run `payload migrate` CLI first (which DOES create `payload_migrations` before any migrations run) — but that CLI is broken by B2 below on every Node version this project nominally supports.

**Cause 2 — Concurrent build workers race on schema DDL.** Next.js's build phase spawns multiple worker processes that each call `getPayload()` in parallel from different routes. All workers race to run migrations. Even with `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` / `CREATE EXTENSION IF NOT EXISTS`, Postgres's catalog-level uniqueness (`pg_class_relname_nsp_index`, `pg_extension_name_index`) does NOT serialise concurrent CREATE statements — the IF-NOT-EXISTS check and the catalog insert are not atomic under concurrent transactions. Even the "downstream" non-baseline migrations (e.g. `20260521_phase_5_11` doing `CREATE EXTENSION IF NOT EXISTS pgcrypto`) hit `duplicate key value violates unique constraint "pg_extension_name_index"`.

**Why it matters:** Any greenfield deploy or DR rebuild from scratch fails. Today this is hidden because every DB in use already has `payload_migrations` populated from prior dev-mode work (the test DB had `name='dev', batch=-1` until I replaced it with the six real migration names to get the "subsequent deploy" build to pass).

**Attempted Phase 2 fixes that DID NOT close it:**
- Adding `CREATE TABLE IF NOT EXISTS public.payload_migrations` + indexes inside the baseline `up()`: closed Cause 1 in isolation, but the index creation collided with concurrent build workers (`pg_class_relname_nsp_index`).
- Adding `pg_advisory_lock(hashtext('bangarah-baseline-migration'))` around the baseline body: serialised the baseline, but did NOT serialise the second migration's `CREATE EXTENSION pgcrypto` which still raced. Lock-per-migration is invasive and brittle.

**Proposed fixes (any one closes B1; together they're durable):**
1. **Pre-build migrate (architectural — recommended).** Make cold deploys run `payload migrate` (or equivalent) as a pre-deploy step BEFORE `next build`. The build then sees a fully-migrated DB and never auto-migrates concurrently. Requires fixing B2 (the CLI) first.
2. **Single-worker build.** Force `next build` to use one worker (`experimental.workerThreads = false` / env override) so there's no race. Slower builds; doesn't fix the underlying broken runtime-migrate, just hides it.
3. **Hoist a single advisory lock around the entire migration sequence.** Patch Payload's runner or wrap it locally. Invasive.
4. **Ship `00000000_init_tracking` migration that creates `payload_migrations` only**, and combine with #1 (pre-build migrate). Closes Cause 1 cleanly; Cause 2 stays closed because the migrate step is no longer concurrent.

**Status:** OPEN. Requires architectural decision. Not closing in Phase 2.

### B2 — `payload migrate` CLI is broken on every supported Node version
**Severity:** MAJOR (operational — blocks the only documented mechanism for running migrations out-of-band)
**Reproduced empirically on Node 20.20.2 LTS, Node 22.22.3 LTS, and Node 25.9.0:**

- **Node 20.20.2 LTS:** `undici@7.24.4`'s `CacheStorage` constructor crashes ("Illegal constructor") under tsx's CJS interop. Payload pulls undici 7 transitively; undici 7 has Node 20.x runtime regressions on `webidl.illegalConstructor`.
- **Node 22.22.3 LTS:** `ERR_UNSUPPORTED_DIR_IMPORT: Directory import '/.../src/payload/migrations' ...`. Node 22+ strict ESM rejects bare directory imports; Payload's bin uses `tsx/esm/api.tsImport` which loads ONE module but does NOT register tsx as a global ESM loader, so transitive imports of `payload.config.ts` fall back to Node's strict resolver and fail on every extension-less specifier.
- **Node 25.9.0:** Same as Node 22.

**Workarounds attempted that DID NOT work:**
- `import { migrations } from './payload/migrations/index.ts'` (explicit `.ts`): closes the first `ERR_UNSUPPORTED_DIR_IMPORT` but every transitive bare import (`./payload/collections/AuditLog`, `./lib/graphql/depth-limit`, etc.) hits the same wall. The dependency tree is too wide.
- `NODE_OPTIONS=--import=tsx/esm` to globally register tsx: changes the failure to a different `loadEnvConfig` destructure-of-undefined deep in Payload's `loadEnv.js` due to CJS/ESM double-loader interop.
- `payload --use-swc migrate`: `@swc-node/register` not installed; falls back to the original failure.
- A separate `scripts/migrate.ts` invoked via project-local `tsx` that calls `payload.db.migrate()` programmatically: same `loadEnvConfig` failure (Payload's `loadEnv.js` is required transitively).

**Vercel runtime:** `package.json` has `engines.node: ">=20.9.0"`. With no explicit pin Vercel currently defaults to Node 22.x. That means **B2 affects production cold deploys**, not just local tooling — if any cold-deploy operator runs `npm run db:migrate` against the prod DB, it fails.

**`.nvmrc` adjustment this session:** pinned to `20` per the user's option-1 selection. This documents the supported runtime floor but does NOT actually make B2 go away on any version of Node — Node 20 fails on undici 7, Node 22+ fails on tsx loader registration.

**Proposed fixes:**
1. **Replace Payload's bin tsImport path with a global tsx registration in a project-local wrapper.** Smallest delta: wrap the migrate invocation in `node --import tsx/esm node_modules/payload/dist/bin/index.js migrate`, debug the resulting CJS/ESM interop separately. Brittle.
2. **Write a dedicated programmatic migrate runner that does NOT load `payload.config.ts` via the full Payload bin path.** A minimal config + `db:migrate` script that talks to drizzle directly using `migrations/index.ts`. Loses Payload-specific migration-runner semantics (batch tracking the way Payload expects) — viable but requires careful re-implementation.
3. **Upgrade `payload`, `@payloadcms/db-postgres`, `tsx`, `undici` together to a known-good combination.** Risky for an audit — semver-major surface drift.
4. **Wait for upstream Payload to fix the tsImport global-registration issue.** No timeline known.

**Status:** OPEN. Requires upstream fix or a focused tooling sprint. Not closing in Phase 2.

### B3 — Build-time data fetch routes (reported, not a regression)
**Severity:** INFO
**Routes that fetch from Payload at build time (intentional):**
- `src/app/sitemap.ts` — calls `listProductSlugs / listVendorSlugs / listPageSlugs` to build the sitemap (graceful-degrades to `[]` per H11 already if any list throws — sitemap will still emit static routes).
- `src/app/(marketing)/products/[slug]/page.tsx:24` — `generateStaticParams()` enumerates published product slugs for ISR pre-render.
- `src/app/(marketing)/vendors/[slug]/page.tsx:15` — `generateStaticParams()` enumerates active vendor slugs for ISR pre-render.
These are reasonable and load-bearing for SEO/perf. They're noted here only so the build-time DB dependency is explicit when planning B1/B2.
**Status:** No change recommended; informational only.

### B4 — `instrumentation-client.ts` imports a no-longer-exported Sentry symbol
**Severity:** MINOR (build warning, not a hard fail)
**Symptom:** `npm run build` reports `Attempted import error: 'captureRouterTransitionStart' is not exported from '@sentry/nextjs' (imported as 'Sentry')` from `./instrumentation-client.ts`. Build still completes (warning, not error) and runtime behaviour is presumably degraded only for router transition spans.
**Root cause:** The `@sentry/nextjs` package version installed no longer exports `captureRouterTransitionStart`; this is a Sentry SDK API drift, not caused by Phase 2 changes.
**Why it matters:** Build noise that hides real warnings; partial loss of Sentry instrumentation around route transitions.
**Proposed fix:** Either upgrade `@sentry/nextjs` to a version that still exports the symbol, or remove the import (and any usage) from `instrumentation-client.ts` if the symbol is no longer needed by the current SDK version. Verify Sentry transition spans still arrive after the change.
**Status:** OPEN, surfaced during Phase 2 build verification; not in original Phase 2 scope.

Phase 1 + open-question verification complete. Beginning Phase 2 fixes against the 15 confirmed MAJORs in priority order. No code changes outside the strict-fix scope.

---

## PHASE 2 CLOSE-OUT (2026-06-03)

### Final verification gauntlet (exact final tree)
- Full integration suite: **45/45 files, 147/147 tests passing**.
- Lint: **clean**. `tsc --noEmit`: **clean**.
- One clean `npm run build` against the migrated test DB (dev sentinel deleted first): **exit 0, 22/22 static pages generated.** This is the migrated-DB ("subsequent deploy") path ONLY — it is NOT cold-deploy evidence; B5/B2 status is unchanged by it.
- Remaining build warnings: `@upstash/redis` Node-API-in-Edge-Runtime notice and webpack cache big-strings — both pre-existing and cosmetic. B4's Sentry `Attempted import error` warning is **gone** (B4 fixed, below).

### MINOR batch — FIXED (11 minors + B4)
Each with a dedicated regression test in `tests/integration/`:

- **m1** — paid-after-cancel auto-refund reference (`m1-auto-refund-idempotent.test.ts`)
- **m3** — cancel partial-release notes (`m3-cancel-partial-release-notes.test.ts`)
- **m13** — Resend deadline now ABORTS the in-flight request, at **both** send sites: `src/lib/email.ts` `send()` AND `src/payload/jobs/retryFailedEmails.ts` handler. Reject-first-then-abort on the 8s timer so the race deterministically reports `resend_timeout_8s` and the socket is released (pre-fix: the race abandoned the promise but the socket held an HTTP slot until Resend's own timeout — slow socket leak during a Resend outage). Wiring: Resend 4.8's `post()` spreads the `send()` options arg directly into fetch's `RequestInit`, so `signal` reaches the socket; the SDK types don't declare it (typed intersection, no runtime hack). **Behavioral test** `m13-resend-abort.test.ts` (2 tests — one per site): stubbed hung fetch + fake-timer deadline, asserts the request carries a signal, the abort actually fires at the socket layer, and (primary path) the failed email is queued for retry / (job path) the handler throws so Payload's retry policy re-queues.
- **m14** — Upstash fallback warn (`m14-upstash-fallback-warn.test.ts`)
- **m15** — cron Bearer timing-safe compare (`m15-cron-timing-safe.test.ts`)
- **m17** — Flutterwave prod env guard (`m17-flutterwave-env-guard.test.ts`)
- **m20** — shared revoke-user-sessions helper, 4 sites (`m20-revoke-user-sessions-helper.test.ts`, new `src/lib/user-sessions.ts`)
- **m21** — checkout redirect host allow-list (`m21-redirect-host-allowlist.test.ts`, new `src/lib/checkout-redirect.ts`)
- **m23** — shop `?page=` clamp (`m23-shop-page-clamp.test.ts`)
- **m25** — sitemap per-row `lastModified` (`m25-sitemap-updated-at.test.ts`). **Scope-growth flag:** billed cheap; actually changed the return signature of three query helpers (`listProductSlugs`/`listVendorSlugs`/`listPageSlugs` → `{slug, updatedAt}[]`) and rippled into both `generateStaticParams` callers + `sitemap.ts`. **Confirmed NO B5 interaction:** same build-time call sites, same `payload.find` (collection/where/limit/depth unchanged), only `updatedAt` added to the select — no new or removed build-time `getPayload()` and no timing change; on a cold deploy the failure still occurs in the migration runner before any query runs.
- **m27** — default OG/Twitter images (`m27-og-image.test.ts`, new `src/app/opengraph-image.tsx` + `src/app/twitter-image.tsx`). **Scope-growth + build-break flag:** billed a one-liner; became two new route files AND broke the build — Satori prerender hard-fail ("Expected <div> to have explicit display:flex … more than one child node") on the headline div, plus `runtime='edge'` warnings (unrecognized re-export; edge disables static generation). Fixed: explicit flex column for the headline, dropped the edge runtime — both routes now statically generate (build went 20 → 22 pages). The bug was masked until close-out because no build had gotten past the sentinel hang.
- **B4** — Sentry `captureRouterTransitionStart` import warning: resolved in `instrumentation-client.ts` by reading the symbol off the runtime namespace via bracket access (no-op on Sentry 8, lights up on 9+); the build warning is gone.

### MINORS DEFERRED — the "(c)" bucket
**m2, m4, m5, m6, m7, m8, m9, m10, m11, m12, m16, m18, m19, m22, m24, m26, m28** — confirmed deferred; no code touched. (Note: this document contains no in-document (a)/(b)/(c) triage — that grouping was session triage; this list is its durable record. The lowercase test files for M-prefixed MAJORs, e.g. `m16-truncated-banner` = MAJOR M16, are unrelated to same-numbered minors.)

### Confirmed OPEN at close (one line each)
- **M11** — `after()`→`setImmediate` fallback for role-change session revocation is currently unreachable (no non-HTTP path writes Users/Vendors roles; OQ5) — demoted MINOR and deferred rather than forced.
- **M12** — sibling refund rows carry different Stripe idempotency keys, so the over-refund cap can be exceeded under concurrency; the per-order cap re-check / DB-trigger fix is designed but deliberately NOT applied speculatively.
- **B5** — no migration step exists in any deploy pipeline; cold deploy is unproven and empirically fails — the load-bearing deployment finding; inherits the build-hang/dev-sentinel diagnosis above.
- **B2** — `payload migrate` CLI fails on Node 20/22/25 (undici 7 / tsx ESM loader); blocks wiring B5's pre-build migrate step.

**Phase 2 is CLOSED.** B5+B2 form the separate deployment work package (entry point documented above); M12's trigger fix is scheduled deliberately; all other open items are recorded with proposed fixes in their entries.
