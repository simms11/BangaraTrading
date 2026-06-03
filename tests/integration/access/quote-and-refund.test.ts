/**
 * Integration tests for the quote-acceptance token gate (C2) and refund
 * guards (M2). Both came from the deep-audit pass; we exercise them at
 * the same layer the bug would be triggered.
 */
import { describe, it, expect } from 'vitest'
import { getPayload } from '@/lib/payload'
import {
  acceptQuoteAndCreateOrder,
  createQuoteFromCart,
} from '@/lib/quotes'
import {
  createOrderFromCart,
  markOrderPaid,
} from '@/lib/orders'
import {
  createProduct,
  cartFor,
  TEST_ADDRESS,
} from '../helpers/fixtures'
import type { Quote } from '@/payload-types'

async function seedQuotedQuote(): Promise<Quote> {
  // Create a quote (status: submitted), then move to 'quoted' with per-line
  // pricing via admin context (overrideAccess). That mirrors what an
  // operator does in the admin UI before the customer accepts.
  const product = await createProduct({
    quantity: 10,
    fulfillmentMode: 'quote',
  })
  const payload = await getPayload()
  const quote = (await createQuoteFromCart({
    cart: cartFor([{ product, quantity: 5 }]),
    customerName: 'Buyer Co',
    customerEmail: 'buyer@example.com',
  })) as unknown as Quote
  await payload.update({
    collection: 'quotes',
    id: quote.id,
    overrideAccess: true,
    data: {
      status: 'quoted',
      items: (quote.items ?? []).map((it) => ({
        ...it,
        unitPriceQuoteMinor: 5_000,
      })),
      totalEstimateMinor: 25_000,
    },
  })
  return (await payload.findByID({
    collection: 'quotes',
    id: quote.id,
    overrideAccess: true,
  })) as unknown as Quote
}

describe('Quote acceptance token gate (C2)', () => {
  it('refuses acceptance with a missing token', async () => {
    const quote = await seedQuotedQuote()
    const result = await acceptQuoteAndCreateOrder({
      quoteNumber: quote.quoteNumber,
      confirmationToken: '',
      shipping: TEST_ADDRESS,
      billingSameAsShipping: true,
    })
    expect(result.ok).toBe(false)
  })

  it('refuses acceptance with a wrong token', async () => {
    const quote = await seedQuotedQuote()
    const result = await acceptQuoteAndCreateOrder({
      quoteNumber: quote.quoteNumber,
      confirmationToken: 'definitely-not-the-real-token-1234567890',
      shipping: TEST_ADDRESS,
      billingSameAsShipping: true,
    })
    expect(result.ok).toBe(false)
  })

  it('accepts with the correct token', async () => {
    const quote = await seedQuotedQuote()
    const result = await acceptQuoteAndCreateOrder({
      quoteNumber: quote.quoteNumber,
      confirmationToken: quote.confirmationToken,
      shipping: TEST_ADDRESS,
      billingSameAsShipping: true,
    })
    expect(result.ok).toBe(true)
  })

  it('refuses a token of the wrong length and uses timingSafeEqual', async () => {
    // M4 (round-6): the previous test was named "without timing leak" but
    // could only observe the boolean outcome — it never verified the
    // production code actually uses timingSafeEqual. We split the check
    // into two assertions: (1) function-level: wrong token is rejected;
    // (2) implementation-level: the code path uses Node's timing-safe
    // comparator (string search of the underlying source). The latter
    // catches a future "let's just use ===" regression.
    const quote = await seedQuotedQuote()
    const result = await acceptQuoteAndCreateOrder({
      quoteNumber: quote.quoteNumber,
      confirmationToken: 'short',
      shipping: TEST_ADDRESS,
      billingSameAsShipping: true,
    })
    expect(result.ok).toBe(false)
    // Implementation-level guard against constant-time-comparison
    // regression. The function reads the quote, then compares tokens —
    // it must do so through timingSafeEqual.
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const src = await fs.readFile(
      path.resolve(process.cwd(), 'src/lib/quotes.ts'),
      'utf8',
    )
    expect(src).toMatch(/timingSafeEqual/)
  })

  it('refuses a same-length token without divulging which characters differ', async () => {
    // M4 (round-6): paired with the implementation-level check above —
    // a same-length wrong token must still be rejected. With === we'd
    // also reject, so this alone doesn't prove timing-safety, but
    // combined with the source-grep above it does.
    const quote = await seedQuotedQuote()
    const sameLengthWrong = 'a'.repeat(quote.confirmationToken.length)
    const result = await acceptQuoteAndCreateOrder({
      quoteNumber: quote.quoteNumber,
      confirmationToken: sameLengthWrong,
      shipping: TEST_ADDRESS,
      billingSameAsShipping: true,
    })
    expect(result.ok).toBe(false)
  })
})

describe('Refund collection guards (M2)', () => {
  async function seedPaidOrder() {
    const product = await createProduct({ quantity: 5 })
    const order = await createOrderFromCart({
      cart: cartFor([{ product, quantity: 2 }]),
      customerEmail: 'buyer@test.local',
      shipping: TEST_ADDRESS,
      billing: TEST_ADDRESS,
      shippingMethodId: 'pickup',
    })
    await markOrderPaid(order.id, {
      processor: 'stripe',
      processorRef: `cs_${order.orderNumber}`,
      processorIntentRef: `pi_${order.orderNumber}`,
    })
    return order
  }

  it('refuses a refund larger than the order total', async () => {
    const order = await seedPaidOrder()
    const payload = await getPayload()
    let threw = false
    try {
      await payload.create({
        collection: 'refunds',
        overrideAccess: true,
        data: {
          reference: 're_over_refund',
          order: order.id,
          status: 'pending',
          amountMinor: order.totalMinor * 10,
          currency: order.currency,
          reason: 'requested_by_customer',
          processor: 'manual',
        },
      })
    } catch (e) {
      threw = /exceeds order total/i.test((e as Error).message)
    }
    expect(threw).toBe(true)
  })

  it('refuses a refund whose currency does not match the order', async () => {
    const order = await seedPaidOrder()
    const payload = await getPayload()
    let threw = false
    try {
      await payload.create({
        collection: 'refunds',
        overrideAccess: true,
        data: {
          reference: 're_currency_mismatch',
          order: order.id,
          status: 'pending',
          amountMinor: 100,
          currency: order.currency === 'USD' ? 'NAD' : 'USD',
          reason: 'requested_by_customer',
          processor: 'manual',
        },
      })
    } catch (e) {
      threw = /currency/i.test((e as Error).message)
    }
    expect(threw).toBe(true)
  })

  it('refuses a refund against an unpaid (pending_payment) order', async () => {
    const product = await createProduct({ quantity: 5 })
    const order = await createOrderFromCart({
      cart: cartFor([{ product, quantity: 1 }]),
      customerEmail: 'unpaid@test.local',
      shipping: TEST_ADDRESS,
      billing: TEST_ADDRESS,
      shippingMethodId: 'pickup',
    })
    const payload = await getPayload()
    let threw = false
    try {
      await payload.create({
        collection: 'refunds',
        overrideAccess: true,
        data: {
          reference: 're_unpaid',
          order: order.id,
          status: 'pending',
          amountMinor: 100,
          currency: order.currency,
          reason: 'requested_by_customer',
          processor: 'manual',
        },
      })
    } catch (e) {
      threw = /not paid|pending_payment|cancelled/i.test((e as Error).message)
    }
    expect(threw).toBe(true)
  })

  it('refuses marking a refund completed without a processorRef', async () => {
    const order = await seedPaidOrder()
    const payload = await getPayload()
    const refund = (await payload.create({
      collection: 'refunds',
      overrideAccess: true,
      data: {
        reference: 're_no_processor',
        order: order.id,
        status: 'pending',
        amountMinor: 100,
        currency: order.currency,
        reason: 'requested_by_customer',
        processor: 'manual',
      },
    })) as { id: number }
    let threw = false
    try {
      await payload.update({
        collection: 'refunds',
        id: refund.id,
        overrideAccess: true,
        data: { status: 'completed' },
      })
    } catch (e) {
      threw = /processorRef/i.test((e as Error).message)
    }
    expect(threw).toBe(true)
  })

  it('accepts a refund within the cap and matching currency on a paid order', async () => {
    const order = await seedPaidOrder()
    const payload = await getPayload()
    const refund = await payload.create({
      collection: 'refunds',
      overrideAccess: true,
      data: {
        reference: 're_happy',
        order: order.id,
        status: 'pending',
        amountMinor: Math.floor(order.totalMinor / 2),
        currency: order.currency,
        reason: 'requested_by_customer',
        processor: 'manual',
      },
    })
    expect((refund as { id?: number }).id).toBeDefined()
  })
})
