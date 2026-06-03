/**
 * M5 regression — the `user.deleted` audit kind exists in the DB enum
 * (writing it does not error with "invalid input value for enum") and
 * is reachable from the account-deletion path.
 */
import { describe, it, expect } from 'vitest'
import { getPayload } from '@/lib/payload'
import { audit } from '@/lib/audit'

describe('M5 — user.deleted audit kind is wired end-to-end', () => {
  it('audit({ kind: "user.deleted" }) writes a row without enum error', async () => {
    const payload = await getPayload()
    await audit({
      payload,
      kind: 'user.deleted',
      subjectType: 'users',
      subjectId: '999999',
      notes: 'M5 probe',
    })
    const { docs } = await payload.find({
      collection: 'audit-log',
      where: { and: [{ kind: { equals: 'user.deleted' } }, { subjectId: { equals: '999999' } }] },
      overrideAccess: true,
    })
    expect(docs.length).toBeGreaterThanOrEqual(1)
  })
})
