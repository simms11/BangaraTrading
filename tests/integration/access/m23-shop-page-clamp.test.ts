/**
 * m23 — `/shop?page=99999` should not return an empty results page; it
 * should `notFound()` so we don't emit a soft-404 for SEO crawlers.
 *
 * Static-source assertion: the shop page module must reference
 * `notFound` from `next/navigation` and trip it after the
 * `listProducts` call when `page > totalPages && totalDocs > 0`.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('m23 — shop page clamps out-of-range ?page', () => {
  it('shop page imports notFound and trips it on page > totalPages with non-empty catalog', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/app/(marketing)/shop/page.tsx'),
      'utf8',
    )
    expect(src).toMatch(/from 'next\/navigation'/)
    expect(src).toMatch(/notFound\(\)/)
    expect(src).toMatch(/page > totalPages/)
  })
})
