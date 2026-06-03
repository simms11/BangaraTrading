import 'server-only'
import pino, { type Logger } from 'pino'

/**
 * Singleton pino logger.
 *
 * - JSON output in production (ingested by Vercel logs / Sentry breadcrumbs).
 * - Pretty output locally via NODE_ENV check.
 * - Always carries `service: 'bangarah-storefront'` + `env` so logs are
 *   self-describing in centralized aggregation.
 * - Optional request-id binding via `child({ traceId })` — used by
 *   instrumentation in src/instrumentation.ts to scope every request.
 */
let _logger: Logger | null = null

export function getLogger(): Logger {
  if (_logger) return _logger
  const isDev = process.env.NODE_ENV !== 'production'
  _logger = pino({
    level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
    base: {
      service: 'bangarah-storefront',
      env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown',
      version: process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label }
      },
    },
    redact: {
      // K5 (round-5 privacy M5) — also scrub user PII. Vercel project
      // logs are team-visible and retained ~30d; any path here gets
      // replaced with `[REDACTED]` in the JSON output. Pino redact uses
      // `*` (one segment) wildcards.
      paths: [
        'password',
        '*.password',
        'token',
        '*.token',
        'confirmationToken',
        '*.confirmationToken',
        'authorization',
        'cookie',
        'set-cookie',
        'req.headers.authorization',
        'req.headers.cookie',
        // Emails (including audit-log `actorEmail` per privacy review).
        'email',
        '*.email',
        'customerEmail',
        '*.customerEmail',
        'actorEmail',
        '*.actorEmail',
        'guestEmail',
        '*.guestEmail',
        'recipient',
        '*.recipient',
        // Phones.
        'phone',
        '*.phone',
        'customerPhone',
        '*.customerPhone',
        'contactPhone',
        '*.contactPhone',
        // Addresses — Payload group fields serialise as nested objects.
        'shippingAddress',
        '*.shippingAddress',
        'billingAddress',
        '*.billingAddress',
        // Payout details — bank account number / swift live in this group.
        'payout',
        '*.payout',
      ],
      censor: '[REDACTED]',
    },
  })
  return _logger
}

/**
 * Returns a child logger with a request-scoped trace id. Use in route
 * handlers, server actions, and webhook handlers so every log line that
 * follows a single request can be reassembled later.
 */
export function childLogger(traceId: string, extra: Record<string, unknown> = {}): Logger {
  return getLogger().child({ traceId, ...extra })
}
