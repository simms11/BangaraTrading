import type { Instrumentation } from 'next'

export async function register() {
  if (process.env.SENTRY_DSN) {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
      await import('./sentry.server.config')
    }
    if (process.env.NEXT_RUNTIME === 'edge') {
      await import('./sentry.edge.config')
    }
  }
  // Pino logger is lazy-initialized on first use via getLogger() — no
  // explicit register here. The structured-logger contract is documented
  // in src/lib/logger.ts.
}

// Sentry 9+ instruments nested React Server Component errors through Next's
// onRequestError hook; without this export the build warns that the SDK
// configuration is outdated. Lazy import keeps parity with register() above
// (no Sentry module load when SENTRY_DSN is unset).
export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (process.env.SENTRY_DSN && process.env.NEXT_RUNTIME === 'nodejs') {
    const Sentry = await import('@sentry/nextjs')
    Sentry.captureRequestError(...args)
  }
}
