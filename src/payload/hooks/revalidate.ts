import type { CollectionAfterChangeHook, GlobalAfterChangeHook } from 'payload'

/**
 * B65: Bridge Payload CMS publish events to Next.js's ISR cache.
 *
 * Without these hooks, an editor publishes a product/page/vendor in the
 * admin and the public site keeps serving the stale ISR-cached version
 * until the next build (or until the route's revalidate window expires
 * naturally). With these hooks, `revalidatePath` purges the affected
 * routes within milliseconds of the save.
 *
 * `revalidatePath` is imported dynamically because:
 *   1. Payload hooks can run from non-Next contexts (CLI seed, jobs).
 *      The dynamic import lets those callers skip the route bridge with
 *      no module-load error.
 *   2. Avoids pulling `next/cache` into the Payload admin bundle when
 *      it's not needed there.
 */
async function safeRevalidate(paths: string[]): Promise<void> {
  try {
    const { revalidatePath } = await import('next/cache')
    for (const p of paths) {
      try {
        revalidatePath(p)
      } catch (err) {
        // M20: distinguish "outside a Next request context" (expected — CLI
        // seed, background job) from genuine failures (mistyped path,
        // revalidate API change). Both used to be silently swallowed; the
        // genuine-failure case meant publishes could fail to invalidate and
        // we'd never know. We log non-context errors at warn so they show
        // up in observability without spamming the seed/job path.
        const msg = (err as Error).message ?? ''
        if (
          msg.includes('Invariant') ||
          msg.includes('outside a request') ||
          msg.includes('static generation store')
        ) {
          // expected: not in a request — skip silently
          continue
        }
        console.warn(`[revalidate] failed to invalidate ${p}: ${msg}`)
      }
    }
  } catch (err) {
    // next/cache not available in this runtime — log so a misconfigured
    // deploy doesn't keep serving stale content unnoticed.
    console.warn(`[revalidate] next/cache unavailable: ${(err as Error).message}`)
  }
}

export const revalidateProduct: CollectionAfterChangeHook = async ({ doc, previousDoc, operation }) => {
  // R8 frontend M6 — the storefront listing route is `/shop`, not
  // `/products`. The previous set purged `/products` (not a real route)
  // so a newly published/unpublished product never refreshed the shop
  // grid until its ISR window expired — which is why `/shop` carried
  // `force-dynamic` to mask it. Purge the actual `/shop` route (and keep
  // `/products` harmlessly for any future detail-index).
  const paths = new Set<string>(['/', '/shop', '/products'])
  const slug = (doc as { slug?: string }).slug
  if (slug) paths.add(`/products/${slug}`)
  // If the slug changed, also purge the previous URL.
  const oldSlug = (previousDoc as { slug?: string } | undefined)?.slug
  if (operation === 'update' && oldSlug && oldSlug !== slug) {
    paths.add(`/products/${oldSlug}`)
  }
  // Vendor storefront listing changes when a vendor's products change.
  const vendor = (doc as { vendor?: number | { id: number; slug?: string } }).vendor
  if (vendor && typeof vendor === 'object' && vendor.slug) {
    paths.add(`/vendors/${vendor.slug}`)
  }
  await safeRevalidate([...paths])
  return doc
}

export const revalidateVendor: CollectionAfterChangeHook = async ({ doc, previousDoc, operation }) => {
  const paths = new Set<string>(['/', '/vendors'])
  const slug = (doc as { slug?: string }).slug
  if (slug) paths.add(`/vendors/${slug}`)
  const oldSlug = (previousDoc as { slug?: string } | undefined)?.slug
  if (operation === 'update' && oldSlug && oldSlug !== slug) {
    paths.add(`/vendors/${oldSlug}`)
  }
  await safeRevalidate([...paths])
  return doc
}

export const revalidatePage: CollectionAfterChangeHook = async ({ doc, previousDoc, operation }) => {
  const paths = new Set<string>(['/'])
  const slug = (doc as { slug?: string }).slug
  if (slug) paths.add(`/${slug}`)
  const oldSlug = (previousDoc as { slug?: string } | undefined)?.slug
  if (operation === 'update' && oldSlug && oldSlug !== slug) {
    paths.add(`/${oldSlug}`)
  }
  await safeRevalidate([...paths])
  return doc
}

export const revalidateSettings: GlobalAfterChangeHook = async ({ doc }) => {
  // Site-wide settings (header banners, contact info) — revalidate the
  // surfaces that read them.
  await safeRevalidate(['/', '/about', '/contact'])
  return doc
}
