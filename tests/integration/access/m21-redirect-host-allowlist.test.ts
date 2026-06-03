/**
 * m21 — `redirect(redirectTarget)` after processor checkout must
 * validate the host against an allow-list. Today the value is whatever
 * the processor SDK returned; an SDK-response tamper / a future
 * processor with a buggy implementation could redirect the user
 * elsewhere. Cheap defense-in-depth.
 *
 * Test: import `isAllowedCheckoutRedirect` from checkout-actions.ts (a
 * helper extracted by the fix) and verify it accepts our siteUrl,
 * checkout.stripe.com, and *.flutterwave.com, while rejecting
 * arbitrary hosts.
 */
import { describe, it, expect } from 'vitest'

describe('m21 — checkout redirect host allow-list', () => {
  it('accepts site, Stripe checkout, and Flutterwave hosts; rejects others', async () => {
    const { isAllowedCheckoutRedirect } = await import('@/lib/checkout-redirect')
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
    expect(isAllowedCheckoutRedirect(`${siteUrl}/orders/BGR-XYZ`, siteUrl)).toBe(true)
    expect(
      isAllowedCheckoutRedirect('https://checkout.stripe.com/c/pay/cs_test_abc', siteUrl),
    ).toBe(true)
    expect(
      isAllowedCheckoutRedirect('https://checkout.flutterwave.com/v3/hosted/pay/xyz', siteUrl),
    ).toBe(true)
    expect(
      isAllowedCheckoutRedirect('https://ravesandboxapi.flutterwave.com/pay/xyz', siteUrl),
    ).toBe(true)
    expect(isAllowedCheckoutRedirect('https://evil.example.com/pay', siteUrl)).toBe(false)
    expect(
      isAllowedCheckoutRedirect('https://checkout.stripe.com.evil.com/pay', siteUrl),
    ).toBe(false)
    expect(isAllowedCheckoutRedirect('javascript:alert(1)', siteUrl)).toBe(false)
    // Malformed input must not throw — it must return false.
    expect(isAllowedCheckoutRedirect('not a url', siteUrl)).toBe(false)
  })
})
