#!/usr/bin/env node
// Bundle-size regression check.
//
// Reads `next build` output (passed as argv[2]) and asserts:
//   1. "First Load JS shared by all" is at or below SHARED_BUDGET_KB.
//   2. Middleware payload is at or below MIDDLEWARE_BUDGET_KB.
//
// Fails the build if either budget is exceeded — keeps the perf bar honest.

import { readFileSync } from 'node:fs'

const SHARED_BUDGET_KB = 120 // current is ~101 KB; 20 KB headroom for additions
const MIDDLEWARE_BUDGET_KB = 80 // current is ~57 KB; rate-limit + CSRF + Upstash

const logPath = process.argv[2] || 'build.log'
const log = readFileSync(logPath, 'utf8')

const failures = []

const sharedMatch = log.match(/First Load JS shared by all\s+([\d.]+)\s*kB/)
if (!sharedMatch) {
  console.error("Couldn't find shared-JS line in build output. Did the build run?")
  process.exit(2)
}
const sharedKb = Number(sharedMatch[1])
if (sharedKb > SHARED_BUDGET_KB) {
  failures.push(
    `Shared JS: ${sharedKb} KB > ${SHARED_BUDGET_KB} KB budget. ` +
      `Recent commits added weight to every page load — investigate.`,
  )
}

const middlewareMatch = log.match(/Middleware\s+([\d.]+)\s*kB/)
if (middlewareMatch) {
  const middlewareKb = Number(middlewareMatch[1])
  if (middlewareKb > MIDDLEWARE_BUDGET_KB) {
    failures.push(
      `Middleware: ${middlewareKb} KB > ${MIDDLEWARE_BUDGET_KB} KB budget.`,
    )
  }
} // No middleware? Fine — older versions of Next didn't emit one.

if (failures.length) {
  console.error(`\n✗ Bundle budget exceeded:\n  - ${failures.join('\n  - ')}\n`)
  process.exit(1)
}

console.log(
  `✓ Bundle budgets OK: shared ${sharedKb} KB (≤${SHARED_BUDGET_KB})` +
    (middlewareMatch ? `, middleware ${Number(middlewareMatch[1])} KB (≤${MIDDLEWARE_BUDGET_KB})` : ''),
)
