'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { readCart, clearCart, writeCart } from '@/lib/cart/store'
import {
  cancelOrderAndReleaseInventory,
  createOrderFromCart,
  OrderValidationError,
  type Address,
} from '@/lib/orders'
import { getCurrentUser } from '@/lib/auth'
import { getProcessor, listConfiguredProcessors } from '@/lib/payments'
import { sendOrderConfirmation } from '@/lib/email'
import { formatPrice } from '@/lib/utils'
import { checkActionRateLimit, ONE_MIN } from '@/lib/action-rate-limit'
import { consumeStrict } from '@/lib/rate-limit'
import { isAllowedCheckoutRedirect } from '@/lib/checkout-redirect'
import { createHash } from 'node:crypto'

const addressSchema = z.object({
  name: z.string().min(1, 'Name required'),
  line1: z.string().min(1, 'Street address required'),
  line2: z.string().optional(),
  city: z.string().min(1, 'City required'),
  region: z.string().optional(),
  postalCode: z.string().min(1, 'Postal code required'),
  country: z.string().min(2, 'Country required'),
  phone: z.string().optional(),
})

const checkoutSchema = z.object({
  email: z.string().email(),
  shipping: addressSchema,
  billingSameAsShipping: z.coerce.boolean().optional(),
  billing: addressSchema.optional(),
  processor: z.enum(['stripe', 'flutterwave', 'manual']),
  notes: z.string().max(2000).optional(),
})

export type CheckoutFormState = { error?: string } | null

function pickAddress(formData: FormData, prefix: 'shipping' | 'billing'): Address {
  return {
    name: String(formData.get(`${prefix}.name`) ?? ''),
    line1: String(formData.get(`${prefix}.line1`) ?? ''),
    line2: String(formData.get(`${prefix}.line2`) ?? '') || undefined,
    city: String(formData.get(`${prefix}.city`) ?? ''),
    region: String(formData.get(`${prefix}.region`) ?? '') || undefined,
    postalCode: String(formData.get(`${prefix}.postalCode`) ?? ''),
    country: String(formData.get(`${prefix}.country`) ?? ''),
    phone: String(formData.get(`${prefix}.phone`) ?? '') || undefined,
  }
}

export async function placeOrderAction(
  _prev: CheckoutFormState,
  formData: FormData,
): Promise<CheckoutFormState> {
  // M11: cap order-creation rate per IP. Order creation creates DB rows
  // and may hit the payment processor (Stripe session creation). 20/min
  // is plenty for retry/back-button flows.
  // M7 (Phase 2) — strict (fail-closed) on the money-touching path. An
  // Upstash outage must not silently fall back to per-instance memory
  // and let a scripted attacker spam past the 20/min cap, creating real
  // pending_payment orders + decrementing inventory + opening Stripe
  // sessions. Login/forgot/reset are already strict; order-creation
  // joins them.
  const limited = await checkActionRateLimit('place-order', {
    limit: 20,
    windowMs: ONE_MIN,
    strict: true,
  })
  if (!limited.ok) return { error: limited.message }
  const cart = await readCart()
  if (cart.items.length === 0) {
    return { error: 'Your cart is empty.' }
  }

  const user = await getCurrentUser()
  const emailFromForm = String(formData.get('email') ?? '').trim()

  const shipping = pickAddress(formData, 'shipping')
  const billingSameAsShipping = formData.get('billingSameAsShipping') === 'on'
  const billing = billingSameAsShipping ? shipping : pickAddress(formData, 'billing')

  const processor = String(formData.get('processor') ?? 'manual') as
    | 'stripe'
    | 'flutterwave'
    | 'manual'

  // M3 (round-6) — Zod validation comes BEFORE the idempotency gate. The
  // gate is a 1-per-60s strict budget against a per-cart fingerprint; if
  // we consumed it before validation, a Zod failure (missing postal code,
  // bad email format) burned the budget and the user's correction attempt
  // 5 seconds later was rejected with "we already received this order" —
  // a confusing message blocking the legitimate retry. Validate first;
  // only burn the idempotency budget when the input is shape-valid.
  const parsed = checkoutSchema.safeParse({
    email: user?.email ?? emailFromForm,
    shipping,
    billingSameAsShipping,
    billing: billingSameAsShipping ? undefined : billing,
    processor,
    notes: String(formData.get('notes') ?? '') || undefined,
  })
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { error: first ? `${first.path.join('.')}: ${first.message}` : 'Invalid input.' }
  }

  const configured = listConfiguredProcessors()
  if (!configured.includes(parsed.data.processor)) {
    return { error: `Selected payment method (${parsed.data.processor}) is not available.` }
  }

  // L2 (chaos C2) idempotency gate: a double-click (or scripted client)
  // used to produce two distinct orders with two stock decrements because
  // every call generates a fresh nanoid order number. We hash the cart id
  // + processor + items shape + email and consumeStrict with a 1-per-60s
  // budget against that hash — the second submit within 60s is rejected
  // with a clear message. cart.id is stable for the life of the cart so
  // a legitimate retry shares the key.
  //
  // Backed by Upstash when configured, in-memory otherwise. consumeStrict
  // fails closed in prod when Upstash is missing (see rate-limit.ts), so
  // a misconfigured deploy can't accidentally disable this.
  const idemFingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        cartId: cart.id,
        items: cart.items
          .map((i) => `${i.productId}:${i.quantity}:${i.unitPriceMinor}`)
          .sort(),
        processor,
        email: user?.email ?? emailFromForm,
      }),
    )
    .digest('hex')
    .slice(0, 16)
  const idemDecision = await consumeStrict(
    `place-order-idem:${idemFingerprint}`,
    1,
    60_000,
  )
  if (!idemDecision.ok) {
    return {
      error:
        'We already received this order. Check your email for the confirmation, or wait a minute and try again if you didn’t mean to submit twice.',
    }
  }

  // The form's hidden shippingAmountMinor and shippingLabel are HINTS only.
  // createOrderFromCart re-quotes shipping server-side and verifies the hint
  // matches before persisting.
  const shippingAmountHintMinor = Math.max(
    0,
    Math.min(1_000_000_00, Number(formData.get('shippingAmountMinor')) || 0),
  )
  const shippingLabelHint = String(formData.get('shippingLabel') ?? '') || undefined
  const shippingMethodId = String(formData.get('shippingMethodId') ?? '') || undefined

  let order
  try {
    order = await createOrderFromCart({
      cart,
      customerEmail: parsed.data.email,
      customerId: user?.id,
      shipping,
      billing,
      notes: parsed.data.notes,
      shippingAmountHintMinor,
      shippingLabelHint,
      shippingMethodId,
    })
  } catch (e) {
    if (e instanceof OrderValidationError) return { error: e.message }
    return { error: e instanceof Error ? e.message : 'Could not create order.' }
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
  // The confirmation URL carries the token so guest customers can view their
  // order without auth. Signed-in customers see it via owner-match.
  const successUrl = user
    ? `${siteUrl}/orders/${order.orderNumber}`
    : `${siteUrl}/orders/${order.orderNumber}?t=${order.confirmationToken}`
  const cancelUrl = `${siteUrl}/cart`

  let redirectTarget = successUrl
  let processorFailed = false
  try {
    const result = await getProcessor(parsed.data.processor).startCheckout({
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerEmail: parsed.data.email,
      currency: order.currency as 'NAD' | 'ZAR' | 'USD' | 'GBP' | 'EUR',
      amountMinor: order.totalMinor,
      lines: order.lineItems!.map((l) => ({
        title: l.titleSnapshot,
        unitPriceMinor: l.unitPriceMinor,
        quantity: l.quantity,
      })),
      shippingMinor: order.shippingMinor ?? 0,
      shippingLabel: order.fulfillment?.carrier ?? undefined,
      successUrl,
      cancelUrl,
    })
    redirectTarget = result.redirectUrl
  } catch (e) {
    // B2 / H5 fix: if a real processor (Stripe/Flutterwave) was requested
    // and the session creation failed, cancel the order so we don't leave a
    // stale pending_payment row. Previously this used a plain payload.update
    // which did NOT release the inventory createOrderFromCart had just
    // decremented — every processor failure silently burned stock. Now we
    // go through cancelOrderAndReleaseInventory which atomically flips
    // status AND re-adds the stock (only when order.inventoryDecremented
    // is true, so quote-derived orders are untouched).
    processorFailed = parsed.data.processor !== 'manual'
    console.error('[checkout] processor failed:', e)
    if (processorFailed) {
      try {
        await cancelOrderAndReleaseInventory(
          order.id,
          'processor session-create failed before customer redirect',
        )
      } catch (cancelErr) {
        console.error('[checkout] order-cancel cleanup failed:', cancelErr)
      }
      return {
        error:
          'Could not start the payment session. No charge was made. Please try again, or pick a different payment method.',
      }
    }
  }

  // Manual mode: also send the order confirmation email now since there's no
  // webhook arrival to trigger it. For Stripe/Flutterwave the webhook handler
  // sends the email after payment confirmation.
  if (parsed.data.processor === 'manual') {
    // R8 business M3 — tag the order's processor as 'manual' so the
    // abandoned-order sweeper can exclude it. Manual / bank-transfer
    // orders legitimately sit in pending_payment for hours/days while
    // the customer arranges the transfer; the 30-min sweeper must not
    // cancel them and release inventory (the auto-refund path doesn't
    // apply to manual either, so a swept manual order strands the
    // customer's incoming transfer).
    const { getPayload } = await import('@/lib/payload')
    const pl = await getPayload()
    await pl.update({
      collection: 'orders',
      id: order.id,
      overrideAccess: true,
      data: { payment: { ...(order.payment ?? {}), processor: 'manual' } },
    })
    const manualInstructions = process.env.MANUAL_PAYMENT_INSTRUCTIONS
    await sendOrderConfirmation({
      to: parsed.data.email,
      props: {
        orderNumber: order.orderNumber,
        customerName: shipping.name,
        totalFormatted: formatPrice(order.totalMinor, order.currency),
        subtotalFormatted: formatPrice(order.subtotalMinor, order.currency),
        shippingFormatted: formatPrice(order.shippingMinor ?? 0, order.currency),
        taxFormatted:
          order.taxMinor && order.taxMinor > 0
            ? formatPrice(order.taxMinor, order.currency)
            : undefined,
        currency: order.currency,
        siteUrl,
        manualPaymentInstructions:
          manualInstructions ||
          `Please transfer ${formatPrice(order.totalMinor, order.currency)} to the bank details below and reply with your transfer receipt. We'll release the order as soon as funds clear.`,
        items: order.lineItems!.map((l) => ({
          title: l.titleSnapshot,
          quantity: l.quantity,
          lineTotalFormatted: formatPrice(l.lineTotalMinor, order.currency),
        })),
      },
    })
  }

  // M8 fix: preserve quote-mode items in the cart. createOrderFromCart
  // filters out fulfillmentMode==='quote' lines (those go through the B2B
  // quote workflow, not Stripe), but the previous `clearCart()` then wiped
  // ALL lines — silently deleting the customer's bulk-quote intent next to
  // their retail purchase. Drop only the items that were actually orderable;
  // keep quote items so the user can submit them on the /cart page.
  const remainingQuoteItems = cart.items.filter((i) => i.fulfillmentMode === 'quote')

  // M3 (round-6) — drop a `pending-order` cookie alongside the cart clear
  // so the /cart page can surface a "continue checkout" banner when the
  // customer returns having abandoned the hosted-checkout redirect. We
  // set it BEFORE clearCart so a thrown redirect on slow networks doesn't
  // strand the user with an empty cart and no path back to the order
  // (sweeper picks up the abandoned row at 30min and releases inventory,
  // but the customer can resume payment within that window if they
  // navigate back here). 45min covers the sweeper threshold + buffer.
  // R7 security fix (5.17 regression): the previous implementation set
  // `httpOnly: false` so the /cart page could read the cookie via JS.
  // But the cookie carries the order's `confirmationToken` which is
  // the SOLE auth gate for guest-order viewing — any stored-XSS,
  // third-party script (analytics, a future un-vetted React component),
  // or browser extension on this origin could exfiltrate it and view
  // the customer's order including full PII. The cookie is now
  // server-only; the /cart page reads it via an RSC helper rather
  // than document.cookie. We also drop the token from the cookie body
  // entirely — the order number alone is enough to look up the order
  // server-side (where access is already gated by the page logic).
  // R11 — only set the resume-banner cookie for processor-driven flows
  // (Stripe / Flutterwave). Manual / bank-transfer orders have no
  // "continue checkout" page to resume to; surfacing the banner for them
  // would point the customer at a static order-status page that already
  // shows the bank-transfer instructions.
  if (parsed.data.processor !== 'manual') {
    try {
      const jar = await cookies()
      jar.set({
        name: 'pending-order',
        value: JSON.stringify({
          n: order.orderNumber,
          c: order.currency,
          a: order.totalMinor,
        }),
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 45 * 60,
      })
    } catch {
      // cookie write must not block redirect
    }
  }

  if (remainingQuoteItems.length === 0) {
    await clearCart()
  } else {
    await writeCart({
      ...cart,
      items: remainingQuoteItems,
      currency: remainingQuoteItems[0]?.currency ?? null,
      updatedAt: Date.now(),
    })
  }
  // m21 (Phase 2): allow-list gate. If the processor returned a URL
  // outside our trust set (own site, checkout.stripe.com,
  // *.flutterwave.com), fall back to the successUrl on our own domain
  // and log loudly — the customer still lands on their order page
  // (worst case they see "awaiting confirmation"), and ops sees the
  // anomaly.
  if (!isAllowedCheckoutRedirect(redirectTarget, siteUrl)) {
    console.error(
      `[checkout] refusing processor redirect outside allow-list: ${redirectTarget} — falling back to ${successUrl}`,
    )
    redirectTarget = successUrl
  }
  redirect(redirectTarget)
}
