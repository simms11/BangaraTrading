/**
 * m27 — default OG + Twitter image. Today the metadata declares
 * `card: 'summary_large_image'` with NO images, so LinkedIn / Slack /
 * WhatsApp / Twitter shares of the homepage, /shop, /vendors, etc.
 * render without preview imagery.
 *
 * Fix: Next 13+ App Router auto-discovers `src/app/opengraph-image.tsx`
 * and `src/app/twitter-image.tsx` files and injects the appropriate
 * `<meta>` tags. No metadata.images change needed. Both files must
 * exist and export a default async function that returns an
 * `ImageResponse`.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

describe('m27 — default OG + Twitter image files', () => {
  it('opengraph-image.tsx exists and uses ImageResponse', () => {
    const p = resolve(process.cwd(), 'src/app/opengraph-image.tsx')
    expect(existsSync(p)).toBe(true)
    const src = readFileSync(p, 'utf8')
    expect(src).toMatch(/ImageResponse/)
    expect(src).toMatch(/export default/)
    // Recommended OG dimensions.
    expect(src).toMatch(/1200/)
    expect(src).toMatch(/630/)
  })

  it('twitter-image.tsx exists', () => {
    const p = resolve(process.cwd(), 'src/app/twitter-image.tsx')
    expect(existsSync(p)).toBe(true)
    const src = readFileSync(p, 'utf8')
    // Either inline ImageResponse OR a re-export of `default` from
    // opengraph-image (the shared-renderer pattern).
    expect(src).toMatch(/ImageResponse|export default|export\s*\{[^}]*default/)
  })
})
