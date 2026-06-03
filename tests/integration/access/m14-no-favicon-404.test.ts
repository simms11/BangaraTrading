/**
 * M14 regression — root metadata must not reference favicon paths that
 * don't exist under public/. Either the icons block is absent (let
 * Next's file-based convention apply when assets are added), or every
 * referenced path is an actual file in public/.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('M14 — root metadata does not 404 on declared icons', () => {
  it('every /-prefixed path that appears inside the metadata block resolves under public/', () => {
    // Read the layout source as text (importing the module loads
    // next/font which can't run under vitest's node env). Scan the
    // `metadata` object literal for any '/foo' string references and
    // assert each one exists under public/.
    const src = readFileSync(
      resolve(process.cwd(), 'src/app/layout.tsx'),
      'utf8',
    )
    const metaStart = src.indexOf('export const metadata')
    expect(metaStart).toBeGreaterThan(-1)
    // Take the rest of the file (metadata is the last export); good
    // enough for this static check.
    const block = src.slice(metaStart)
    const paths = Array.from(block.matchAll(/['"](\/[^'"\s]+\.(?:ico|png|jpg|svg|webp))['"]/g))
      .map((m) => m[1])
    for (const p of paths) {
      const onDisk = resolve(process.cwd(), 'public', p.replace(/^\//, ''))
      expect(existsSync(onDisk), `metadata references ${p} but the file is missing under public/`).toBe(true)
    }
  })
})
