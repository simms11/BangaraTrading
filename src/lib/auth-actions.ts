'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getPayload } from '@/lib/payload'
// J6 (round-4): use the shared display-safety predicate which also
// rejects bidi-control + zero-width chars (U+202E, U+200B, etc.) usable
// for visual brand impersonation. Previously per-file inline regex.
import { noDangerousChars as noControlChars } from '@/lib/utils'

const PAYLOAD_TOKEN_COOKIE = 'payload-token'

function landingForRole(role?: string): string {
  if (role === 'admin') return '/admin'
  if (role === 'vendor') return '/vendor'
  return '/account'
}

const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(128),
})

const signUpSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .refine(noControlChars, 'Invalid characters in name.'),
  email: z.string().email(),
  password: z.string().min(8).max(128),
})

/**
 * H8 (M4) — only allow same-origin relative paths in the `next=` redirect
 * query param. Previously `startsWith('/') && !startsWith('//')` blocked
 * `//evil.com` but not `/\evil.com`. Browsers normalize backslash to
 * forward-slash post-redirect, so the URL becomes `//evil.com` and we
 * cross-origin. We also reject `\\`, `:`, control chars, and any value
 * whose URL parse yields a host.
 */
function safeRelativePath(next: string): string | null {
  if (!next) return null
  if (!/^\/[^/\\]/.test(next)) return null
  if (/[\x00-\x1F\x7F]/.test(next)) return null
  return next
}

export type AuthFormState = { error?: string } | null

function setAuthCookie(token: string, exp?: number) {
  // We mirror the JWT into the standard payload-token cookie used by Payload's
  // auth resolver. Same cookie name Payload uses for /admin sessions.
  const cookieStore = cookies()
  return cookieStore.then((jar) =>
    jar.set({
      name: PAYLOAD_TOKEN_COOKIE,
      value: token,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      // exp is unix seconds; cookie maxAge is seconds from now. Clamp the
      // ceiling at 24h to match the tokenExpiration we set in Users.auth.
      maxAge: exp ? Math.max(60, exp - Math.floor(Date.now() / 1000)) : 60 * 60 * 24,
    }),
  )
}

export async function signInAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) return { error: 'Please enter a valid email and password.' }

  let destination = '/account'
  try {
    const payload = await getPayload()
    const result = await payload.login({
      collection: 'users',
      data: { email: parsed.data.email, password: parsed.data.password },
    })
    if (!result?.token) return { error: 'Invalid email or password.' }
    await setAuthCookie(result.token, result.exp)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    destination = landingForRole((result.user as any)?.role)
  } catch (e) {
    // H8 (M5) — surface only the generic message. The previous code passed
    // through Payload's "User is locked" string which was an account-
    // existence + lockout-enumeration oracle. Lockout still functions
    // server-side via Payload's built-in attempt counter.
    //
    // I6 (M4) — log the underlying error for ops visibility BEFORE the
    // early return. The previous version had `void e` after a `return`,
    // which is unreachable — real auth failures vanished into the void.
    console.warn('[signin] failure:', e instanceof Error ? e.message : String(e))
    return { error: 'Invalid email or password.' }
  }

  // H8 (M4): only same-origin relative paths.
  const safe = safeRelativePath(String(formData.get('next') ?? ''))
  if (safe) destination = safe
  redirect(destination)
}

export async function signUpAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    return { error: 'Name, valid email and password (min 8 chars) are required.' }
  }
  try {
    const payload = await getPayload()
    await payload.create({
      collection: 'users',
      overrideAccess: true,
      data: {
        name: parsed.data.name,
        email: parsed.data.email,
        password: parsed.data.password,
        role: 'customer',
      },
    })
    const result = await payload.login({
      collection: 'users',
      data: { email: parsed.data.email, password: parsed.data.password },
    })
    if (!result?.token) {
      // Account exists or sign-in failed for another reason. Don't leak which.
      return { error: 'Could not create account. Try signing in instead.' }
    }
    await setAuthCookie(result.token, result.exp)
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    // Email uniqueness violation: don't enumerate accounts. Steer the user to sign-in.
    if (msg.toLowerCase().includes('unique') || msg.toLowerCase().includes('duplicate')) {
      return {
        error:
          'If that email is available, an account was created. Otherwise try signing in or resetting your password.',
      }
    }
    console.warn('[signup] failure:', msg)
    return { error: 'Could not create account. Please try again.' }
  }
  // Clean-room frontend — honour a same-origin `next` destination so a
  // guest sent to sign-up mid-checkout returns to checkout instead of
  // always landing on /account. Same safe-relative-path guard as sign-in.
  const safeNext = safeRelativePath(String(formData.get('next') ?? ''))
  // Sign-up always creates a customer; vendor accounts are admin-provisioned.
  redirect(safeNext ?? '/account')
}

/**
 * M2 (round-6) — admin "log out everywhere" action. Forces every JWT
 * issued to a target user to invalidate by deleting all rows in
 * users_sessions for them. The Users.afterChange hook already does
 * this on role change; this exposes it as a standalone admin lever for
 * incident response (e.g., a vendor's laptop is stolen, an admin
 * suspects credential leak).
 *
 * Caller must be an authenticated admin. We re-read role from the DB
 * via getCurrentUser so a freshly-demoted admin can't still trigger it.
 */
export async function adminLogoutEverywhereAction(targetUserId: number | string): Promise<{
  ok: boolean
  revoked?: number
  error?: string
}> {
  const { getCurrentUser } = await import('@/lib/auth')
  const me = await getCurrentUser()
  if (!me || me.role !== 'admin') return { ok: false, error: 'Forbidden' }
  if (!targetUserId) return { ok: false, error: 'Missing user id' }
  try {
    const payload = await getPayload()
    const { revokeUserSessions } = await import('@/lib/user-sessions')
    const result = await revokeUserSessions(payload, targetUserId)
    if ('error' in result) return { ok: false, error: 'Database unavailable' }
    // Also invalidate the in-process freshness cache so any cached
    // "is admin" reads for the target user are dropped immediately.
    try {
      const { invalidateUserAuthCache } = await import('@/lib/auth')
      invalidateUserAuthCache(targetUserId)
    } catch {
      // non-fatal
    }
    try {
      const { audit } = await import('@/lib/audit')
      await audit({
        payload,
        kind: 'user.sessions_revoked',
        subjectType: 'users',
        subjectId: String(targetUserId),
        notes: `Admin ${me.email} forced logout-everywhere — ${result.revoked} session(s) revoked.`,
      })
    } catch {
      // audit never throws
    }
    return { ok: true, revoked: result.revoked }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed' }
  }
}

export async function signOutAction() {
  // M1 (round-6 C1) — with `useSessions: true` on Users, the cookie is
  // only half the auth. The session row in users_sessions persists
  // until the natural 24h expiry; deleting only the cookie leaves an
  // attacker who captured the JWT (XSS, shared device, network capture)
  // able to keep using it.
  //
  // We resolve the current user from the cookie, then delete all session
  // rows for them so every outstanding JWT (this browser + any other
  // device they were signed in on) invalidates immediately. Falling back
  // to cookie-only clear if the user can't be resolved.
  try {
    const { headers } = await import('next/headers')
    const h = await headers()
    const payload = await getPayload()
    const auth = await payload.auth({ headers: h })
    if (auth?.user?.id) {
      const { revokeUserSessions } = await import('@/lib/user-sessions')
      await revokeUserSessions(payload, auth.user.id)
      try {
        const { invalidateUserAuthCache } = await import('@/lib/auth')
        invalidateUserAuthCache(auth.user.id)
      } catch {
        // non-fatal
      }
    }
  } catch {
    // best-effort: cookie clear still happens below so the user sees
    // logout UI succeed even if session revocation hit a DB hiccup.
  }
  const jar = await cookies()
  jar.delete(PAYLOAD_TOKEN_COOKIE)
  redirect('/')
}
