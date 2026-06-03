/**
 * m15 — cron runner bearer-token check uses `===` rather than a
 * constant-time compare. Theoretical timing side channel on a 32+ char
 * secret; cheap to close with `timingSafeEqual`.
 *
 * Static-source assertion: the runnerAccess function must use
 * `timingSafeEqual` from `node:crypto` (with a prior length check to
 * avoid the throw on mismatched lengths) and must NOT do the raw
 * `=== ` comparison against the secret.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('m15 — cron bearer-token uses timingSafeEqual', () => {
  it('jobs/index.ts uses timingSafeEqual and not raw === for the bearer', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/payload/jobs/index.ts'),
      'utf8',
    )
    expect(src).toMatch(/timingSafeEqual/)
    // Confirm the old `=== \`Bearer \${expected}\`` form is gone.
    expect(src).not.toMatch(/auth === `Bearer \$\{expected\}`/)
  })
})
