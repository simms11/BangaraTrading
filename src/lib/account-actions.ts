'use server'

import { nanoid } from 'nanoid'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getPayload } from '@/lib/payload'
import { audit } from '@/lib/audit'

/**
 * K5 (round-5 privacy C1) — GDPR / POPIA "right to erasure".
 *
 * The /privacy page promises customers a 30-day deletion path, but until
 * now the only mechanism was an ops email. This server action implements
 * the canonical anonymisation pattern:
 *
 *   - Users row stays (preserves FK integrity for Orders / Quotes /
 *     AuditLog) but email/name/phone/marketing flag are scrubbed.
 *   - Email is replaced with a deterministic `deleted-<nanoid>@…` so the
 *     unique constraint is honored and the original email is irrecoverable.
 *   - Orders are NOT deleted (tax/financial-records retention requires
 *     7-year hold per /privacy:124) but their `customer` relation stays
 *     pointing at the anonymised row; PII on the order itself
 *     (shippingAddress) is independently retention-policy-bound.
 *   - Vendor accounts are NOT deletable via this path — vendor offboarding
 *     is an admin-mediated process that includes payout finalisation.
 *
 * Side effects:
 *   - Audit-log row recording the deletion (subject = anonymised user id).
 *   - User signed out (payload-token cookie cleared).
 *
 * This is intentionally a one-way action with NO confirmation step in
 * server-action form. Customer-facing UI should add a "type your email
 * to confirm" gate.
 */
export type AccountDeletionState = { error?: string } | null

export async function requestAccountDeletionAction(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prev: AccountDeletionState,
): Promise<AccountDeletionState> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Not signed in.' }
  if (user.role === 'admin') {
    return { error: 'Admin accounts cannot be deleted via self-service. Contact engineering.' }
  }
  if (user.role === 'vendor') {
    return {
      error:
        'Vendor accounts require manual offboarding (payout finalisation, product archival). Contact enquiry@bangarahtradingenterprises.com.',
    }
  }
  const payload = await getPayload()
  const anonHandle = `deleted-${nanoid(12).toLowerCase()}@bangarah.local`
  try {
    await payload.update({
      collection: 'users',
      id: user.id,
      overrideAccess: true,
      data: {
        email: anonHandle,
        name: 'Deleted user',
        phone: null,
        marketingOptIn: false,
        // Rotate to a random password so the original credential no
        // longer authenticates. Payload's auth hashes this; the user
        // can never sign in to the anonymised account.
        password: nanoid(32),
      },
    })
    await audit({
      payload,
      // M5 (Phase 2) — was misfiled as `order.status_changed`, which
      // made the deletion record undiscoverable to compliance queries
      // on the audit-log kind index. POPIA s.23 / GDPR Art. 17 require
      // a discoverable record of the action.
      kind: 'user.deleted',
      subjectType: 'users',
      subjectId: String(user.id),
      diff: { before: { email: '[REDACTED]', name: '[REDACTED]' }, after: { email: anonHandle } },
      notes: 'Self-service account deletion (GDPR/POPIA).',
    })
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not process deletion. Please contact support.' }
  }
  // Clear the auth cookie and redirect to the home page.
  const jar = await cookies()
  jar.delete('payload-token')
  redirect('/?deleted=1')
}
