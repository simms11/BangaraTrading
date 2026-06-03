# Bangarah Trading — Marketplace v2

Multi-vendor marketplace + B2B quote platform for African and Caribbean sole traders. Anchor merchant: Bangarah Trading Enterprises CC (Namibia, est. 2011).

> **Status:** Phase 0 (foundation) complete on `rebuild/v2`. The original CRA marketing site lives on `master` and is preserved in this branch's first commit. See [`ROADMAP.md`](./ROADMAP.md) for the phased delivery plan.

---

## Stack

| Layer | Tool |
| --- | --- |
| Framework | Next.js 15 (App Router, RSC, Server Actions) + TypeScript |
| UI | Tailwind CSS 4 + custom design tokens, Radix primitives, lucide-react icons |
| Backend / Admin / CMS | Payload CMS 3 (mounted at `/admin`) |
| Database | Postgres (local: Docker; prod: Neon) |
| Payments | Stripe (international) + Flutterwave (Africa) — *Phase 2* |
| Search | Typesense — *Phase 1* |
| Media | Cloudflare R2 — *Phase 1* |
| Email | Resend + React Email — *Phase 2* |
| Shipping | EasyPost — *Phase 5* |
| Errors | Sentry (env-gated) |
| Hosting | Vercel + Neon + Cloudflare R2 |

## Local dev

### 1. Install
```bash
nvm use 20 # or any Node ≥20.9
npm install
```

### 2. Start Postgres
```bash
docker run --name bangarah-pg \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=bangarah \
  -p 5432:5432 \
  -d postgres:16
```

### 3. Configure env
```bash
cp .env.example .env
# Then set at minimum:
#   PAYLOAD_SECRET=$(openssl rand -base64 32)
#   DATABASE_URL=postgres://postgres:postgres@localhost:5432/bangarah
```

### 4. Run
```bash
npm run dev
```

- **Storefront**: <http://localhost:3000>
- **Admin**: <http://localhost:3000/admin> (first user becomes admin)
- **REST API**: `http://localhost:3000/api/{collection}`
- **GraphQL**: `http://localhost:3000/api/graphql` (+ playground at `/api/graphql-playground`)

### 5. Seed the catalog (optional, dev only)

With the dev server running:

```bash
SEED_TOKEN=dev npm run seed
```

This POSTs to `/api/dev/seed`, creating:
- Admin user — `admin@bangarahtradingenterprises.com` / `ChangeMe!2026` (override via `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`)
- 2 vendors (Bangarah Trading, Okuva Naturals)
- 6 categories
- 8 products (Ayisha's, Kiyaya's, honey, beverages, supplements, Caribbean imports)
- 3 featured products wired into the homepage

The endpoint is gated by `SEED_TOKEN` and refuses to run in production builds. Re-running is safe — docs are upserted by slug/email.

### Common scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server (storefront + admin + API) |
| `npm run build` | Production build |
| `npm run typecheck` | TS-only check, no emit |
| `npm run lint` | ESLint (next/core-web-vitals + next/typescript) |
| `npm run generate:types` | Regenerate Payload TS types after schema change |
| `npm run generate:importmap` | Regenerate Payload admin importMap |

## Project structure

```
src/
├── app/
│   ├── (marketing)/         # Public storefront routes (storefront layout)
│   │   ├── page.tsx         # Homepage
│   │   ├── about/page.tsx
│   │   ├── contact/page.tsx
│   │   ├── services/page.tsx
│   │   ├── shop/page.tsx    # Phase 1
│   │   ├── vendors/page.tsx
│   │   ├── sell/page.tsx
│   │   ├── quote/page.tsx   # Phase 3
│   │   ├── cart/page.tsx    # Phase 2
│   │   └── account/page.tsx # Phase 2
│   ├── (payload)/           # Payload admin + API (do not modify by hand)
│   │   ├── admin/[[...segments]]/...
│   │   └── api/...
│   ├── layout.tsx           # Root layout, fonts, metadata
│   ├── globals.css          # Tailwind + design tokens
│   ├── robots.ts            # /robots.txt
│   ├── sitemap.ts           # /sitemap.xml
│   └── not-found.tsx
├── components/
│   ├── ui/                  # Primitives (button, badge, card, container)
│   └── site/                # Marketing surface (header, footer, hero, ...)
├── payload/
│   ├── access/              # RBAC helpers
│   └── collections/         # Users, Vendors, Categories, Products, Orders, Quotes, Pages, Media
├── payload.config.ts        # Payload top-level config (Postgres adapter, Lexical editor)
└── lib/utils.ts             # Helpers (cn, formatPrice, slugify)

.legacy/                     # The original CRA marketing site — reference only, gitignored from build
```

## Data model (Phase 0)

- **Users** — `admin` / `vendor` / `customer` roles; vendors are linked to a `vendors` doc.
- **Vendors** — sole-trader storefronts; status workflow (pending → active → paused → banned), payout details (bank, Stripe Connect, Flutterwave sub-account), platform commission %.
- **Products** — vendor-owned; `fulfillmentMode` of `retail`, `quote`, or `hybrid` drives whether items go through checkout or the quote flow.
- **Orders** — full retail order with line items (each line carries its vendor for marketplace split-out), payment processor record, shipping/billing, fulfillment tracking.
- **Quotes** — B2B enquiry workflow, status (submitted → reviewing → quoted → accepted/declined → converted), convertible to an order.
- **Categories**, **Pages**, **Media** — supporting collections.

## Payments architecture (planned, Phase 2)

Bangarah is **merchant-of-record** at launch. Money lands with Bangarah:
- **Stripe** processes international cards (UK/US/EU/diaspora).
- **Flutterwave** processes African cards and NA/ZA bank methods.

Vendor payouts are reconciled on a **ledger** in Payload and paid out weekly via bank transfer. The data model already records per-line-item vendor and commission rate so we can graduate to true split payments (Stripe Connect / Flutterwave sub-accounts) without a schema rewrite.

## Security & compliance baseline (Phase 0)

- Security headers wired in `next.config.ts` (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`).
- Payload secrets via env only (`PAYLOAD_SECRET`, `DATABASE_URL`).
- Cookies use `SameSite=Lax` + `Secure` in production.
- Skip-to-content link, focus-visible rings, reduced-motion media query.
- `robots.txt` blocks `/admin`, `/api`, `/account`; sitemap is generated.
- CSP, cookie banner, GDPR/POPIA DPA notice: **Phase 5**.

## Branches

- `master` — original CRA marketing site, untouched.
- `rebuild/v2` — this rebuild. Will become `main` once ready to cut over.

## Roadmap

See [`ROADMAP.md`](./ROADMAP.md).
