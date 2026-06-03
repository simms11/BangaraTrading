import 'server-only'
import { nanoid } from 'nanoid'
import { getPayload } from '@/lib/payload'
import { getProductsByIds } from '@/lib/queries/products'
import { quoteShipping } from '@/lib/shipping'
import { audit } from '@/lib/audit'
import type { Cart } from '@/lib/cart/types'
import type { Order, Product } from '@/payload-types'

/**
 * M17 fix: the raw-SQL inventory updates in this file bypass Payload's
 * afterChange hook on Products, so `revalidateProduct` (which purges the
 * ISR cache for /products/<slug>) doesn't fire. A product that just hit
 * zero stock would keep showing "in stock" on the public storefront
 * until the next manual save. This helper does the revalidate inline.
 */
async function revalidateProductPath(slug: string | undefined): Promise<void> {
  if (!slug) return
  try {
    const { revalidatePath } = await import('next/cache')
    revalidatePath(`/products/${slug}`)
    revalidatePath('/shop')
  } catch {
    // No request context (CLI / job) — skip silently.
  }
}

/**
 * Postgres ids are always numeric in our setup. The Payload helpers accept
 * `number | string`, so we coerce at every passage boundary to keep the
 * generated type narrow and avoid `as unknown as number` casts.
 */
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

export type Address = {
  name: string
  line1: string
  line2?: string
  city: string
  region?: string
  postalCode: string
  country: string
  phone?: string
}

export type CreateOrderInput = {
  cart: Cart
  customerEmail: string
  customerId?: number | string
  shipping: Address
  billing: Address
  /** Notes from the customer */
  notes?: string
  /** Method id chosen on the checkout form. Re-validated server-side. */
  shippingMethodId?: string
  /** Client-suggested label/amount. Only used to short-circuit when re-quoting agrees. */
  shippingLabelHint?: string
  shippingAmountHintMinor?: number
}

const SAFETY_AMOUNT_TOLERANCE_MINOR = 100 // 1 unit — round-off tolerance

export class OrderValidationError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'OrderValidationError'
  }
}

export function generateOrderNumber(): string {
  // Time-prefixed for human-sortable readability, plus 6-char nanoid.
  const d = new Date()
  const ym = `${d.getFullYear().toString().slice(-2)}${String(d.getMonth() + 1).padStart(2, '0')}`
  return `BGR-${ym}-${nanoid(6).toUpperCase()}`
}

/**
 * Produces a confirmation token that gates the guest order URL.
 * 32 chars of nanoid — collision-resistant + unguessable.
 */
export function generateConfirmationToken(): string {
  return nanoid(32)
}

/**
 * Order-creation contract:
 *   - Cart items are looked up by id in the DB to confirm they're still
 *     published. Stale entries fail loudly.
 *   - Unit prices come from the DB, never from the cart cookie.
 *   - Shipping is re-quoted server-side; the method id chosen by the client
 *     is matched against the freshly computed methods. Any drift larger
 *     than 100 minor units is rejected.
 *
 * This is the choke point that prevents cart-cookie fraud.
 */
export async function createOrderFromCart(input: CreateOrderInput): Promise<Order> {
  const { cart, customerEmail, customerId, shipping, billing, notes } = input

  // Only retail/hybrid items go through the order pipeline.
  const orderableCartItems = cart.items.filter((i) => i.fulfillmentMode !== 'quote')
  if (orderableCartItems.length === 0) {
    throw new OrderValidationError('empty_cart', 'Cart has no items eligible for checkout.')
  }

  // Pull authoritative product records from the DB.
  const productIds = Array.from(
    new Set(orderableCartItems.map((i) => i.productId)),
  ) as Array<number | string>
  const products = await getProductsByIds(productIds)
  const byId = new Map<string, Product>(products.map((p) => [String(p.id), p]))

  // Validate every cart line against the live product.
  type LinePlan = {
    product: Product
    quantity: number
    unitPriceMinor: number
    lineTotalMinor: number
    vendorId: number
  }
  const lines: LinePlan[] = []
  const issues: Array<{ slug: string; reason: string }> = []
  let currency: string | null = null

  for (const item of orderableCartItems) {
    const product = byId.get(String(item.productId))
    if (!product) {
      issues.push({ slug: item.slug, reason: 'no_longer_available' })
      continue
    }
    if (product.status !== 'published') {
      issues.push({ slug: item.slug, reason: 'not_published' })
      continue
    }
    // B61 fix: clamp quantity defensively. readCart() already drops
    // quantity <= 0 but doesn't enforce an upper bound; a tampered cookie
    // with quantity: 1_000_000 would otherwise drain inventory, blow up
    // totals, or trigger Stripe rejections.
    const safeQty = Math.max(1, Math.min(99, Math.floor(Number(item.quantity) || 0)))
    if (safeQty !== item.quantity) {
      issues.push({
        slug: item.slug,
        reason: `invalid quantity (got ${item.quantity}, clamped to ${safeQty}). Please remove and re-add the item.`,
      })
      continue
    }
    if (
      product.inventory?.trackQuantity &&
      !product.inventory?.allowBackorder &&
      (product.inventory?.quantity ?? 0) < safeQty
    ) {
      issues.push({
        slug: item.slug,
        reason: `only ${product.inventory?.quantity ?? 0} in stock`,
      })
      continue
    }
    currency = currency ?? product.currency
    if (currency !== product.currency) {
      throw new OrderValidationError(
        'mixed_currency',
        `Cart mixes ${currency} and ${product.currency}. Clear cart first.`,
      )
    }
    const rawVendorId =
      typeof product.vendor === 'object'
        ? (product.vendor as { id: number | string }).id
        : (product.vendor as number | string)
    lines.push({
      product,
      quantity: safeQty,
      unitPriceMinor: product.priceMinor,
      lineTotalMinor: product.priceMinor * safeQty,
      vendorId: requireId(rawVendorId),
    })
  }

  if (issues.length > 0) {
    throw new OrderValidationError(
      'cart_drift',
      `Some items are no longer available or out of stock: ${issues
        .map((i) => `${i.slug} (${i.reason})`)
        .join(', ')}. Please review your cart.`,
    )
  }
  if (lines.length === 0) {
    throw new OrderValidationError('empty_cart_after_validation', 'No valid items in cart.')
  }

  const subtotalMinor = lines.reduce((acc, l) => acc + l.lineTotalMinor, 0)

  // Re-quote shipping server-side using the validated cart weight.
  const parcelWeightGrams = lines.reduce(
    (acc, l) =>
      acc + ((l.product.shipping?.weightGrams as number | undefined) ?? 500) * l.quantity,
    0,
  )
  const itemCount = lines.reduce((acc, l) => acc + l.quantity, 0)
  const shippingQuote = await quoteShipping({
    destination: shipping,
    parcel: { weightGrams: parcelWeightGrams, itemCount, currency: currency ?? 'NAD' },
  })

  // Match the customer's pick against the server-quoted method.
  let chosenMethod = shippingQuote.methods.find((m) => m.id === input.shippingMethodId)
  if (!chosenMethod) {
    // Customer didn't pick (or picked an option no longer available) → default to pickup.
    chosenMethod = shippingQuote.methods.find((m) => m.id === 'pickup') ?? shippingQuote.methods[0]
  }
  if (!chosenMethod) {
    throw new OrderValidationError(
      'no_shipping_method',
      'No shipping method available for this destination.',
    )
  }
  // Guard against any client tampering of the hidden amount field.
  if (
    typeof input.shippingAmountHintMinor === 'number' &&
    Math.abs(input.shippingAmountHintMinor - chosenMethod.amountMinor) >
      SAFETY_AMOUNT_TOLERANCE_MINOR
  ) {
    throw new OrderValidationError(
      'shipping_drift',
      'Shipping cost changed since you viewed the page. Please refresh checkout.',
    )
  }

  const shippingMinor = chosenMethod.amountMinor
  const taxMinor = 0 // Phase 5.5+ — real tax provider
  const totalMinor = subtotalMinor + shippingMinor + taxMinor

  const payload = await getPayload()
  const orderNumber = generateOrderNumber()
  const confirmationToken = generateConfirmationToken()

  // B74 fix: decrement inventory BEFORE creating the order so a race-loss
  // (or any failure mid-flight) can never leave a paid-looking order behind
  // with stock that was never actually deducted. Previous flow created the
  // order first and decremented after — non-transactional, and the
  // "if decrement fails just log" branch silently allowed overselling.
  //
  // Compensation pattern:
  //   1. Atomically decrement each tracked line. If any line returns 0 rows
  //      (race lost or product missing), revert the decrements we already
  //      applied and surface a hard validation error to the customer.
  //   2. Create the order via payload.create. If that throws (DB hiccup,
  //      relationship failure), revert ALL decrements before re-throwing
  //      so the inventory ledger stays consistent.
  //
  // The revert UPDATE has no WHERE guard on quantity — increments always
  // succeed barring full DB outage. In a true outage we log loudly and let
  // ops reconcile manually; that's better than the prior silent oversell.
  const pool = (payload.db as unknown as { pool: import('pg').Pool }).pool
  const decremented: Array<{ productId: number; quantity: number }> = []

  async function revertDecrements(): Promise<void> {
    // K5 (round-5 chaos m5) — bound the total time the revert can spend.
    // If the DB is hard-down each pool.query waits `connectionTimeoutMillis`
    // (5s by default) before throwing — with N=99 lines that's 8 min,
    // long past Vercel's 30s function deadline. Cap at 10s total.
    const REVERT_DEADLINE_MS = 10_000
    const startedAt = Date.now()
    // R7 round-7 reliability M2 — track index explicitly in the loop
    // instead of `decremented.indexOf(d)` inside the body (O(n²) and
    // incorrect when two lines share productId — indexOf returns the
    // FIRST match so the audit text would point at the wrong row).
    for (let idx = 0; idx < decremented.length; idx++) {
      const d = decremented[idx]
      if (Date.now() - startedAt > REVERT_DEADLINE_MS) {
        console.error(
          `[inventory] revert deadline exceeded after ${idx}/${decremented.length} entries for order ${orderNumber}; remaining decrements logged for manual recon.`,
        )
        try {
          await audit({
            payload,
            kind: 'inventory.revert_failed',
            subjectType: 'orders',
            subjectId: orderNumber,
            notes: `Revert deadline (${REVERT_DEADLINE_MS}ms) exceeded after ${idx} of ${decremented.length} lines; remaining products: ${decremented.slice(idx).map((x) => x.productId).join(',')}`,
          })
        } catch {
          // audit() never throws
        }
        return
      }
      try {
        // J6 (round-4 m2): also surface `rowCount === 0` as a failure.
        // Without RETURNING-aware checking, a silent no-op (product was
        // deleted between decrement and revert) bypassed the catch and
        // the audit/Sentry alert never fired — inventory ledger drifted
        // with zero observability.
        const res = await pool.query(
          'UPDATE products SET inventory_quantity = inventory_quantity + $1 WHERE id = $2 RETURNING id',
          [d.quantity, d.productId],
        )
        if (!res.rowCount || res.rowCount === 0) {
          throw new Error(
            `Product ${d.productId} no longer exists; cannot revert inventory.`,
          )
        }
      } catch (e) {
        // I4 (C4) fix: previously this only console.error'd, so a partial-DB
        // outage that broke the revert path silently drifted inventory with
        // no operator visibility. We now emit a structured audit-log entry
        // AND a Sentry capture so the on-call gets paged.
        const errMsg = e instanceof Error ? e.message : String(e)
        console.error(
          `[inventory] FAILED to revert decrement of product ${d.productId} (qty ${d.quantity}) for order ${orderNumber} — manual reconciliation required: ${errMsg}`,
        )
        try {
          await audit({
            payload,
            kind: 'inventory.revert_failed',
            subjectType: 'products',
            subjectId: d.productId,
            diff: { before: undefined, after: { quantity: d.quantity, orderNumber } },
            notes: `Inventory revert failed during order create; ${errMsg}`,
          })
        } catch {
          // audit() never throws, but defensive
        }
        try {
          const Sentry = await import('@sentry/nextjs').catch(() => null)
          Sentry?.captureException(e, {
            tags: { area: 'inventory', kind: 'revert_failed' },
            extra: { productId: d.productId, quantity: d.quantity, orderNumber },
          })
        } catch {
          // Sentry unavailable — already logged + audited
        }
      }
    }
  }

  for (const l of lines.filter((x) => x.product.inventory?.trackQuantity)) {
    const productId = requireId(l.product.id)
    const allowBackorder = l.product.inventory?.allowBackorder ?? false
    const sql = allowBackorder
      ? 'UPDATE products SET inventory_quantity = inventory_quantity - $1 WHERE id = $2 RETURNING inventory_quantity'
      : 'UPDATE products SET inventory_quantity = inventory_quantity - $1 WHERE id = $2 AND inventory_quantity >= $1 RETURNING inventory_quantity'
    const res = await pool.query<{ inventory_quantity: number }>(sql, [
      l.quantity,
      productId,
    ])
    if (res.rowCount === 0) {
      await revertDecrements()
      throw new OrderValidationError(
        'out_of_stock_race',
        `${l.product.title} sold out while you were checking out. Please review your cart.`,
      )
    }
    decremented.push({ productId, quantity: l.quantity })
  }

  let order: Order
  try {
    order = (await payload.create({
      collection: 'orders',
      // Server-action context: we explicitly bypass access rules because this is
      // a system-mediated operation (the customer is creating their own order
      // via the checkout server action, not posting to /api/orders directly).
      overrideAccess: true,
      data: {
        orderNumber,
        confirmationToken,
        status: 'pending_payment',
        // M9: inventory was just deducted above for tracked lines, so the
        // cancel path is allowed to restore it. Quote-converted orders set
        // this false because their stock isn't held this way.
        inventoryDecremented: true,
        customer: toId(customerId),
        guestEmail: customerId ? undefined : customerEmail,
        lineItems: lines.map((l) => ({
          product: requireId(l.product.id),
          vendor: requireId(l.vendorId),
          titleSnapshot: l.product.title,
          skuSnapshot: l.product.sku ?? undefined,
          quantity: l.quantity,
          unitPriceMinor: l.unitPriceMinor,
          lineTotalMinor: l.lineTotalMinor,
        })),
        subtotalMinor,
        shippingMinor,
        taxMinor,
        totalMinor,
        currency: (currency ?? 'NAD') as 'NAD' | 'ZAR' | 'USD' | 'GBP' | 'EUR',
        shippingAddress: shipping,
        billingAddress: billing,
        fulfillment:
          chosenMethod.label || input.shippingLabelHint
            ? {
                carrier: chosenMethod.label || input.shippingLabelHint,
              }
            : undefined,
        notes,
      },
    })) as Order
  } catch (e) {
    await revertDecrements()
    throw e
  }

  // M17: stock just changed via raw SQL — bust the ISR cache for each
  // affected product page and the shop listing so the public site doesn't
  // serve a stale "in stock" badge.
  for (const d of decremented) {
    const lineProduct = lines.find((l) => requireId(l.product.id) === d.productId)
    await revalidateProductPath(lineProduct?.product.slug)
  }

  return order
}

export class OrderStatusTransitionError extends Error {
  code: string
  from: string
  constructor(from: string, message: string) {
    super(message)
    this.code = 'invalid_status_transition'
    this.from = from
    this.name = 'OrderStatusTransitionError'
  }
}

export async function markOrderPaid(
  orderId: string | number,
  payment: {
    processor: 'stripe' | 'flutterwave' | 'manual'
    processorRef: string
    /**
     * C3 fix: Stripe `charge.refunded` carries the PaymentIntent (`pi_…`),
     * not the Checkout Session id we store in `processorRef`. Pass the PI
     * here so refund webhooks can resolve the order via this field.
     * Optional because non-Stripe processors don't have a PI concept.
     */
    processorIntentRef?: string
    /**
     * Clean-room money M1 — the actual amount (minor units) the customer
     * was charged at the processor, INCLUDING any tax the processor added
     * (e.g. Stripe Tax). Used to size the paid-after-cancel auto-refund
     * correctly: order.totalMinor excludes Stripe Tax when the order was
     * cancelled before the tax-write ran, so refunding totalMinor would
     * leave the customer short by the tax. When provided, the auto-refund
     * uses this; otherwise it falls back to the order total.
     */
    amountChargedMinor?: number
  },
): Promise<Order> {
  const payload = await getPayload()
  // B73 fix: close the TOCTOU between read and update. The previous version
  // did findByID then payload.update — two concurrent webhook deliveries
  // could both see status='pending_payment' and both proceed, double-firing
  // the confirmation email and (worse) overwriting the processorRef on a
  // contested order. Single-statement conditional UPDATE is atomic at the
  // row level: exactly one delivery flips the order to 'paid', the rest
  // see rowCount=0 and fall through to the idempotent / terminal-status
  // branch below.
  const pool = (payload.db as unknown as { pool: import('pg').Pool }).pool
  const paidAt = new Date().toISOString()
  const updateRes = await pool.query<{ id: number; status: Order['status'] }>(
    `UPDATE orders
       SET status = 'paid'::enum_orders_status,
           payment_processor = $1::enum_orders_payment_processor,
           payment_processor_ref = $2,
           payment_processor_intent_ref = $3,
           payment_paid_at = $4::timestamptz,
           updated_at = NOW()
     WHERE id = $5
       AND status = 'pending_payment'::enum_orders_status
     RETURNING id, status`,
    [payment.processor, payment.processorRef, payment.processorIntentRef ?? null, paidAt, orderId],
  )

  if (updateRes.rowCount === 1) {
    // R10 money/correctness — happy-path tax reconciliation. Mirrors the
    // cancelled-branch reconcile (clean-room money M1). The Stripe
    // webhook path already does its own tax-write BEFORE calling
    // markOrderPaid, so totalMinor already equals amountChargedMinor and
    // this no-ops. The sweeper's webhook-miss recovery path calls
    // markOrderPaid directly without that pre-write, so without this
    // block totalMinor would stay tax-free and a later full refund would
    // be capped short by the tax. Idempotent (conditional on
    // amountChargedMinor > current total).
    if (typeof payment.amountChargedMinor === 'number') {
      try {
        const justUpdated = (await payload.findByID({
          collection: 'orders',
          id: orderId,
          depth: 0,
          overrideAccess: true,
        })) as Order
        if (payment.amountChargedMinor > justUpdated.totalMinor) {
          const extraTax = payment.amountChargedMinor - justUpdated.totalMinor
          await payload.update({
            collection: 'orders',
            id: orderId,
            overrideAccess: true,
            data: {
              totalMinor: payment.amountChargedMinor,
              taxMinor: (justUpdated.taxMinor ?? 0) + extraTax,
            },
          })
        }
      } catch (e) {
        console.error(
          `[markOrderPaid] tax reconciliation failed for order ${orderId}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        )
      }
    }
    // We owned the transition. Emit the audit entry directly because the
    // Payload afterChange hook only fires when status changes via the
    // Payload update path — raw SQL bypasses it.
    await audit({
      payload,
      kind: 'order.status_changed',
      subjectType: 'orders',
      subjectId: orderId,
      diff: { before: { status: 'pending_payment' }, after: { status: 'paid' } },
    })
    return (await payload.findByID({
      collection: 'orders',
      id: orderId,
      depth: 0,
      overrideAccess: true,
    })) as Order
  }

  // Lost the race (or order isn't in pending_payment to begin with). Re-read
  // and apply the same status policy as before:
  //   paid|processing|shipped|delivered → idempotent no-op
  //   cancelled|refunded|disputed → refuse
  const existing = (await payload.findByID({
    collection: 'orders',
    id: orderId,
    depth: 0,
    overrideAccess: true,
  })) as Order

  // M1 (round-6 C2) — paid-late race. The sweeper × late-Stripe-payment
  // interaction (round-5 L1 + B73): customer takes >30min to pay, sweeper
  // cancels the order + releases inventory, customer finally completes
  // payment, webhook arrives. The OLD behaviour threw here → webhook 500
  // → Stripe retries forever → customer's money is at Stripe, no order,
  // no auto-refund. We now distinguish two terminal cases:
  //
  //   cancelled  → we cancelled before payment confirmed, but Stripe took
  //                the money. Auto-create a refund row in 'pending' (the
  //                existing Refunds afterChange auto-issues via Stripe API)
  //                so the customer is made whole automatically.
  //   refunded   → already settled; nothing more to do, return existing.
  //   disputed   → human dispute flow; admin handles, don't auto-refund.
  if (existing.status === 'cancelled') {
    // Only auto-refund when this is a real customer payment we just
    // received (Stripe/Flutterwave) — for `manual` we shouldn't refund.
    if (payment.processor !== 'manual') {
      // R7 fix (5.17 regression): the auto-refund was previously created
      // in status='pending' on the assumption the existing Refunds
      // afterChange auto-issue chain would pick it up — but that chain
      // only fires on `previousDoc.status !== 'processing' && doc.status
      // === 'processing'`. A row created directly in 'pending' would
      // sit forever, customer permanently out the order total. We now
      // create directly in 'processing' (a) so the auto-issue hook
      // immediately calls issueProcessorRefund and (b) the cumulative
      // refund cap counts this in-flight row.
      //
      // R7 dedupe (paid-after-cancel × dashboard-refund race): if ops
      // already refunded the charge manually via the Stripe dashboard,
      // a `charge.refunded` webhook will have written a completed
      // refund row tagged with the same processorIntentRef. Short-circuit
      // creating a duplicate auto-refund in that case — the customer
      // is already covered, no need to fire a second Stripe API call.
      try {
        // R7 round-7 money C1 dedupe — if there's already a completed
        // or in-flight refund covering this order's total (e.g. the
        // operator refunded via the Stripe dashboard, captured by the
        // `charge.refunded` ledger handler), skip the auto-refund. The
        // customer is already covered; creating a second refund would
        // trip the cumulative cap and the markOrderPaid catch handler
        // would re-throw → infinite webhook retries with no customer
        // benefit. We sum across completed + processing + pending so
        // the dedupe is robust regardless of which path created the
        // existing row first.
        const { docs: priorRefunds } = await payload.find({
          collection: 'refunds',
          where: {
            and: [
              { order: { equals: existing.id } },
              { status: { in: ['completed', 'processing', 'pending'] } },
            ],
          },
          limit: 50,
          depth: 0,
          overrideAccess: true,
        })
        const priorTotal = (priorRefunds as Array<{ amountMinor?: number }>).reduce(
          (acc, r) => acc + (r.amountMinor ?? 0),
          0,
        )
        // Clean-room money M1 — refund what the customer was ACTUALLY
        // charged, not order.totalMinor. When Stripe Tax is enabled the
        // customer pays subtotal+shipping+tax, but the tax is only written
        // to totalMinor on the pending→paid path (gated on
        // status='pending_payment'). For an order cancelled before that
        // write, totalMinor still excludes the tax, so refunding it would
        // leave the customer short by the tax. The webhook passes
        // `amountChargedMinor` (= session.amount_total). If it exceeds the
        // recorded total, reconcile the order's total/tax first so the
        // Refunds cumulative cap (which checks order.totalMinor) permits
        // refunding the full charged amount.
        const chargedTotal =
          typeof payment.amountChargedMinor === 'number' &&
          payment.amountChargedMinor > existing.totalMinor
            ? payment.amountChargedMinor
            : existing.totalMinor
        if (chargedTotal > existing.totalMinor) {
          const extraTax = chargedTotal - existing.totalMinor
          await payload.update({
            collection: 'orders',
            id: existing.id,
            overrideAccess: true,
            data: {
              totalMinor: chargedTotal,
              taxMinor: (existing.taxMinor ?? 0) + extraTax,
            },
          })
        }
        if (priorTotal >= chargedTotal) {
          console.warn(
            `[markOrderPaid] order ${existing.orderNumber} paid-after-cancel: skipping auto-refund — existing refunds (${priorTotal}) already cover the charged amount (${chargedTotal}).`,
          )
          return existing
        }
        // Final audit L-1 — size the auto-refund as the REMAINING balance
        // (charged − already-refunded), not the full amount. If a partial
        // refund already exists, creating a full auto-refund would trip
        // the cumulative cap in Refunds.beforeChange → throw → the catch
        // below re-throws → webhook 500 → infinite Stripe retries.
        const remainingMinor = chargedTotal - priorTotal
        // R7: reference uses processorIntentRef (PI id) when present so
        // two distinct payments against the same Checkout Session don't
        // collide on the unique-reference constraint.
        const refRoot = payment.processorIntentRef ?? payment.processorRef
        const autoReference = `auto_${payment.processor}_${refRoot.slice(0, 24)}`
        // m1 (Phase 2): pre-check the reference. Two distinct Stripe
        // events for the same order (e.g. event_id rotated on retry, or
        // the webhook arriving after the sweeper already attempted
        // recovery) both reach this branch; without this check the
        // second `payload.create` throws on the unique-reference
        // constraint → caller catches and re-throws → webhook 500 →
        // infinite Stripe retry loop. If we find an existing row with
        // this reference, the previous attempt already queued the
        // refund; log and treat as success.
        const { docs: existingByRef } = await payload.find({
          collection: 'refunds',
          where: { reference: { equals: autoReference } },
          limit: 1,
          depth: 0,
          overrideAccess: true,
        })
        if (existingByRef.length > 0) {
          console.warn(
            `[markOrderPaid] order ${existing.orderNumber}: auto-refund ${autoReference} already exists — webhook redelivery, no action.`,
          )
          return existing
        }
        await payload.create({
          collection: 'refunds',
          overrideAccess: true,
          data: {
            reference: autoReference,
            order: existing.id,
            status: 'processing',
            amountMinor: remainingMinor,
            currency: existing.currency,
            reason: 'other',
            description:
              `Auto-refund: order was cancelled (likely by abandoned-order sweeper) before the ` +
              `${payment.processor} payment confirmation arrived. Customer paid; we owe them the money back.`,
            processor: payment.processor,
          },
        })
        await audit({
          payload,
          kind: 'order.status_changed',
          subjectType: 'orders',
          subjectId: orderId,
          diff: {
            before: { status: 'cancelled' },
            after: { status: 'cancelled', autoRefundQueued: true },
          },
          notes: `Paid-after-cancel detected — queued refund (${payment.processor} ref ${payment.processorRef}).`,
        })
        try {
          const Sentry = await import('@sentry/nextjs').catch(() => null)
          Sentry?.captureMessage(
            `paid-after-cancel: order ${existing.orderNumber} got payment after sweeper cancel; auto-refund queued`,
            'warning',
          )
        } catch {
          // Sentry not configured
        }
      } catch (e) {
        // Refund-create failed: this is a real ops incident. Log loudly +
        // re-throw so the webhook returns 500 and Stripe retries (better
        // than silently swallowing — at least the operator sees retries
        // piling up in the Stripe dashboard).
        console.error(
          `[markOrderPaid] order ${existing.orderNumber} paid-after-cancel: failed to queue auto-refund:`,
          e,
        )
        throw e
      }
    }
    // Return the existing (cancelled) order — webhook returns 200, Stripe
    // stops retrying, refund chain takes over.
    return existing
  }

  const terminal: Order['status'][] = ['refunded', 'disputed']
  if (terminal.includes(existing.status)) {
    throw new OrderStatusTransitionError(
      existing.status,
      `Refusing to mark order ${existing.orderNumber} as paid: status is ${existing.status}.`,
    )
  }
  if (
    existing.payment?.processorRef &&
    existing.payment.processorRef !== payment.processorRef
  ) {
    console.error(
      `[markOrderPaid] order ${existing.orderNumber} already paid via processorRef ${existing.payment.processorRef}; new ref ${payment.processorRef} ignored. Possible double-charge — verify with payment processor.`,
    )
  }
  return existing
}

/**
 * B72: counterpart to markOrderPaid for the Stripe `checkout.session.expired`
 * and `payment_intent.payment_failed` events. Atomically flips a still-pending
 * order to 'cancelled' and releases the inventory that createOrderFromCart
 * deducted. Idempotent: lost transitions (already cancelled, already paid,
 * etc.) no-op gracefully.
 */
export async function cancelOrderAndReleaseInventory(
  orderId: string | number,
  reason: string,
): Promise<{ cancelled: boolean; order: Order }> {
  const payload = await getPayload()
  const pool = (payload.db as unknown as { pool: import('pg').Pool }).pool

  const updateRes = await pool.query(
    `UPDATE orders
       SET status = 'cancelled'::enum_orders_status,
           updated_at = NOW()
     WHERE id = $1
       AND status = 'pending_payment'::enum_orders_status
     RETURNING id`,
    [orderId],
  )

  const order = (await payload.findByID({
    collection: 'orders',
    id: orderId,
    depth: 0,
    overrideAccess: true,
  })) as Order

  if (updateRes.rowCount !== 1) {
    // Either already cancelled (idempotent webhook redelivery) or already
    // paid (an `expired` event arrived after `completed` — Stripe ordering
    // isn't guaranteed). Don't release inventory; the paid order legitimately
    // holds it.
    return { cancelled: false, order }
  }

  // M9 fix: only release inventory if it was actually decremented at order
  // creation. Quote-converted orders go through acceptQuoteAndCreateOrder
  // which skips the decrement (B2B inventory is reserved out-of-band); if
  // we incremented anyway, cancellation of a quote order would inflate the
  // public stock count. The `inventoryDecremented` flag is set true by
  // createOrderFromCart and stays false by default elsewhere.
  if (!(order as { inventoryDecremented?: boolean }).inventoryDecremented) {
    await audit({
      payload,
      kind: 'order.status_changed',
      subjectType: 'orders',
      subjectId: orderId,
      diff: { before: { status: 'pending_payment' }, after: { status: 'cancelled' } },
      notes: `${reason} (inventory release skipped: not decremented at creation)`,
    })
    return { cancelled: true, order }
  }

  // We owned the transition — release the inventory we deducted at order
  // creation. inventory_track_quantity is checked at the SQL level so we
  // don't bother fetching products.
  //
  // Clean-room correctness — bound the total release time the same way
  // revertDecrements does. With many line items against a slow/hanging
  // DB, N serial pool.query calls (each waiting up to connectionTimeout)
  // could exceed the Vercel function deadline mid-release. Cap at 10s;
  // any un-released lines are audited for manual reconciliation.
  const RELEASE_DEADLINE_MS = 10_000
  const releaseStartedAt = Date.now()
  const releasedProductIds: Array<number | string> = []
  const lineItemsToRelease = order.lineItems ?? []
  for (let li = 0; li < lineItemsToRelease.length; li++) {
    const l = lineItemsToRelease[li]
    if (Date.now() - releaseStartedAt > RELEASE_DEADLINE_MS) {
      const remaining = lineItemsToRelease.slice(li)
      console.error(
        `[cancelOrder] release deadline exceeded after ${li}/${lineItemsToRelease.length} lines for order ${order.orderNumber}; ${remaining.length} lines logged for manual recon.`,
      )
      try {
        await audit({
          payload,
          kind: 'inventory.revert_failed',
          subjectType: 'orders',
          subjectId: orderId,
          notes: `Release deadline (${RELEASE_DEADLINE_MS}ms) exceeded after ${li} of ${lineItemsToRelease.length} lines; remaining products: ${remaining
            .map((x) =>
              typeof x.product === 'object' && x.product !== null
                ? (x.product as { id: number }).id
                : x.product,
            )
            .join(',')}`,
        })
      } catch {
        // audit never throws
      }
      break
    }
    const productId =
      typeof l.product === 'object' && l.product !== null
        ? (l.product as { id: number }).id
        : (l.product as number)
    try {
      const res = await pool.query(
        `UPDATE products
           SET inventory_quantity = inventory_quantity + $1
         WHERE id = $2
           AND inventory_track_quantity = true
         RETURNING id`,
        [l.quantity, productId],
      )
      if (res.rowCount && res.rowCount > 0) releasedProductIds.push(productId)
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e)
      console.error(
        `[cancelOrder] failed to release inventory for product ${productId} on order ${order.orderNumber}: ${errMsg}`,
      )
      // I4 (C4): mirror the create-time alerting path. A release-time
      // failure also drifts inventory silently — emit an audit row + Sentry.
      try {
        await audit({
          payload,
          kind: 'inventory.revert_failed',
          subjectType: 'products',
          subjectId: productId,
          diff: { before: undefined, after: { quantity: l.quantity, orderNumber: order.orderNumber } },
          notes: `Inventory release failed during cancel; ${errMsg}`,
        })
      } catch {
        // audit() never throws
      }
      try {
        const Sentry = await import('@sentry/nextjs').catch(() => null)
        Sentry?.captureException(e, {
          tags: { area: 'inventory', kind: 'release_failed' },
          extra: { productId, quantity: l.quantity, orderNumber: order.orderNumber },
        })
      } catch {
        // Sentry unavailable
      }
    }
  }
  // M17: same revalidation concern as createOrderFromCart — raw SQL skips
  // afterChange hooks, so the storefront stays stale until the next save
  // without this purge.
  if (releasedProductIds.length > 0) {
    const releasedProducts = await getProductsByIds(releasedProductIds)
    for (const p of releasedProducts) {
      await revalidateProductPath(p.slug)
    }
  }

  // m3 (Phase 2): include the released-vs-total count in the final
  // status-changed audit notes. Operators previously had to correlate
  // this row with a sibling `inventory.revert_failed` audit to see that
  // the release loop hit its deadline or skipped lines; embedding the
  // count makes the partial-release reality visible on the one audit
  // they're most likely to look at.
  const releasedCountSuffix = ` (released ${releasedProductIds.length}/${lineItemsToRelease.length} lines)`
  await audit({
    payload,
    kind: 'order.status_changed',
    subjectType: 'orders',
    subjectId: orderId,
    diff: { before: { status: 'pending_payment' }, after: { status: 'cancelled' } },
    notes: `${reason}${releasedCountSuffix}`,
  })

  return { cancelled: true, order }
}

export async function findOrderByNumber(orderNumber: string): Promise<Order | null> {
  const payload = await getPayload()
  const { docs } = await payload.find({
    collection: 'orders',
    where: { orderNumber: { equals: orderNumber } },
    limit: 1,
    depth: 1,
    overrideAccess: true,
  })
  return (docs[0] ?? null) as Order | null
}

/**
 * Resolve the email address an order's confirmation should go to.
 * Guest orders store `guestEmail` directly; signed-in customers' emails
 * live on the linked User record. Returns null only when neither is
 * available — caller treats that as a hard error.
 */
export async function resolveOrderEmail(order: Order): Promise<string | null> {
  if (order.guestEmail) return order.guestEmail
  const customer = order.customer
  if (!customer) return null
  if (typeof customer === 'object' && customer != null && 'email' in customer) {
    return (customer as { email?: string }).email ?? null
  }
  const payload = await getPayload()
  try {
    const user = (await payload.findByID({
      collection: 'users',
      id: customer as number,
      depth: 0,
      overrideAccess: true,
    })) as { email?: string }
    return user.email ?? null
  } catch {
    return null
  }
}
