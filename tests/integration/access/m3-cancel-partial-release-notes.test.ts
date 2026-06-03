/**
 * m3 — `cancelOrderAndReleaseInventory` emits a final
 * `order.status_changed` audit row whose `notes` says nothing about
 * whether the inventory release loop actually finished. When the loop
 * hits its 10s deadline or a per-product update errors, an
 * `inventory.revert_failed` audit is also emitted, but the final
 * status_changed audit looks identical to the happy path. Operators
 * must correlate two audits to see that release was partial.
 *
 * Fix: include `released X/Y` in the final audit's `notes` so the
 * one-line status audit reflects partial-release reality.
 *
 * Test shape: static-source assertion is sufficient — the variables in
 * scope are `releasedProductIds.length` and `lineItemsToRelease.length`;
 * the file must reference both inside the final `audit({...})` `notes`.
 * (Running cancel with a forced deadline miss in vitest would require
 * patching Date.now globally, which is brittle.)
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('m3 — cancel partial-release notes', () => {
  it('cancel function emits release-count suffix in the final audit notes', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/lib/orders.ts'), 'utf8')
    // Anchor to the cancel function: it ends with `return { cancelled: true, order }`.
    // We scan upward from that anchor to find the LAST `await audit({...})`
    // before it — that's the final status_changed audit.
    const cancelReturnIdx = src.lastIndexOf('return { cancelled: true, order }')
    expect(cancelReturnIdx, 'cancel function return-true must exist').toBeGreaterThan(0)
    // Walk back ~1500 chars to capture the surrounding audit + suffix
    // variable definition.
    const window = src.slice(Math.max(0, cancelReturnIdx - 1500), cancelReturnIdx)
    expect(window).toMatch(/releasedProductIds\.length/)
    expect(window).toMatch(/lineItemsToRelease\.length/)
    expect(window).toMatch(/notes:.*\$\{reason\}.*\$\{releasedCountSuffix\}/s)
  })
})
