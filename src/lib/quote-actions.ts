'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { readCart, writeCart } from '@/lib/cart/store'
import { getCurrentUser } from '@/lib/auth'
import {
  createQuoteFromCart,
  createAdHocQuote,
  acceptQuoteAndCreateOrder,
  type QuoteAddress,
} from '@/lib/quotes'
import { sendNewQuoteCustomer, sendNewQuoteOps } from '@/lib/email'
import { getProductBySlug } from '@/lib/queries/products'
import {
  checkActionRateLimit,
  FIFTEEN_MIN,
  ONE_MIN,
} from '@/lib/action-rate-limit'

// J6 (round-4): use the shared display-safety predicate (also rejects
// bidi-control + zero-width chars usable for display-name spoofing).
import { noDangerousChars as noControlChars } from '@/lib/utils'
const contactSchema = z.object({
  customerName: z
    .string()
    .min(1)
    .max(120)
    .refine(noControlChars, 'Invalid characters in name.'),
  customerEmail: z.string().email(),
  customerPhone: z
    .string()
    .max(40)
    .refine(noControlChars, 'Invalid characters in phone.')
    .optional(),
  companyName: z
    .string()
    .max(120)
    .refine(noControlChars, 'Invalid characters in company name.')
    .optional(),
  destinationCountry: z
    .string()
    .max(80)
    .refine(noControlChars, 'Invalid characters in country.')
    .optional(),
  message: z.string().max(4000).optional(),
})

export type QuoteFormState = { error?: string; success?: boolean } | null

export async function submitQuoteFromCartAction(
  _prev: QuoteFormState,
  formData: FormData,
): Promise<QuoteFormState> {
  // M11: throttle quote spam — 10 quote submissions/IP/15 min.
  const limited = await checkActionRateLimit('quote-submit', {
    limit: 10,
    windowMs: FIFTEEN_MIN,
  })
  if (!limited.ok) return { error: limited.message }
  const cart = await readCart()
  if (cart.items.length === 0) return { error: 'Your cart has no items to quote.' }
  const quoteItems = cart.items.filter((i) => i.fulfillmentMode !== 'retail')
  if (quoteItems.length === 0)
    return {
      error: 'No quote-eligible items in cart. Retail items check out via card.',
    }

  const user = await getCurrentUser()

  const parsed = contactSchema.safeParse({
    customerName: String(formData.get('customerName') ?? user?.name ?? ''),
    customerEmail: String(formData.get('customerEmail') ?? user?.email ?? ''),
    customerPhone: String(formData.get('customerPhone') ?? '') || undefined,
    companyName: String(formData.get('companyName') ?? '') || undefined,
    destinationCountry: String(formData.get('destinationCountry') ?? '') || undefined,
    message: String(formData.get('message') ?? '') || undefined,
  })
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { error: first ? `${first.path.join('.')}: ${first.message}` : 'Invalid input.' }
  }

  let quote
  try {
    const quoteOnlyCart = {
      ...cart,
      items: quoteItems,
      currency: quoteItems[0].currency,
    }
    quote = await createQuoteFromCart({
      cart: quoteOnlyCart,
      customerId: user?.id,
      customerName: parsed.data.customerName,
      customerEmail: parsed.data.customerEmail,
      customerPhone: parsed.data.customerPhone,
      companyName: parsed.data.companyName,
      destinationCountry: parsed.data.destinationCountry,
      message: parsed.data.message,
    })
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not submit quote.' }
  }

  // Strip submitted quote items from the cart so the user doesn't resubmit.
  const remaining = cart.items.filter((i) => i.fulfillmentMode === 'retail')
  await writeCart({
    ...cart,
    items: remaining,
    currency: remaining.length ? cart.currency : null,
    updatedAt: Date.now(),
  })

  await fireNewQuoteEmails({
    quoteNumber: quote.quoteNumber,
    confirmationToken: quote.confirmationToken,
    customerName: parsed.data.customerName,
    customerEmail: parsed.data.customerEmail,
    companyName: parsed.data.companyName,
    destinationCountry: parsed.data.destinationCountry,
    message: parsed.data.message,
    items: quoteItems.map((i) => ({ title: i.title, quantity: i.quantity })),
  })

  // SECURITY (C2): redirect with `?t=<token>` so the customer can view
  // their quote immediately, and forward the same token via email.
  redirect(`/quotes/${quote.quoteNumber}?t=${quote.confirmationToken}`)
}

export async function submitQuoteFromFormAction(
  _prev: QuoteFormState,
  formData: FormData,
): Promise<QuoteFormState> {
  const limited = await checkActionRateLimit('quote-submit', {
    limit: 10,
    windowMs: FIFTEEN_MIN,
  })
  if (!limited.ok) return { error: limited.message }
  const user = await getCurrentUser()
  const parsed = contactSchema.safeParse({
    customerName: String(formData.get('customerName') ?? user?.name ?? ''),
    customerEmail: String(formData.get('customerEmail') ?? user?.email ?? ''),
    customerPhone: String(formData.get('customerPhone') ?? '') || undefined,
    companyName: String(formData.get('companyName') ?? '') || undefined,
    destinationCountry: String(formData.get('destinationCountry') ?? '') || undefined,
    message: String(formData.get('message') ?? ''),
  })
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { error: first ? `${first.path.join('.')}: ${first.message}` : 'Invalid input.' }
  }
  if (!parsed.data.message || parsed.data.message.length < 10) {
    return { error: 'Please describe what you need (min 10 characters).' }
  }

  const productSlug = String(formData.get('productSlug') ?? '')
  const quantity = Math.max(1, Math.min(99999, Number(formData.get('quantity')) || 1))

  if (!productSlug) {
    // Clean-room frontend major — the homepage hero, shop empty state,
    // help page, and contact CTA all link to /quote WITHOUT a product.
    // The previous code rejected those with a "piloting per-product
    // quotes" message, so a fully-filled B2B lead was silently lost (the
    // Quotes schema requires a product+vendor per line, so we can't
    // persist a product-less quote without a migration). Instead we
    // route the general enquiry straight to ops by email so the lead is
    // captured, and return a success state the form renders as a
    // thank-you. No quote row is created (respects the per-product
    // pilot), but the lead is never dropped.
    try {
      const enquiryRef = `ENQ-${Date.now().toString(36).toUpperCase()}`
      await sendNewQuoteOps({
        props: {
          quoteNumber: enquiryRef,
          customerName: parsed.data.customerName,
          customerEmail: parsed.data.customerEmail,
          companyName: parsed.data.companyName,
          destinationCountry: parsed.data.destinationCountry,
          message: parsed.data.message,
          items: [],
          siteUrl: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
        },
      })
    } catch (e) {
      // Email send is best-effort here; if it fails, tell the customer
      // to email us directly rather than pretend it went through.
      console.error('[quote] general-enquiry ops email failed:', e)
      return {
        error:
          'We could not submit your enquiry just now. Please email enquiry@bangarahtradingenterprises.com and we will respond within one business day.',
      }
    }
    return { success: true }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const product = (await getProductBySlug(productSlug)) as any
  if (!product) return { error: 'Product not available.' }
  const vendorId = typeof product.vendor === 'object' ? product.vendor.id : product.vendor

  let quote
  try {
    quote = await createAdHocQuote({
      customerId: user?.id,
      customerName: parsed.data.customerName,
      customerEmail: parsed.data.customerEmail,
      customerPhone: parsed.data.customerPhone,
      companyName: parsed.data.companyName,
      destinationCountry: parsed.data.destinationCountry,
      message: parsed.data.message,
      product: {
        productId: product.id,
        vendorId,
        title: product.title,
        quantity,
      },
    })
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not submit quote.' }
  }

  await fireNewQuoteEmails({
    quoteNumber: quote.quoteNumber,
    confirmationToken: quote.confirmationToken,
    customerName: parsed.data.customerName,
    customerEmail: parsed.data.customerEmail,
    companyName: parsed.data.companyName,
    destinationCountry: parsed.data.destinationCountry,
    message: parsed.data.message,
    items: [{ title: product.title, quantity }],
  })

  redirect(`/quotes/${quote.quoteNumber}?t=${quote.confirmationToken}`)
}

const addressSchema = z.object({
  name: z.string().min(1),
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  region: z.string().optional(),
  postalCode: z.string().min(1),
  country: z.string().min(2),
  phone: z.string().optional(),
})

const acceptSchema = z.object({
  quoteNumber: z.string().min(1),
  // SECURITY (C2): the per-quote token from the URL `?t=...` is part of the
  // accept payload. The form embeds it as a hidden input and the server
  // verifies in constant time before claiming the quote.
  confirmationToken: z.string().min(1, 'Missing quote token.'),
  shipping: addressSchema,
  billingSameAsShipping: z.coerce.boolean().optional(),
  billing: addressSchema.optional(),
})

function pickAddress(formData: FormData, prefix: 'shipping' | 'billing'): QuoteAddress {
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

export async function acceptQuoteAction(
  _prev: QuoteFormState,
  formData: FormData,
): Promise<QuoteFormState> {
  // M11: token brute-force gate. Even with constant-time compare, a hostile
  // client could pound through token-guess attempts. 20/IP/min is generous
  // for a real human refining shipping fields and re-submitting.
  const limited = await checkActionRateLimit('quote-accept', {
    limit: 20,
    windowMs: ONE_MIN,
  })
  if (!limited.ok) return { error: limited.message }
  const quoteNumber = String(formData.get('quoteNumber') ?? '')
  const confirmationToken = String(formData.get('confirmationToken') ?? '')
  const shipping = pickAddress(formData, 'shipping')
  const billingSameAsShipping = formData.get('billingSameAsShipping') === 'on'
  const billing = billingSameAsShipping ? undefined : pickAddress(formData, 'billing')

  const parsed = acceptSchema.safeParse({
    quoteNumber,
    confirmationToken,
    shipping,
    billingSameAsShipping,
    billing,
  })
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { error: first ? `${first.path.join('.')}: ${first.message}` : 'Invalid input.' }
  }

  const user = await getCurrentUser()
  const result = await acceptQuoteAndCreateOrder({
    quoteNumber,
    confirmationToken,
    userId: user?.id,
    shipping,
    billingSameAsShipping,
    billing,
  })
  if (!result.ok) return { error: result.error }

  // B26 fix: guest acceptors need the confirmation token in the URL or
  // they hit the order-page 404 gate.
  const target = user
    ? `/orders/${result.orderNumber}`
    : `/orders/${result.orderNumber}?t=${result.confirmationToken}`
  redirect(target)
}

async function fireNewQuoteEmails(props: {
  quoteNumber: string
  /** SECURITY (C2): forwarded into the customer's quote URL. */
  confirmationToken: string
  customerName: string
  customerEmail: string
  companyName?: string
  destinationCountry?: string
  message?: string
  items: Array<{ title: string; quantity: number }>
}) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
  const payload = { ...props, siteUrl }
  await Promise.allSettled([
    sendNewQuoteCustomer({ to: props.customerEmail, props: payload }),
    sendNewQuoteOps({ props: payload }),
  ])
}
