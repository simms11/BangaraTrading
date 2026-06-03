import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.PORT || 3000)
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: BASE_URL,
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_REUSE_SERVER
    ? undefined
    : {
        command: 'npm run dev',
        url: BASE_URL,
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
        env: {
          ...process.env,
          // The dev server needs these for Payload to boot.
          PAYLOAD_SECRET: process.env.PAYLOAD_SECRET || 'playwright-only-secret',
          DATABASE_URL:
            process.env.DATABASE_URL ||
            `postgres://${process.env.USER || 'postgres'}@localhost:5432/bangarah`,
          NEXT_PUBLIC_SITE_URL: BASE_URL,
        },
      },
})
