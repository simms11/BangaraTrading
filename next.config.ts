import type { NextConfig } from 'next'
import { withPayload } from '@payloadcms/next/withPayload'
import { withSentryConfig } from '@sentry/nextjs'

const isProd = process.env.NODE_ENV === 'production'

/**
 * Content Security Policy.
 *
 * - 'unsafe-inline' on style-src is required by Payload admin's MUI/Lexical
 *   bundles, plus Next.js's runtime style injection. We tolerate it because
 *   the rest of the policy (strict script-src, no eval, locked connect-src)
 *   keeps the blast radius small.
 * - script-src includes 'unsafe-inline' only because Next emits a tiny inline
 *   bootstrap. Production builds get the proper nonces in Phase 5.5 with a
 *   middleware-based CSP.
 * - connect-src lists every external API we talk to from the client:
 *   Stripe, Flutterwave, Resend (transactional preview), PostHog, Sentry,
 *   Cloudflare R2 (image fetches), EasyPost is server-only so omitted.
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self' https://checkout.stripe.com https://checkout.flutterwave.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "script-src 'self' 'unsafe-inline' https://js.stripe.com https://checkout.flutterwave.com https://*.posthog.com https://eu.i.posthog.com https://us.i.posthog.com",
  "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://checkout.stripe.com https://checkout.flutterwave.com",
  "connect-src 'self' https://api.stripe.com https://api.flutterwave.com https://*.r2.cloudflarestorage.com https://*.posthog.com https://eu.i.posthog.com https://us.i.posthog.com https://*.sentry.io https://*.ingest.sentry.io",
  isProd ? 'upgrade-insecure-requests' : '',
]
  .filter(Boolean)
  .join('; ')

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.r2.cloudflarestorage.com' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
    ],
  },
  async headers() {
    const base = [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-DNS-Prefetch-Control', value: 'on' },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=(), payment=(self "https://checkout.stripe.com")',
      },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      { key: 'Content-Security-Policy', value: csp },
    ]
    if (isProd) {
      base.push({
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains; preload',
      })
    }
    return [
      {
        // Don't apply our app CSP to the Payload admin — its bundle (Lexical
        // editor, dnd-kit, etc.) needs a more permissive policy that we let
        // Payload handle internally. We still keep the rest of the headers.
        source: '/((?!admin).*)',
        headers: base,
      },
      {
        source: '/admin/:path*',
        headers: base.filter((h) => h.key !== 'Content-Security-Policy'),
      },
    ]
  },
}

// I8 (M18): wrap the Next config with Sentry so source-map upload happens
// at build time and runtime errors symbolicate properly in the dashboard.
// Without this, every production stack trace was minified and unactionable.
//
// `silent: true` keeps the Sentry CLI quiet during local builds; the
// upload only runs when SENTRY_AUTH_TOKEN is set (CI / Vercel env).
// `sourcemaps.deleteSourcemapsAfterUpload: true` prevents serving the maps
// publicly while still uploading them to Sentry (replaces v8's
// `hideSourceMaps`). `widenClientFileUpload: true` includes the
// Next runtime chunks so router transitions also resolve.
export default withSentryConfig(withPayload(nextConfig), {
  silent: !process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
  widenClientFileUpload: true,
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
})
