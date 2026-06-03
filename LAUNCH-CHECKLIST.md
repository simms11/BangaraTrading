# Bangarah Marketplace — Launch Checklist

Items to complete before flipping `rebuild/v2` to the production domain. Items below are
ordered by sequence (some block others).

---

## 1. Infrastructure accounts

- [ ] **Vercel** project linked to the repo, branch protection on `main`
- [ ] **Neon** Postgres database created, pooled connection string captured
- [ ] **Cloudflare R2** bucket created with public read enabled; `R2_*` env vars set
- [ ] **Stripe** account in live mode; webhook endpoint added: `https://<domain>/api/webhooks/stripe`
- [ ] **Flutterwave** live keys + webhook secret (`verif-hash`); webhook endpoint: `https://<domain>/api/webhooks/flutterwave`
- [ ] **Resend** domain verified (`bangarahtradingenterprises.com`); SPF/DKIM/DMARC records added
- [ ] **EasyPost** account (optional — flat-rate fallback ships if absent)
- [ ] **Sentry** project created (`bangarah-storefront`); DSN added to env
- [ ] **PostHog** project created; project key added (anonymous tracking only)

## 2. DNS & SSL

- [ ] `bangarahtradingenterprises.com` A/AAAA records to Vercel
- [ ] `www` CNAME to the same Vercel deployment
- [ ] `media.bangarahtradingenterprises.com` CNAME to R2 public domain (or use R2's default)
- [ ] SSL provisioning verified end-to-end (HSTS preload ready — the app already sends `max-age=63072000; includeSubDomains; preload`)

## 3. Environment variables (prod)

Required minimum, in Vercel Project Settings → Environment Variables (Production scope):

- [ ] `PAYLOAD_SECRET` (generated with `openssl rand -base64 48`)
- [ ] `DATABASE_URL` (Neon pooled connection)
- [ ] `NEXT_PUBLIC_SITE_URL=https://bangarahtradingenterprises.com`
- [ ] `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- [ ] `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_WEBHOOK_SECRET`, `NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY`
- [ ] `RESEND_API_KEY`, `EMAIL_FROM`, `OPS_EMAIL`
- [ ] `R2_BUCKET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_URL`
- [ ] `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`
- [ ] `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`
- [ ] `MANUAL_PAYMENT_INSTRUCTIONS` (the actual bank details + reference instructions)
- [ ] `DISABLE_MANUAL_CHECKOUT=true` once Stripe/Flutterwave live (or leave on as fallback)
- [ ] `SEED_TOKEN` — set to a strong random string OR remove `/api/dev/seed` from prod entirely (already gated on `NODE_ENV !== 'production'`)

## 4. Catalog & content

- [ ] Run `npm run seed` once (dev/staging) to populate baseline; verify products render
- [ ] In `/admin`, upload real product photography (Cloudflare R2 active)
- [ ] Fill SEO group fields (title / description / OG image) on every published product
- [ ] Update homepage `SiteSettings → hero` with real launch copy
- [ ] Add at least 3 featured products in `SiteSettings → featuredProducts`

## 5. Payments — end-to-end smoke

- [ ] Test card via Stripe test mode → see order land in admin → webhook marks paid → email received
- [ ] Flutterwave test card → same flow
- [ ] Manual mode: place an order → confirm bank instructions email received
- [ ] Issue a refund via admin → order status flips → customer sees refund line

## 6. Vendor onboarding

- [ ] Approve Bangarah as anchor vendor; set commission rate (0% for self)
- [ ] Approve at least one partner vendor end-to-end (application → approval → vendor signs in → dashboard renders)
- [ ] Generate a payout statement via `/api/admin/payouts/generate-statement` to verify math
- [ ] Export `/api/admin/payouts/export.csv` and confirm it opens in Sheets / Excel cleanly

## 7. Security & compliance

- [ ] `Content-Security-Policy` header validates clean via [securityheaders.com](https://securityheaders.com)
- [ ] HSTS preload submitted (after at least 6 weeks of stable production)
- [ ] Cookie banner appears on first visit; preferences persist
- [ ] `/privacy`, `/terms`, `/cookies` reviewed by legal counsel (lawyer to confirm Namibian + diaspora coverage)
- [ ] `robots.txt` excludes `/admin`, `/api`, `/account`, `/vendor`, `/admin-reports`
- [ ] Sentry receives errors on a forced test (throw in a route, confirm capture)
- [ ] Vercel deployment uses production env vars only; preview deployments use Neon branch

## 8. Accessibility

- [ ] Playwright axe-core suite passes (`npm run test:e2e`)
- [ ] Manual keyboard pass: tab through home → shop → product → cart → checkout — no traps
- [ ] Manual screen reader pass on home + product detail (VoiceOver or NVDA)
- [ ] Lighthouse a11y score ≥95 on homepage + product detail

## 9. Performance

- [ ] Lighthouse performance ≥90 on homepage (mobile)
- [ ] Largest Contentful Paint <2.5s
- [ ] No layout shifts when product images load (Next/Image with `fill` + sizes is wired)
- [ ] Vercel Edge cache invalidates after Payload publish (revalidate via webhook from afterChange)

## 9.5 Multi-region (when you outgrow a single Neon)

Bangarah's storefront is read-heavy; the database is the bottleneck once
you cross ~100 k MAU or ~10 RPS sustained writes. Plan:

- [ ] **Neon read replicas** — provision read-only replicas in each region you
  serve (eu-west-1 for the UK/EU diaspora, us-east-1 for the US, your primary
  in af-south-1 / closest available). Connection strings differ per role.
- [ ] **Route reads to nearest replica, writes to primary** — Payload doesn't
  natively support multi-DSN, so wrap the postgresAdapter with two pools
  (write + read). Bind reads via `payload.find({ … })` overrides per region;
  rely on Vercel's region-aware fetch routing.
- [ ] **Migration safety** — every migration must be safe to run on the primary
  while replicas lag (no destructive in-place alters; use add-then-backfill).
- [ ] **Stale-read tolerance** — replicas trail primary by single-digit ms.
  Cart, checkout, and webhook handlers must always hit primary; product
  browse / vendor pages / sitemap can use replicas freely.
- [ ] **Cloudflare R2 stays single-region** but media is served via Cloudflare's
  global edge cache, so multi-region replication isn't required there.
- [ ] **Upstash Redis** for rate limiting is already multi-region by design — no
  changes needed.

If this is more than you need now, leave the single-region setup running
and revisit when you have either sustained >50 RPS or DB latency >50 ms
p95 from a target market.

## 10. Backups & monitoring

- [ ] Neon daily backups confirmed (default retention: 7 days)
- [ ] Cloudflare R2 lifecycle: media never deleted; product image deletion is soft (Payload trash)
- [ ] Sentry alerts route to Slack or email
- [ ] Vercel Analytics enabled
- [ ] Uptime monitoring (Vercel built-in or external) on `/`, `/shop`, `/admin`, `/api/products`

## 11. Operational handover

- [ ] Document the admin login + password reset flow
- [ ] Walk Bangarah ops through: approving vendors, managing orders, issuing refunds, generating payouts, exporting CSV
- [ ] Walk Bangarah ops through: editing products, SiteSettings, and Pages in `/admin`
- [ ] Soft launch with a small announcement before public marketing push
