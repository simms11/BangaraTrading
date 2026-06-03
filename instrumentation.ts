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
