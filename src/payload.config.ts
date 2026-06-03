import path from 'path'
import { fileURLToPath } from 'url'
import { buildConfig, type Plugin } from 'payload'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { s3Storage } from '@payloadcms/storage-s3'
import { seoPlugin } from '@payloadcms/plugin-seo'

import { migrations } from './payload/migrations'
import {
  createDepthLimit,
  createMaxLimitRule,
  blockIntrospectionInProduction,
} from './lib/graphql/depth-limit'

import { Users } from './payload/collections/Users'
import { Vendors } from './payload/collections/Vendors'
import { Categories } from './payload/collections/Categories'
import { Products } from './payload/collections/Products'
import { Orders } from './payload/collections/Orders'
import { Quotes } from './payload/collections/Quotes'
import { Pages } from './payload/collections/Pages'
import { Media } from './payload/collections/Media'
import { Payouts } from './payload/collections/Payouts'
import { Refunds } from './payload/collections/Refunds'
import { ProcessedEvents } from './payload/collections/ProcessedEvents'
import { AuditLog } from './payload/collections/AuditLog'
import { SiteSettings } from './payload/globals/SiteSettings'
import { jobs } from './payload/jobs'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

const plugins: Plugin[] = [
  seoPlugin({
    collections: ['products', 'pages', 'vendors'],
    uploadsCollection: 'media',
    generateTitle: ({ doc }) =>
      doc?.title ? `${doc.title} · Bangarah Trading` : 'Bangarah Trading',
    generateDescription: ({ doc }) => doc?.shortDescription ?? doc?.tagline ?? '',
  }),
]

if (process.env.R2_BUCKET && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY) {
  plugins.push(
    s3Storage({
      collections: { media: { prefix: 'media' } },
      bucket: process.env.R2_BUCKET,
      config: {
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        region: 'auto',
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
      },
    }),
  )
}

/**
 * H1/M9/minors: hard-fail in prod when production-critical env vars are
 * missing rather than silently falling back to broken behaviour.
 *
 * Previous behaviour:
 *   - NEXT_PUBLIC_SITE_URL missing → CORS/CSRF gated to localhost; admin
 *     same-origin requests from the real domain rejected.
 *   - RESEND_API_KEY missing → emails mocked to console; production
 *     accepts orders and the customer never gets a confirmation.
 *   - R2_BUCKET / R2_* missing → S3 storage plugin not registered;
 *     uploads land on serverless ephemeral disk and disappear on the
 *     next deploy.
 *
 * Each of these is a launch-day silent failure, so we trip the boot
 * loudly. Dev still tolerates them so localhost / CI keeps working.
 */
if (process.env.NODE_ENV === 'production') {
  const missing: string[] = []
  if (!process.env.NEXT_PUBLIC_SITE_URL) missing.push('NEXT_PUBLIC_SITE_URL')
  if (!process.env.RESEND_API_KEY) missing.push('RESEND_API_KEY')
  // R7 round-7 reliability M4 — Stripe was previously NOT in the prod
  // hard-fail list. A deploy without these would silently accept orders
  // (manual / Flutterwave still work) but the abandoned-orders sweeper's
  // Stripe-session probe would no-op, refund webhooks couldn't issue
  // real refunds, and `charge.refunded` events would silently fail to
  // verify. Require both Stripe vars at boot.
  if (!process.env.STRIPE_SECRET_KEY) missing.push('STRIPE_SECRET_KEY')
  if (!process.env.STRIPE_WEBHOOK_SECRET) missing.push('STRIPE_WEBHOOK_SECRET')
  // m17 (Phase 2): symmetry with the Stripe pair above. Flutterwave is
  // Bangarah's primary processor in-market (African card acceptance +
  // NA/ZA bank methods). A prod deploy without these silently drops
  // Flutterwave checkout — Stripe paths look healthy, /api/health is
  // green, but a large fraction of customers see processor errors with
  // no boot-time signal. Match the Stripe behaviour: require both at
  // boot.
  if (!process.env.FLUTTERWAVE_SECRET_KEY) missing.push('FLUTTERWAVE_SECRET_KEY')
  if (!process.env.FLUTTERWAVE_WEBHOOK_SECRET) missing.push('FLUTTERWAVE_WEBHOOK_SECRET')
  // I5 (M1) — without Upstash configured, consumeStrict falls back to a
  // per-instance in-memory bucket which is effectively unlimited on a
  // multi-instance Vercel deploy. Login + forgot-password rate limits
  // become decorative. Require Upstash credentials so credential-stuffing
  // protection actually works.
  if (!process.env.UPSTASH_REDIS_REST_URL) missing.push('UPSTASH_REDIS_REST_URL')
  if (!process.env.UPSTASH_REDIS_REST_TOKEN) missing.push('UPSTASH_REDIS_REST_TOKEN')
  // J5 (round-4 M1) — `PAYLOAD_DISABLE_SCHEMA_PUSH=true` is what gates the
  // adapter into migrations-only mode in production. Forgetting it means
  // Payload silently auto-pushes schema diffs at boot, which can corrupt
  // the migrations registry's idea of what's deployed.
  if (process.env.PAYLOAD_DISABLE_SCHEMA_PUSH !== 'true') {
    missing.push('PAYLOAD_DISABLE_SCHEMA_PUSH=true (required in production)')
  }
  // R2 is the prod uploads backing. If any one of the three vars is set,
  // we assume the operator intends R2 and require the full triple.
  const anyR2 =
    process.env.R2_BUCKET ||
    process.env.R2_ACCESS_KEY_ID ||
    process.env.R2_SECRET_ACCESS_KEY ||
    process.env.R2_ACCOUNT_ID
  if (anyR2) {
    if (!process.env.R2_BUCKET) missing.push('R2_BUCKET')
    if (!process.env.R2_ACCESS_KEY_ID) missing.push('R2_ACCESS_KEY_ID')
    if (!process.env.R2_SECRET_ACCESS_KEY) missing.push('R2_SECRET_ACCESS_KEY')
    if (!process.env.R2_ACCOUNT_ID) missing.push('R2_ACCOUNT_ID')
  } else {
    missing.push('R2_BUCKET (uploads will be lost on next deploy)')
  }
  if (missing.length > 0) {
    throw new Error(
      `Refusing to start: required production env vars are missing: ${missing.join(', ')}`,
    )
  }
}

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: { baseDir: path.resolve(dirname) },
    meta: {
      titleSuffix: ' — Bangarah Admin',
    },
  },
  collections: [
    Users,
    Vendors,
    Categories,
    Products,
    Orders,
    Quotes,
    Pages,
    Media,
    Payouts,
    Refunds,
    ProcessedEvents,
    AuditLog,
  ],
  globals: [SiteSettings],
  editor: lexicalEditor({}),
  plugins,
  // B67 fix: in production, refuse to start without a real secret. A
  // missing PAYLOAD_SECRET previously fell through to a constant string —
  // anyone who knew that string (it's in this repo's history) could forge
  // signed cookies and impersonate admins. Dev still gets a sane default.
  secret: (() => {
    const s = process.env.PAYLOAD_SECRET
    if (s && s.length >= 16) return s
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'PAYLOAD_SECRET is missing or too short (need >= 16 chars). Refusing to start.',
      )
    }
    return 'dev-only-insecure-secret-do-not-use-in-prod'
  })(),
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URL,
      // Explicit pool sizing. Defaults are conservative; tune per environment.
      // On Vercel the function instance is short-lived and reuses connections
      // across requests via the pool. On Neon, total cluster connections
      // = pool.max × function instances — keep this < your Neon limit.
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idleTimeoutMillis: Number(process.env.DATABASE_POOL_IDLE_MS ?? 30_000),
      connectionTimeoutMillis: Number(process.env.DATABASE_POOL_CONNECT_MS ?? 5_000),
    },
    // Production deploys MUST run migrations explicitly. Dev keeps the
    // automatic schema push for speed of iteration — set
    // PAYLOAD_DISABLE_SCHEMA_PUSH=true on production env vars.
    push: process.env.PAYLOAD_DISABLE_SCHEMA_PUSH !== 'true',
    prodMigrations: migrations,
    migrationDir: path.resolve(dirname, 'payload/migrations'),
  }),
  jobs,
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  graphQL: {
    schemaOutputFile: path.resolve(dirname, 'payload/generated-schema.graphql'),
    // B60: cap nested field depth so an adversary can't DoS via deeply
    // nested introspection or relationship traversal queries.
    // B75: strip __schema / __type introspection in production so the
    // schema isn't enumerable to anyone who can hit /api/graphql.
    // M19: cap `limit` argument on list queries so a single anonymous POST
    // can't request 10 000 products and scrape the catalog wholesale.
    // I8 (M17): combined depth × per-field limit fans out — at depth 6 with
    // limit 50 the worst-case row product is still 50^6, which never
    // materialises in practice because the SQL joins gate fan-out, but
    // tightening both bounds the surface that does. A real query-cost
    // rule (graphql-query-complexity) is the proper long-term answer.
    validationRules: () => [
      createDepthLimit(6),
      createMaxLimitRule(50),
      blockIntrospectionInProduction,
    ],
  },
  cors: [process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'].filter(Boolean) as string[],
  csrf: [process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'].filter(Boolean) as string[],
})
