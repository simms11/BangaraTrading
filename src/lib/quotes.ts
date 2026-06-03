import 'server-only'
import { nanoid } from 'nanoid'
import { timingSafeEqual } from 'node:crypto'
import { getPayload } from '@/lib/payload'
import type { Cart } from '@/lib/cart/types'

/**
 * Constant-time string compare for the per-quote confirmation token.
 * Same pattern used to gate guest order pages — prevents timing oracles
 * from leaking which prefix of the token matched.
 */
function tokensMatch(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) return false
  return timingSafeEqual(aBuf, bBuf)
}

export function generateQuoteToken(): string {
  return nanoid(32)
}

function toId(v: number | string | undefined): number | undefined {
  if (v == null) return undefined
  const n = typeof v === 'number' ? v : parseInt(v, 10)
  return Number.isNaN(n) ? undefined : n
}
function requireId(v: number | string | undefined): number {
  const n = toId(v)
  if (n == null) throw new Error('Expected a numeric id')
  return n
}

export function generateQuoteNumber(): string {
  const d = new Date()
  const ym = `${d.getFullYear().toString().slice(-2)}${String(d.getMonth() + 1).padStart(2, '0')}`
  return `BGQ-${ym}-${nanoid(6).toUpperCase()}`
}

export type CreateQuoteFromCartInput = {
  cart: Cart
  customerName: string
  customerEmail: string
  customerPhone?: string
  companyName?: string
  destinationCountry?: string
  message?: string
  customerId?: number | string
}

export async function createQuoteFromCart(input: CreateQuoteFromCartInput) {
  const items = input.cart.items.filter((i) => i.fulfillmentMode !== 'retail')
  if (items.length === 0) {
    throw new Error('No quote-eligible items in cart.')
  }
  const payload = await getPayload()
  const quoteNumber = generateQuoteNumber()
  const confirmationToken = generateQuoteToken()
  const currency = input.cart.currency || items[0].currency

  return payload.create({
    collection: 'quotes',
    overrideAccess: true,
    data: {
      quoteNumber,
      confirmationToken,
      status: 'submitted',
      customer: toId(input.customerId),
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerPhone: input.customerPhone,
      companyName: input.companyName,
      destinationCountry: input.destinationCountry,
      items: items.map((i) => ({
        product: requireId(i.productId),
        vendor: requireId(i.vendorId),
        titleSnapshot: i.title,
        quantity: i.quantity,
      })),
      currency,
      message: input.message,
    },
  })
}

export type CreateAdHocQuoteInput = {
  customerName: string
  customerEmail: string
  customerPhone?: string
  companyName?: string
  destinationCountry?: string
  message: string
  /** Optional preselected product line */
  product?: {
    productId: number | string
    vendorId: number | string
    title: string
    quantity: number
  }
  customerId?: number | string
}

export async function createAdHocQuote(input: CreateAdHocQuoteInput) {
  const payload = await getPayload()
  const quoteNumber = generateQuoteNumber()
  const confirmationToken = generateQuoteToken()

  const items = input.product
    ? [
        {
          product: requireId(input.product.productId),
          vendor: requireId(input.product.vendorId),
          titleSnapshot: input.product.title,
          quantity: input.product.quantity,
        },
      ]
    : // Placeholder line — represents the free-text enquiry until ops attaches real products.
      // We require at least one line in the collection schema, so we anchor an enquiry
      // placeholder that ops can edit.
      []

  if (items.length === 0) {
    throw new Error(
      'A product is required. Use the cart submit-quote flow or pass a product slug to /quote.',
    )
  }

  return payload.create({
    collection: 'quotes',
    overrideAccess: true,
    data: {
      quoteNumber,
      confirmationToken,
      status: 'submitted',
      customer: toId(input.customerId),
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerPhone: input.customerPhone,
      companyName: input.companyName,
      destinationCountry: input.destinationCountry,
      items,
      currency: 'NAD',
      message: input.message,
    },
  })
}

export async function findQuoteByNumber(quoteNumber: string) {
  const payload = await getPayload()
  // System-level read: the customer-facing /quotes/[quoteNumber] page does
  // its own per-quote authorization (we render the page only after the
  // visitor matches by email/customer/quoteNumber). Without overrideAccess
  // the anon access rule on Quotes returns false and we get null.
  const { docs } = await payload.find({
    collection: 'quotes',
    where: { quoteNumber: { equals: quoteNumber } },
    limit: 1,
    depth: 1,
    overrideAccess: true,
  })
  return docs[0] ?? null
}

export type QuoteAddress = {
  name: string
  line1: string
  line2?: string
  city: string
  region?: string
  postalCode: string
  country: string
  phone?: string
}

export type AcceptQuoteResult =
  | {
      ok: true
      orderNumber: string
      orderId: string | number
      /** Guest acceptors need this in the URL to view the order. */
      confirmationToken: string
    }
  | { ok: false; error: string }

export async function acceptQuoteAndCreateOrder(args: {
  quoteNumber: string
  /**
   * Per-quote confirmation token from the URL `?t=...` that the customer
   * received in their quote-ready email. SECURITY (C2): without this gate,
   * anyone who could guess a quoteNumber (time-prefixed nanoid-6, partially
   * brute-forceable) could accept a stranger's quote and bind it to an
   * attacker-controlled shipping address. The token is unguessable nanoid-32
   * and compared in constant time.
   */
  confirmationToken: string
  /** Authenticated user id, if signed in — must match `quote.customer`. */
  userId?: number | string
  shipping: QuoteAddress
  billingSameAsShipping: boolean
  billing?: QuoteAddress
}): Promise<AcceptQuoteResult> {
  const payload = await getPayload()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const quote = (await findQuoteByNumber(args.quoteNumber)) as any
  if (!quote) return { ok: false, error: 'Quote not found.' }
  // Constant-time token compare. If the quote has a tied customer account
  // AND the caller is signed in as that customer, we accept either gate
  // (signed-in ownership OR token) — but at least one must succeed.
  const tokenOk = tokensMatch(args.confirmationToken, quote.confirmationToken)
  const quoteCustomerId =
    quote.customer && typeof quote.customer === 'object'
      ? (quote.customer as { id: number | string }).id
      : (quote.customer as number | string | undefined)
  const ownerOk =
    quoteCustomerId != null &&
    args.userId != null &&
    String(quoteCustomerId) === String(args.userId)
  if (!tokenOk && !ownerOk) {
    return { ok: false, error: 'Quote not found.' }
  }
  if (quote.status !== 'quoted') {
    return {
      ok: false,
      error: `Quote is in status "${quote.status}". Only quoted quotes can be accepted.`,
    }
  }
  const validUntil = quote.response?.validUntil
  if (validUntil && new Date(validUntil) < new Date()) {
    return { ok: false, error: 'This quote has expired. Please request a fresh quote.' }
  }
  // Every line must have a quoted unit price. `findQuoteByNumber` reads
  // with depth=1, so the `product` / `vendor` relationships arrive as
  // either full objects or bare ids depending on whether they were
  // populated. Normalize via a small helper.
  const lines = (quote.items ?? []) as Array<{
    product: number | string | { id: number | string }
    vendor: number | string | { id: number | string }
    titleSnapshot: string
    quantity: number
    unitPriceQuoteMinor?: number
  }>
  const refId = (v: number | string | { id: number | string }): number | string =>
    typeof v === 'object' && v !== null ? v.id : v
  // R7 round-7 data m5 — `!l.unitPriceQuoteMinor` also rejected a
  // legitimate $0 line (free sample, comp item bundled with paid lines).
  // We require an explicit number (including 0); only null/undefined is
  // a missing price.
  if (lines.some((l) => l.unitPriceQuoteMinor == null)) {
    return {
      ok: false,
      error: 'Quote is missing per-line pricing. Ask Bangarah to finalize the quote.',
    }
  }
  const subtotalMinor = lines.reduce(
    (acc, l) => acc + (l.unitPriceQuoteMinor ?? 0) * l.quantity,
    0,
  )

  const orderNumber = `BGR-${new Date().toISOString().slice(2, 7).replace('-', '')}-${nanoid(6).toUpperCase()}`
  const confirmationToken = nanoid(32)

  const billing = args.billingSameAsShipping
    ? args.shipping
    : args.billing ?? args.shipping

  // B63 + R7 round-7 C3 fix: claim the quote with a TRULY-atomic raw
  // conditional UPDATE before doing any order-creation work. The prior
  // implementation used `payload.update({ where: …, data: { status:
  // 'accepted' } })` which internally does `find` then `Promise.all`
  // per-doc — TWO parallel accepts on the same quote both passed the
  // find and both transitioned 'quoted' → 'accepted', producing TWO
  // distinct orders from one quote (with two confirmation tokens and
  // two emails). Raw SQL with `WHERE status='quoted'` on the row level
  // gives single-row atomicity: only the first to commit transitions;
  // the second sees rowCount=0. Mirrors the markOrderPaid pattern.
  const quoteId = requireId(quote.id)
  const claimPool = (payload.db as unknown as { pool: import('pg').Pool }).pool
  const claimRes = await claimPool.query(
    `UPDATE quotes
       SET status = 'accepted'::enum_quotes_status,
           updated_at = NOW()
     WHERE id = $1
       AND status = 'quoted'::enum_quotes_status
     RETURNING id`,
    [quoteId],
  )
  if (claimRes.rowCount !== 1) {
    return {
      ok: false,
      error: 'This quote is already being processed. Refresh the page to see the latest status.',
    }
  }

  let order
  try {
    order = await payload.create({
      collection: 'orders',
      overrideAccess: true,
      data: {
        orderNumber,
        confirmationToken,
        status: 'pending_payment',
        // quote.customer may be a bare id or an expanded object depending
        // on the read depth — `toId` accepts both via the refId pre-step.
        customer:
          quote.customer != null
            ? toId(
                typeof quote.customer === 'object'
                  ? (quote.customer as { id: number | string }).id
                  : quote.customer,
              )
            : undefined,
        guestEmail: quote.customer ? undefined : quote.customerEmail,
        lineItems: lines.map((l) => ({
          product: requireId(refId(l.product)),
          vendor: requireId(refId(l.vendor)),
          titleSnapshot: l.titleSnapshot,
          quantity: l.quantity,
          unitPriceMinor: l.unitPriceQuoteMinor ?? 0,
          lineTotalMinor: (l.unitPriceQuoteMinor ?? 0) * l.quantity,
        })),
        subtotalMinor,
        shippingMinor: 0,
        taxMinor: 0,
        totalMinor: subtotalMinor,
        currency: (quote.currency ?? 'NAD') as 'NAD' | 'ZAR' | 'USD' | 'GBP' | 'EUR',
        shippingAddress: args.shipping,
        billingAddress: billing,
        notes: `Converted from quote ${quote.quoteNumber}`,
      },
    })
  } catch (e) {
    // Order creation failed after we claimed the quote — release the claim
    // so the customer (or another retry) can attempt again. If even this
    // recovery fails, the quote is stuck in 'accepted' and an operator
    // resolves manually; that's a far better failure mode than charging
    // twice.
    //
    // R7 round-7 M4 fix: conditional UPDATE — only release if STILL
    // 'accepted'. Without this, an admin who clicked "Decline" between
    // our claim and this catch handler would see their decline silently
    // reverted to 'quoted', resurrecting a quote they intentionally
    // killed.
    await claimPool
      .query(
        `UPDATE quotes
           SET status = 'quoted'::enum_quotes_status,
               updated_at = NOW()
         WHERE id = $1
           AND status = 'accepted'::enum_quotes_status`,
        [quoteId],
      )
      .catch(() => undefined)
    throw e
  }

  // I7 (M5) fix: conditional UPDATE so an admin who clicked "Decline" or
  // "Expire" between our `accepted` claim and this final write doesn't
  // get silently overwritten by `converted`. If the row is no longer in
  // 'accepted' (e.g. admin changed it), we leave the order in place
  // (the customer already has a paid path) but skip the converted flip
  // and log so ops can reconcile.
  const convertRes = await payload.update({
    collection: 'quotes',
    where: {
      and: [
        { id: { equals: quoteId } },
        { status: { equals: 'accepted' } },
      ],
    },
    overrideAccess: true,
    data: { status: 'converted', convertedOrder: order.id },
  })
  if (!convertRes.docs || convertRes.docs.length === 0) {
    console.warn(
      `[quotes] quote ${quote.quoteNumber} could not be marked converted (status changed under us); order ${orderNumber} still created.`,
    )
  }

  return { ok: true, orderNumber, orderId: order.id, confirmationToken }
}
