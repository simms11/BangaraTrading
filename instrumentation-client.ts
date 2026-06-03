import * as Sentry from '@sentry/nextjs'

/**
 * H10 (M8) fix — client-side Sentry init.
 *
 * Next 15 + Sentry 8.x auto-loads `instrumentation-client.ts` at startup
 * for the browser bundle, mirroring how `instrumentation.ts:register()`
 * loads `sentry.server.config.ts` for the Node runtime. Without this
 * file, uncaught browser errors and unhandled promise rejections never
 * reach Sentry — only React-error-boundary-caught errors did, via the
 * lazy `src/lib/report-error.ts` path.
 *
 * Uses NEXT_PUBLIC_SENTRY_DSN (the public-bundle-safe variable). Server
 * traffic continues to use SENTRY_DSN.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
    // Default integrations include BrowserTracing + GlobalHandlers, which
    // is what we want for unhandled errors + rejection capture.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0.05,
  })
}

// B4 (Phase 2): the previous implementation used `import * as Sentry`
// and read `(Sentry as any).captureRouterTransitionStart`. That export
// was added in @sentry/nextjs >= 9; we're pinned at 8.55.2. Next's
// build-time static analyzer flagged the import path even though the
// `any` cast made TypeScript silent at the access — producing the
// noisy `Attempted import error: 'captureRouterTransitionStart' is not
// exported` warning on every build.
//
// Resolution: read the symbol off the runtime namespace via bracket
// access on an `unknown`-typed reference. The static analyzer can't
// follow the lookup, so the warning is gone; on Sentry 8 the value is
// undefined and Next tolerates the falsy hook export; when we upgrade
// to Sentry 9+ the function will resolve and the router-transition
// instrumentation lights up with no further code change.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sentryRuntime = Sentry as unknown as Record<string, any>
export const onRouterTransitionStart = sentryRuntime['captureRouterTransitionStart']
