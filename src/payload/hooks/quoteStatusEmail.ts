import type { CollectionAfterChangeHook } from 'payload'

/**
 * Fires whenever a Quote document is changed in admin.
 * On transition into the `quoted` status, we notify the customer via
 * the QuoteResponseEmail with the per-line pricing the vendor entered.
 *
 * Idempotent: only fires when previousDoc.status !== 'quoted' AND doc.status === 'quoted'.
 */
export const quoteStatusEmailHook: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  req,
  operation,
}) => {
  // K5 (round-5 minor m1) — only fire on the initial submitted/reviewing
  // → quoted transition. The previous gate (`!wasQuoted`) also re-fired
  // the customer email when admin flipped accepted/declined/expired →
  // quoted (re-quote workflow), sending another "your quote is ready"
  // email with prices that may have changed silently between sessions.
  if (operation !== 'update') return doc
  const isInitialQuote =
    (previousDoc?.status === 'submitted' || previousDoc?.status === 'reviewing') &&
    doc?.status === 'quoted'
  if (!isInitialQuote) return doc

  try {
    // Lazy-import the emailers so we never pull server-only modules into the
    // admin client bundle.
    const { sendQuoteResponse } = await import('@/lib/email')
    const { formatPrice } = await import('@/lib/utils')

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
    const currency = doc.currency || 'NAD'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items: any[] = doc.items ?? []
    const totalMinor = items.reduce(
      (acc, l) => acc + (l.unitPriceQuoteMinor ?? 0) * (l.quantity ?? 0),
      0,
    )

    await sendQuoteResponse({
      to: doc.customerEmail,
      props: {
        quoteNumber: doc.quoteNumber,
        customerName: doc.customerName,
        totalFormatted: formatPrice(doc.totalEstimateMinor ?? totalMinor, currency),
        validUntil: doc.response?.validUntil ?? undefined,
        responseMessage: doc.response?.message ?? undefined,
        items: items.map((l) => ({
          title: l.titleSnapshot,
          quantity: l.quantity,
          unitPriceFormatted: formatPrice(l.unitPriceQuoteMinor ?? 0, currency),
        })),
        // SECURITY (C2): the accept URL must carry the per-quote token so
        // the customer can view + accept their quote. Without `?t=...` the
        // /quotes/[quoteNumber] page now renders not-found for non-owners.
        acceptUrl: `${siteUrl}/quotes/${doc.quoteNumber}?t=${doc.confirmationToken ?? ''}`,
        siteUrl,
      },
    })
    req.payload.logger?.info?.(`[quote] sent response email for ${doc.quoteNumber}`)
  } catch (err) {
    req.payload.logger?.error?.(`[quote] response email failed: ${(err as Error).message}`)
  }
  return doc
}
