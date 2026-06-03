/**
 * m21 (Phase 2) — allow-list check for the processor-returned redirect
 * URL before we hand it to `next/navigation`'s `redirect()`. Defense in
 * depth: today Stripe/Flutterwave return URLs we trust, but an SDK-
 * response tamper, a misconfigured processor, or a future processor
 * implementation with a buggy `link` field could route the user
 * elsewhere. The allow-list collapses that into "rejected, log,
 * fallback to siteUrl".
 *
 * Allowed:
 *   - Same host as our siteUrl (manual processor returns successUrl on
 *     our domain, plus the cancel branch).
 *   - `checkout.stripe.com` (Stripe Checkout hosted page).
 *   - Any `*.flutterwave.com` subdomain (Flutterwave hosted checkout
 *     served from checkout.flutterwave.com, ravesandboxapi.flutterwave.com,
 *     etc. — match by suffix).
 *
 * Rejected:
 *   - Different scheme (`javascript:`, `data:`, etc.).
 *   - Any host that isn't on the list.
 *   - Malformed input (returns false without throwing).
 */
export function isAllowedCheckoutRedirect(target: string, siteUrl: string): boolean {
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase()
  // Same-origin: our own site (manual processor path + safety fallback).
  try {
    const siteHost = new URL(siteUrl).hostname.toLowerCase()
    if (host === siteHost) return true
  } catch {
    // siteUrl malformed — skip but keep going so processor hosts still match.
  }
  // Stripe Checkout's hosted page.
  if (host === 'checkout.stripe.com') return true
  // Flutterwave: any subdomain of flutterwave.com. Suffix check guards
  // against `checkout.flutterwave.com.attacker.example` — `.endsWith`
  // requires the matched portion to include the leading `.` so the
  // attacker can't append their own domain.
  if (host === 'flutterwave.com' || host.endsWith('.flutterwave.com')) return true
  return false
}
