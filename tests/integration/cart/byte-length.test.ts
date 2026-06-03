/**
 * M1 regression — writeCart's overflow guard must measure bytes (not
 * UTF-16 code units) so non-ASCII cart contents don't silently exceed
 * the browser's 4 KB cookie limit.
 *
 * Strategy: stub next/headers cookies() with an in-memory jar and call
 * writeCart with a payload that's small in UTF-16 .length but large in
 * UTF-8 bytes. The previous .length-based check let it through; the
 * fixed byteLength check throws CartTooLargeError.
 */
import { describe, it, expect, vi } from 'vitest'

const jar = new Map<string, string>()
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set: (opts: { name: string; value: string }) => {
      jar.set(opts.name, opts.value)
    },
    delete: (name: string) => {
      jar.delete(name)
    },
  }),
}))

describe('M1 — cart cookie overflow guard measures bytes, not code units', () => {
  it('rejects a cart whose JSON exceeds the byte cap (oversize with multi-byte content)', async () => {
    const { writeCart, CartTooLargeError } = await import('@/lib/cart/store')
    // Build a payload that's borderline in UTF-16 .length but well past
    // 3500 bytes once serialised in UTF-8. Each 4-byte emoji costs 4
    // bytes per char (vs JS `string.length` 2). Title repeated many
    // times stays well-formed JSON.
    const fatTitle = '🍯'.repeat(1500) // 1500 * 4 bytes = 6000 utf-8 bytes
    const cart = {
      id: 'cart-byte-probe',
      items: [
        {
          productId: 1,
          vendorId: 1,
          slug: 'p',
          title: fatTitle,
          unitPriceMinor: 1000,
          currency: 'NAD' as const,
          quantity: 1,
          fulfillmentMode: 'retail' as const,
          weightGrams: 100,
          snapshotAt: Date.now(),
        },
      ],
      currency: 'NAD' as const,
      updatedAt: Date.now(),
    }
    const serialised = JSON.stringify(cart)
    // Precondition that proves the byte-vs-codeunit discrepancy is real.
    expect(Buffer.byteLength(serialised, 'utf8')).toBeGreaterThan(serialised.length)
    expect(Buffer.byteLength(serialised, 'utf8')).toBeGreaterThan(3500)
    // The fix must throw CartTooLargeError on this payload.
    await expect(writeCart(cart)).rejects.toBeInstanceOf(CartTooLargeError)
  })
})
