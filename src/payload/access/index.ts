import type { Access, FieldAccess, Where } from 'payload'

export const isAdmin: Access = ({ req: { user } }) => user?.role === 'admin'

export const isAdminOrSelf: Access = ({ req: { user }, id }) => {
  if (!user) return false
  if (user.role === 'admin') return true
  // R11 — normalize both sides. Payload's REST PATCH path can present
  // the id as a string while user.id is a number under the postgres
  // adapter; a strict `===` would then return false and incorrectly
  // deny a self-update.
  return String(user.id) === String(id)
}

export const isAdminOrVendor: Access = ({ req: { user } }) => {
  if (!user) return false
  return user.role === 'admin' || user.role === 'vendor'
}

export const isAdminFieldAccess: FieldAccess = ({ req: { user } }) => user?.role === 'admin'

export const publicRead: Access = () => true

/**
 * Audit-driven scoped-update access for collections where a vendor user
 * may only modify their *own* row. `isAdminOrVendor` checks role only and
 * was the root cause of the vendor-payout-hijack bug: a logged-in vendor A
 * could PATCH vendor B's record and overwrite payout details, name, slug,
 * etc. Use this whenever the row's primary identity matches the user's
 * `vendor` relationship.
 */
export const isAdminOrOwnVendor: Access = ({ req: { user } }) => {
  if (!user) return false
  if (user.role === 'admin') return true
  if (user.role === 'vendor' && user.vendor) {
    const vendorId = typeof user.vendor === 'object' ? user.vendor.id : user.vendor
    return { id: { equals: vendorId } } as Where
  }
  return false
}
