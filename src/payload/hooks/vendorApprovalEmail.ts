import type { CollectionAfterChangeHook } from 'payload'

/**
 * Sends the vendor welcome email when the vendor.status transitions
 * from pending → active. Idempotent: fires only on the transition.
 *
 * The recipient is the first User with role='vendor' linked to this
 * vendor. If no such user exists yet (the vendor account hasn't been
 * created in /admin), we no-op and log — admin onboarding step.
 */
export const vendorApprovalEmailHook: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  req,
  operation,
}) => {
  // K3 (round-5 M4) — only send the welcome email on the genuine
  // approval path `pending → active`. The previous gate `!wasActive`
  // also re-sent the email on `paused → active` and `banned → active`,
  // which confused vendors ("your application has been approved!" the
  // second time looks like an admin error).
  if (operation !== 'update') return doc
  const isInitialApproval =
    previousDoc?.status === 'pending' && doc?.status === 'active'
  if (!isInitialApproval) return doc

  try {
    const { sendVendorApproved } = await import('@/lib/email')
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

    const vendorUserResult = await req.payload.find({
      collection: 'users',
      where: { and: [{ role: { equals: 'vendor' } }, { vendor: { equals: doc.id } }] },
      limit: 1,
      depth: 0,
    })
    const recipient = vendorUserResult.docs[0]?.email
    if (!recipient) {
      req.payload.logger?.info?.(
        `[vendor] approved ${doc.name} but no linked user — create one in /admin to send welcome.`,
      )
      return doc
    }

    await sendVendorApproved({
      to: recipient,
      props: {
        vendorName: doc.name,
        storefrontUrl: `${siteUrl}/vendors/${doc.slug}`,
        signInUrl: `${siteUrl}/sign-in?next=/vendor`,
        siteUrl,
      },
    })
    req.payload.logger?.info?.(`[vendor] welcome email sent for ${doc.name}`)
  } catch (err) {
    req.payload.logger?.error?.(`[vendor] approval email failed: ${(err as Error).message}`)
  }
  return doc
}
