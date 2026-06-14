#!/usr/bin/env node
// Bundle-size regression check.
//
// Asserts:
//   1. First Load JS shared by all pages is at or below SHARED_BUDGET_KB.
//   2. Middleware/proxy edge bundle is at or below MIDDLEWARE_BUDGET_KB.
// Fails the build if either budget is exceeded — keeps the perf bar honest.
//
// Measurement basis (changed 2026-06-14 with the Next 15 -> 16 upgrade):
//   Next 16 no longer prints per-route / "First Load JS shared by all" sizes
//   to `next build` stdout (even with --debug), so the old log-scraping
//   approach has nothing to parse. We now measure straight from the build
//   artifacts under .next:
//     - shared      = combined-gzip of build-manifest.json `rootMainFiles`
//                     (the chunks every page loads).
//     - middleware  = combined-gzip of the middleware function's edge chunks
//                     from server/middleware-manifest.json.
//   "Combined gzip" (concatenate, gzip once) mirrors how a first-load payload
//   actually compresses on the wire, rather than summing per-file gzip.
//
// Run after `next build` (the .next dir must exist). Optional argv[2] is the
// build dir, default ".next". A leftover build.log path is ignored.
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

// Re-baselined 2026-06-14 for Next 16 + Turbopack (the default builder in 16):
//   shared ~306 KB (was ~289 KB on Next 15 / webpack), middleware ~210 KB
//   (was ~142 KB). The middleware jump is Turbopack's larger edge runtime
//   split, not new app code. Sentry SDK (10) still dominates both. TODO:
//   investigate lazy-loading the client SDK / trimming the edge bundle, then
//   lower these budgets.
const SHARED_BUDGET_KB = 320 // current ~306 KB
const MIDDLEWARE_BUDGET_KB = 240 // current ~210 KB

const arg = process.argv[2]
// Back-compat: old CI passed `build.log`; ignore it and use the default dir.
const buildDir = !arg || arg.endsWith('.log') ? '.next' : arg

function combinedGzipKb(files, base) {
  const bufs = []
  for (const f of files) {
    try {
      bufs.push(readFileSync(join(base, f)))
    } catch {
      // A listed chunk that isn't on disk just doesn't contribute weight.
    }
  }
  if (!bufs.length) return null
  return gzipSync(Buffer.concat(bufs)).length / 1024
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

const failures = []

// --- Shared first-load JS ---
let buildManifest
try {
  buildManifest = readJson(join(buildDir, 'build-manifest.json'))
} catch {
  console.error(
    `Couldn't read ${join(buildDir, 'build-manifest.json')}. Did "next build" run?`,
  )
  process.exit(2)
}
const sharedKb = combinedGzipKb(buildManifest.rootMainFiles ?? [], buildDir)
if (sharedKb == null) {
  console.error('build-manifest.json has no rootMainFiles — unexpected build output.')
  process.exit(2)
}
if (sharedKb > SHARED_BUDGET_KB) {
  failures.push(
    `Shared JS: ${sharedKb.toFixed(1)} KB > ${SHARED_BUDGET_KB} KB budget. ` +
      `Recent commits added weight to every page load — investigate.`,
  )
}

// --- Middleware / proxy edge bundle (optional: only if middleware exists) ---
let middlewareKb = null
try {
  const mw = readJson(join(buildDir, 'server', 'middleware-manifest.json'))
  const entry = mw.middleware?.['/'] ?? Object.values(mw.middleware ?? {})[0]
  if (entry?.files?.length) {
    middlewareKb = combinedGzipKb(entry.files, buildDir)
    if (middlewareKb != null && middlewareKb > MIDDLEWARE_BUDGET_KB) {
      failures.push(
        `Middleware: ${middlewareKb.toFixed(1)} KB > ${MIDDLEWARE_BUDGET_KB} KB budget.`,
      )
    }
  }
} catch {
  // No middleware manifest — app has no middleware. Fine.
}

if (failures.length) {
  console.error(`\n✗ Bundle budget exceeded:\n  - ${failures.join('\n  - ')}\n`)
  process.exit(1)
}

console.log(
  `✓ Bundle budgets OK: shared ${sharedKb.toFixed(1)} KB (≤${SHARED_BUDGET_KB})` +
    (middlewareKb != null
      ? `, middleware ${middlewareKb.toFixed(1)} KB (≤${MIDDLEWARE_BUDGET_KB})`
      : ''),
)
