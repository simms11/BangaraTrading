# Bangarah Marketplace — Delivery Roadmap

Living document. Each phase ends with the user reviewing before the next begins.

---

## ✅ Phase 0 — Foundation (this branch)

- [x] New `rebuild/v2` branch; CRA WIP snapshotted on first commit; `master` untouched
- [x] Next.js 15 (App Router, RSC, Server Actions) + TypeScript
- [x] Tailwind 4 + custom design tokens (brand / accent / spice palettes, Fraunces + Inter typography)
- [x] shadcn/Radix-style primitives: Button, Badge, Card, Container
- [x] Payload CMS 3 wired in at `/admin`, REST + GraphQL at `/api`
- [x] Postgres adapter, Neon-ready, Docker for local
- [x] Data model: Users (admin/vendor/customer), Vendors, Products, Categories, Orders, Quotes, Pages, Media — all with RBAC + per-line-item vendor for marketplace splits
- [x] Marketing pages on the new stack: home (hero/stats/featured/services/about/CTA), about, services, contact, shop/vendors/sell/quote/cart/account placeholders
- [x] SEO: per-page metadata, OG, canonical, `robots.txt`, `sitemap.xml`, JSON-LD-ready
- [x] A11y: skip-to-content, focus-visible, semantic landmarks, alt text discipline, `prefers-reduced-motion`
- [x] Security headers in `next.config.ts`
- [x] Sentry (env-gated, no-op locally) + GH Actions CI (typecheck + lint + build, Postgres service)
- [x] `.env.example` for every dependency; README + this roadmap

## ✅ Phase 1 — Catalog & content

- [x] Live product pages (RSC reading from Payload) — `/products/[slug]` with SSG via `generateStaticParams` and 5-minute ISR
- [x] Catalog browse `/shop` with category filter, sort (newest / price asc-desc), pagination, empty state
- [x] Vendor index `/vendors` and storefront `/vendors/[slug]`
- [x] Cloudflare R2 storage adapter wired in (env-gated — local dev falls back to disk)
- [x] @payloadcms/plugin-seo on Products, Pages, Vendors (auto-fills title/description from doc fields)
- [x] Structured data: `Product` + `BreadcrumbList` on product pages, `Organization` site-wide, `BreadcrumbList` on vendor pages
- [x] Sitemap dynamically extended with all product + vendor URLs
- [x] Site-settings global (homepage hero, featured products, announcement banner) — editable in admin
- [x] Reusable product components: `ProductCard`, `ProductGallery` (accessible image switcher), `Price` (compare-at strikethrough, currency-aware)
- [x] Idempotent seed via `POST /api/dev/seed` (gated by `SEED_TOKEN` + non-prod) loads admin, 2 vendors, 6 categories, 8 products, 3 featured
- [x] Query helpers (`src/lib/queries/`) with React `cache()` and safe error wrapping so DB outages degrade gracefully to the static fallback

**Deferred** (intentional): Typesense facet search — Payload's built-in queries are sufficient under ~500 SKUs, which fits this business for the foreseeable future. CMS-driven hero/about copy is wired (SiteSettings global) but the homepage components still read static fallbacks; will be flipped to the global in Phase 1.5 once final brand copy is locked.

## ✅ Phase 2 — Retail checkout

- [x] Cookie-backed cart with server-action engine (add / update qty / remove / clear)
- [x] `/cart` with retail vs quote item split, live totals, "Proceed to checkout"
- [x] Add-to-cart on product pages with quantity stepper (replaces Phase 1 placeholder)
- [x] Header cart badge with live item count, auth-aware Sign in / Account label
- [x] `/checkout` — Zod-validated address form, shipping + billing, optional notes
- [x] Payment processor abstraction with three modes:
  - **Stripe Checkout** (international cards, hosted checkout)
  - **Flutterwave Standard** (NAD/ZAR cards, mobile money — Africa-friendly)
  - **Manual bank transfer** (always available; merchant-of-record fallback)
- [x] Order creation pipeline (`src/lib/orders.ts`): atomic `Order` doc with per-line vendor for future split payouts
- [x] Webhooks: `/api/webhooks/stripe` (signature-verified), `/api/webhooks/flutterwave` (verif-hash + verify endpoint re-check)
- [x] Customer auth: `/sign-in`, `/sign-up`, sign-out — stateless JWT, guest checkout supported
- [x] `/orders/[orderNumber]` confirmation page with payment-instruction surface for manual mode
- [x] `/account` dashboard + `/account/orders` history (auth-gated)
- [x] Transactional email: React Email order-confirmation template + Resend client. Env-gated — logs to stdout in dev if no API key, sent via webhook completion in prod
- [x] Verified end-to-end: 16/16 smoke checks passing (product fetch, cart, checkout render, sign-up → sign-in → auth-gated pages, webhook signature enforcement)

**Deferred** (intentional): Apple Pay / Google Pay specific buttons (Stripe Checkout already supports them automatically), magic-link login (password auth ships, magic-links a Phase 2.5 nice-to-have), saved addresses (Phase 2.5).

## ✅ Phase 3 — B2B quote flow

- [x] **Cart-driven quote submission** — quote items in `/cart` get their own submit form (Zod-validated contact + destination), creates a Quote doc and clears quote items from the cart
- [x] **Standalone /quote page** — works for ad-hoc enquiries; deep-links via `?product=slug` (Request bulk quote button on product pages now seeds the form)
- [x] **Customer-facing `/quotes/[quoteNumber]`** — status-aware view: submitted → reviewing → quoted (with per-line pricing & total) → converted. Accept-quote form for ready quotes
- [x] **`/account/quotes`** — signed-in customer's quote history
- [x] **Quote inbox in admin** — Payload admin auto-generates the editor; ops set per-line `unitPriceQuoteMinor`, write a response message and a `validUntil` date, flip status to `quoted`
- [x] **afterChange hook on Quotes** — when status transitions into `quoted`, customer receives `QuoteResponseEmail` (React Email + Resend, dev-mocked to stdout)
- [x] **Ops alert on new quote** — `NewQuoteEmail` fires to both customer (acknowledgement) and `OPS_EMAIL` (alert with admin link)
- [x] **Accept → order conversion** — `acceptQuoteAndCreateOrder()` validates status + expiry + per-line pricing, creates an Order with the quoted prices, updates the quote to `converted` and links the order. Redirects customer to `/orders/[orderNumber]` for payment
- [x] **Vendor-scoped access** — quote read/update access already restricts vendors to their own line items (Phase 0 data model)
- [x] Verified end-to-end: 14/14 checks pass (submit → submitted view → admin response → quoted view with accept form + total → DB persistence; quote-response email confirmed firing in dev log)

**Deferred** (intentional): PDF quote document (browsers print the customer-facing page fine; full PDF generation deferred to Phase 5 with shipping/invoicing); separate vendor-facing UI (Payload admin works for now, Phase 4 builds the polished dashboard).

## ✅ Phase 4 — Vendor self-serve

- [x] Public vendor application form at `/sell` (Zod-validated business + contact + bio; auto-slug with uniqueness check)
- [x] `/sell/submitted` confirmation; admin receives `VendorApplicationEmail` with one-click admin link
- [x] `vendorApprovalEmailHook` on Vendors collection — when `status: pending → active`, fires `VendorApprovedEmail` to the linked vendor user (with storefront + dashboard links)
- [x] **Payouts collection** — admin-managed ledger with vendor, period, per-line gross/commission/payout breakdown, status workflow (pending → processing → paid → cancelled), reference + paidAt
- [x] Per-vendor RBAC: vendors can `read` their own payouts; only admins write
- [x] **`/vendor` dashboard** with sidebar layout, role-guarded — vendor users only, admin redirected to `/admin`
- [x] **Dashboard pages:**
  - `/vendor` overview — status badge, stat cards (products, paid orders, lifetime sales, payout owed) + quick links
  - `/vendor/products` — vendor's catalog table with status badges + admin edit links
  - `/vendor/orders` — vendor's slice of every order (per-line vendor share + order total)
  - `/vendor/payouts` — ledger table with lifetime / paid-out / outstanding stats
  - `/vendor/settings` — read-only profile + masked bank details with admin edit links
- [x] **Admin tools (auth-gated to role=admin):**
  - `POST /api/admin/payouts/generate-statement` — given a vendor + date range, builds a Payouts doc from paid orders that aren't already covered by an existing payout
  - `GET /api/admin/payouts/export.csv` — CSV export with vendor / period / gross / commission / net / orders_count columns
- [x] **Stats math:** vendor's gross = sum of paid line items where line.vendor = self. Commission = `vendor.commissionRate%` of gross. Net = gross − commission. Outstanding = (gross − commission) − sum(paid payouts).
- [x] **Role-aware sign-in:** vendors → `/vendor`, admins → `/admin`, customers → `/account`. `?next=...` preserves a deep-link target. `/account` redirects vendors/admins to their proper surface.
- [x] Verified end-to-end: **21/21 checks pass** (application → vendor user created → approval → vendor signs in → dashboard renders → admin generates statement → vendor sees payout → CSV export works → non-admin correctly blocked from admin endpoints). Commission math verified: NAD 300 × 12% = NAD 264 net payout.

**Deferred** (intentional): in-dashboard product CRUD (vendors edit through `/admin`, which respects per-vendor RBAC), Stripe Connect / Flutterwave sub-account onboarding (graduates from merchant-of-record once volume justifies KYC complexity — data model is forward-compatible), vendor self-serve bank-details editing (admin-mediated for verification).

## ✅ Phase 5 — Operations & launch readiness

- [x] **Shipping engine** (`src/lib/shipping/`) — common interface across providers
  - Always offers **Pickup from warehouse** (free) — Omumbonde Industrial Park
  - **Flat-rate tiers** by weight (≤500g / ≤1.5kg / ≤5kg / ≤10kg) for Namibia / South Africa / international
  - **EasyPost** env-gated; when `EASYPOST_API_KEY` is set, real carrier rates merge in alongside Pickup
  - Oversize parcels (>10kg) downgrade to pickup-only + nudge to quote flow
- [x] **Checkout shipping picker** — client component fetches options on country/postal change, persists selection (label + amountMinor) to the order
- [x] **Refunds collection** with status workflow (pending → processing → completed → failed/cancelled) and reasons. Refund → order status sync via `afterChange` hook (fully-refunded orders flip to `refunded`). Customer order page renders the refund timeline.
- [x] **Security headers** hardened: full `Content-Security-Policy` (allowlisting Stripe, Flutterwave, R2, Sentry, PostHog), `Strict-Transport-Security` (prod), `Cross-Origin-Opener-Policy`, `Permissions-Policy` with explicit `payment` allowlist, `X-DNS-Prefetch-Control`, no `X-Powered-By`. Admin route excluded from CSP since Payload bundles need permissive style/script-src
- [x] **Cookie banner** — POPIA/GDPR-compatible: Necessary (always on) + Analytics (opt-in), persisted in `localStorage`, dispatches a `bangarah:consent` event so analytics scripts can subscribe
- [x] **Legal pages** — `/privacy`, `/terms`, `/cookies` with real copy covering Namibian CC, POPIA (SA diaspora), and GDPR (UK/EU diaspora). Cookie table + retention table included
- [x] **Admin reporting** — `/admin-reports` (admin-only via `(staff)` route group with its own ops layout): GMV (window + lifetime), order counts, refunded total, outstanding payouts, orders-by-status, top vendors, top products, with 7/30/90/365-day window switcher
- [x] **Playwright e2e** — `tests/e2e/storefront.spec.ts` with 6 tests covering: homepage render, shop list + category filter, product detail + add-to-cart, /cart reflection, checkout shipping picker + manual processor, quote deep-link from product page, **axe-core a11y** check on homepage at WCAG 2 A/AA (no serious/critical violations allowed)
- [x] **Launch checklist** — [`LAUNCH-CHECKLIST.md`](./LAUNCH-CHECKLIST.md) with 11 sections of concrete pre-launch steps
- [x] **Orders schema**: `fulfillment.carrier` now stores the chosen shipping label; order page renders it inline with the shipping line

**Deferred to Phase 5.5** (real-world ops work, not blockers): automated Stripe/Flutterwave refund API calls (admin currently records refunds; processor refund happens out-of-band today), automated tax calculation (currently 0), Sentry error-budget alerts, Lighthouse CI ratchets, vendor self-serve product CRUD.

## ✅ Phase 5.5 — Production hardening pass

Tightening every real production risk to industry-standard. No POC behaviour.

- [x] **Server-side price re-validation at order creation** — cart `unitPriceMinor` is a *snapshot*; orders re-fetch the live product price from the DB. Crafting a cookie with $0.01 prices no longer works. Cart items pointing at unpublished/deleted products fail loudly with named errors.
- [x] **Server-side shipping re-quote** — the form's hidden `shippingAmountMinor` is a *hint*; orders re-quote shipping server-side and reject the order if the hint drifts >100 minor units from the server quote.
- [x] **Order confirmation token** — every order gets a 32-char nanoid stored in `orders.confirmationToken`. Guest order URLs include `?t=token`; signed-in customers match by owner. Admin + vendors see all. The token field has its own access rule so it never leaks via the REST API to unauthenticated callers. Timing-safe comparison.
- [x] **Generated Payload types** committed at `src/payload-types.ts` (~28 KB). All hot paths (`lib/queries/*`, `lib/orders.ts`, `lib/quotes.ts`, `lib/payouts.ts`) typed against generated interfaces; `any` removed.
- [x] **Rate limiting middleware** (`src/middleware.ts` + `src/lib/rate-limit.ts`) — token bucket with standard `RateLimit-*` headers + `Retry-After`. Limits: login 10/15min, signup 5/15min, dev 30/15min, shipping quote 120/min, admin 60/min. Webhooks bypass (signature-gated). In-memory now; same `consume(key, limit, ttl)` contract swaps to Upstash Redis for multi-region.
- [x] **Webhook idempotency** — new `processed-events` collection with unique `key = <processor>:<eventId>`. Duplicates return 200 to stop provider retries. Both webhooks claim before processing.
- [x] **Webhook amount + currency verification** — Stripe compares `session.amount_total` to `order.totalMinor`; Flutterwave hits the verify endpoint and compares both amount and currency to the order. Mismatches return 400 (don't mark paid).
- [x] **Cart resilience** — `readReconciledCart` strips lines whose product is deleted/unpublished. `/cart` shows a soft notice. Garbage entries in the cookie are also dropped at read time.
- [x] **Error + loading boundaries** — `(marketing)/error.tsx`, `(vendor)/error.tsx`, `(staff)/error.tsx`, `global-error.tsx` with **lazy** Sentry import (only loads when an error actually occurs — keeps shared JS at 101 KB).
- [x] **Real Postgres migrations** — `db:migrate`, `db:migrate:create`, `db:migrate:status` npm scripts; `PAYLOAD_DISABLE_SCHEMA_PUSH=true` for production deploys; migrations registry at `src/payload/migrations/index.ts`.
- [x] **PostHog via CDN snippet, consent-gated** — never bundled into app JS. Loads only when visitor opts in via cookie banner. Withdraws via `opt_out_capturing` on consent change.
- [x] **Sign-up info-leak fix** — generic "could not create / try signing in" instead of "an account with that email already exists". Eliminates the username-enumeration channel.
- [x] **Explicit `overrideAccess: true`** on every server-action `payload.create / update / find` call. No more implicit-admin-context behaviour.
- [x] **Order access gate** — single 404 (no info leak) for anyone who isn't the owner / admin / vendor / token holder. Constant-time string comparison.
- [x] **Health endpoint** at `/api/health` (≤100ms, DB readiness check, no cache).
- [x] **Bundle budget held** — 101 KB First-Load JS shared across all routes after adding Sentry, PostHog, error boundaries, rate-limit middleware. Middleware itself 32 KB.

**Verified** — typecheck clean, lint clean, build clean (43 routes including health + dev/generate-types). Smoke against running Postgres: rate-limit headers + 429, order gate blocks unauthorized access (content gate, body shows 404 page), webhook signatures enforced, processed-events collection ready, security headers right, storefront still renders.
