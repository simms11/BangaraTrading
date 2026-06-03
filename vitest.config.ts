import { defineConfig } from 'vitest/config'
import path from 'node:path'

const srcDir = path.resolve(__dirname, 'src')

/**
 * Vitest config for integration tests on the money path.
 *
 * Aliases mirror the tsconfig paths block manually rather than via the
 * `vite-tsconfig-paths` plugin, which is ESM-only and won't load through
 * Vite's CJS config bundler under the current Node version.
 *
 * Why these knobs:
 *   - singleThread: each test wipes shared DB tables, so we must not run
 *     them in parallel against the same database.
 *   - testTimeout: Payload's first init pushes schema and can take a few
 *     seconds.
 *   - setupFiles: stubs `server-only`, mounts Payload once, exposes the
 *     truncate-before-each hook.
 *   - resolve.alias['server-only']: the npm `server-only` package throws
 *     when imported outside the `react-server` condition. Vitest runs as
 *     a plain Node process, so we shim it to an empty module.
 */
export default defineConfig({
  resolve: {
    alias: [
      {
        find: 'server-only',
        replacement: path.resolve(__dirname, 'tests/integration/stubs/server-only.ts'),
      },
      { find: '@payload-config', replacement: path.resolve(srcDir, 'payload.config.ts') },
      { find: /^@\/(.*)$/, replacement: path.join(srcDir, '$1') },
    ],
  },
  test: {
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['tests/integration/setup.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Critical: every file shares one Postgres DB. fileParallelism: false
    // makes Vitest run files sequentially (without it, a test file can
    // truncate the DB while another's test is mid-insert and we hit
    // FK violations on freshly-deleted vendors). pool: 'forks' + singleFork
    // additionally guarantees no test runs in parallel even at the in-file
    // level — Payload's `getPayload()` caches the connection, and we want
    // one cached client per run.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    sequence: {
      concurrent: false,
    },
  },
})
