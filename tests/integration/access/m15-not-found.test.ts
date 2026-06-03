/**
 * M15 regression — not-found.tsx must read cart + user and pass them to
 * SiteHeader. Static check on the source: ensure the file is async,
 * awaits readCart()/getCurrentUser(), and passes cartCount + isSignedIn
 * to SiteHeader (not the hard-coded zeros it had before).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('M15 — not-found.tsx propagates cart count and signed-in state', () => {
  const src = readFileSync(
    resolve(process.cwd(), 'src/app/not-found.tsx'),
    'utf8',
  )

  it('reads the live cart and user', () => {
    expect(src).toMatch(/readCart\(\)/)
    expect(src).toMatch(/getCurrentUser\(\)/)
  })

  it('uses an async component and passes computed props to SiteHeader', () => {
    expect(src).toMatch(/export\s+default\s+async\s+function/)
    // Either cartCount={…} or {…cartCount} — accept any pass-through.
    expect(src).toMatch(/cartCount\s*=\s*\{[^}]+\}/)
    expect(src).toMatch(/isSignedIn\s*=\s*\{[^}]+\}/)
  })
})
