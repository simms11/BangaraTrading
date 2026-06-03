/**
 * M16 regression — admin-reports page must surface report.truncated.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('M16 — admin-reports page renders the truncated banner', () => {
  it('references report.truncated and a Data-truncated string in the page source', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/app/(staff)/admin-reports/page.tsx'),
      'utf8',
    )
    expect(src).toMatch(/report\.truncated/)
    expect(src).toMatch(/Data truncated/i)
  })
})
