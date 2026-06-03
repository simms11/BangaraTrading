import type { CollectionConfig } from 'payload'
import { isAdmin, isAdminOrVendor, publicRead } from '../access'

export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    read: publicRead,
    create: isAdminOrVendor,
    // SECURITY (M5): admin-only edit/delete. Previous `isAdminOrVendor`
    // let vendor A delete/overwrite vendor B's product images (storefront
    // defacement) because the Media collection has no `uploadedBy`
    // ownership field. Adding ownership would require a schema migration;
    // restricting to admin is the surgical pre-launch fix. Vendors still
    // upload new media (create); cleanup of stale uploads is an ops task.
    update: isAdmin,
    delete: isAdmin,
  },
  fields: [
    { name: 'alt', type: 'text', required: true },
    { name: 'caption', type: 'text' },
  ],
  upload: {
    staticDir: 'media',
    imageSizes: [
      { name: 'thumbnail', width: 240, height: 240, position: 'centre' },
      { name: 'card', width: 640, height: 480, position: 'centre' },
      { name: 'feature', width: 1200, height: 900, position: 'centre' },
      { name: 'og', width: 1200, height: 630, position: 'centre' },
    ],
    // SECURITY (M15): explicit raster-image allow-list. The previous
    // `image/*` glob accepted `image/svg+xml`, and SVG can carry inline
    // <script> for stored XSS when a logged-in user opens the media URL
    // directly. Sharp resize fails on SVG anyway, but the wildcard
    // permitted the upload to be stored.
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    formatOptions: {
      format: 'webp',
      options: { quality: 82 },
    },
  },
  hooks: {
    beforeOperation: [
      // R7 round-7 reliability M5 — cap upload file size to 10MB.
      // Payload v3's upload config doesn't expose a built-in size limit
      // option, so we enforce it in the beforeOperation hook by reading
      // file.size. Without this, an authenticated vendor (or anyone
      // with isAdminOrVendor write access) could POST a 1GB image;
      // Sharp would load it into memory for the resize step and OOM-
      // kill the function, bricking subsequent uploads on the warm
      // instance until cold restart. 10MB is comfortable for product/
      // vendor photography (Sharp's webp output stays well under 1MB).
      async ({ operation, req }) => {
        if (operation !== 'create' && operation !== 'update') return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const file = (req.file as any) ?? (req as any).files?.[0]
        if (file?.size && file.size > 10_000_000) {
          throw new Error(
            `Upload refused: file size ${(file.size / 1_000_000).toFixed(1)}MB exceeds the 10MB limit.`,
          )
        }
      },
    ],
    // K4 (round-5 M9) — orphan-row cleanup. If R2 returns 5xx or the
    // upload stream is severed AFTER Payload inserts the Media row but
    // BEFORE the file lands in R2, the row stays in the DB pointing at
    // a key that doesn't exist. Subsequent reads serve a 404 from R2.
    // The s3Storage plugin doesn't do this by default. We catch the
    // first read of the file URL post-create by hooking afterChange
    // and logging an alert; the actual cleanup is done by an admin
    // sweeper task (not in scope) but the visibility is immediate.
    afterChange: [
      async ({ doc, operation, req }) => {
        if (operation !== 'create') return doc
        // Payload populates doc.filename only after the upload pipeline
        // succeeds; if it's missing, the upload failed.
        if (!doc?.filename) {
          req.payload.logger?.error?.(
            `[media] orphan row ${doc?.id}: no filename after create. R2 upload likely failed; row needs manual cleanup.`,
          )
          try {
            const Sentry = await import('@sentry/nextjs').catch(() => null)
            Sentry?.captureMessage(`Media orphan row id=${doc?.id}`, 'warning')
          } catch {
            // Sentry not available
          }
        }
        return doc
      },
    ],
  },
}
