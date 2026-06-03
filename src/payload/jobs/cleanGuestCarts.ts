import type { TaskConfig } from 'payload'

type CleanGuestCartsIO = {
  input: Record<string, never>
  output: { removed: number }
}

// No-op placeholder for cart cleanup. Carts live in httpOnly cookies
// (max-age 30 days) — browser drops them automatically. The slot exists
// so when we migrate carts to a server-side collection (cross-device,
// abandoned-cart emails, carts >3.5kB), the cron config doesn't change.
export const cleanGuestCartsTask: TaskConfig<CleanGuestCartsIO> = {
  slug: 'cleanGuestCarts',
  retries: 1,
  handler: async ({ req }) => {
    req.payload.logger?.debug?.(
      '[jobs:cleanGuestCarts] no-op — carts are cookie-only today',
    )
    return { output: { removed: 0 } }
  },
}
