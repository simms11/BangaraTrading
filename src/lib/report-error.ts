'use client'

/**
 * Lazy error reporter — dynamic-imports Sentry only when called, so the SDK
 * never lands on the happy-path client bundle. Error boundaries call this
 * in `useEffect`, which only fires when an error has already happened.
 *
 * For server-side capture, error.tsx is a "use client" boundary; the
 * server-side Sentry init lives in `instrumentation.ts` (Node + Edge).
 */
export async function reportError(error: unknown): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return
  try {
    const Sentry = await import('@sentry/nextjs')
    if (!Sentry.isInitialized?.()) {
      Sentry.init({
        dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
        tracesSampleRate: 0.1,
        replaysSessionSampleRate: 0.0,
        replaysOnErrorSampleRate: 1.0,
        environment: process.env.NODE_ENV,
      })
    }
    Sentry.captureException(error)
  } catch {
    // If Sentry itself fails to load, fall back to console so we don't lose
    // the original error context.
    console.error('[bangarah:error-report]', error)
  }
}
