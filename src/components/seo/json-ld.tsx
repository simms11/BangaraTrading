/**
 * Server-rendered JSON-LD blocks. Use one per page (Product, Organization,
 * BreadcrumbList, etc.). Schema is intentionally minimal — extend as the
 * catalog matures.
 */

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

/**
 * H2 fix (stored XSS): `JSON.stringify` does NOT escape `<`, `>`, `&`,
 * U+2028, or U+2029. A vendor-controllable string in `product.title`
 * containing `</script><script>alert(1)</script>` would break out of the
 * inline JSON-LD block and execute attacker JS in the storefront origin.
 * Escape every sequence that can terminate a `<script>` tag (or break
 * JSON parsing in modern JS contexts) before injecting.
 *
 * U+2028 / U+2029 are constructed via String.fromCharCode so the source
 * file itself doesn't contain those characters (some editors/tools
 * mis-handle them in source).
 */
const LINE_SEPARATOR = String.fromCharCode(0x2028)
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029)
export function safeStringify(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replaceAll(LINE_SEPARATOR, '\\u2028')
    .replaceAll(PARAGRAPH_SEPARATOR, '\\u2029')
}

export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return (
    <script
      type="application/ld+json"
      // JSON-LD must be inlined verbatim; safeStringify hardens it against
      // a script-tag-breakout via any user-controllable field.
      dangerouslySetInnerHTML={{ __html: safeStringify(data) }}
    />
  )
}

export function OrganizationJsonLd() {
  return (
    <JsonLd
      data={{
        '@context': 'https://schema.org',
        '@type': 'Organization',
        inLanguage: 'en',
        name: 'Bangarah Trading Enterprises',
        url: siteUrl,
        logo: `${siteUrl}/logo.png`,
        foundingDate: '2011',
        address: {
          '@type': 'PostalAddress',
          streetAddress: 'Unit 8, Omumbonde Industrial Park Extension',
          addressLocality: 'Okahandja',
          addressCountry: 'NA',
          postOfficeBoxNumber: '27176',
        },
        contactPoint: [
          {
            '@type': 'ContactPoint',
            telephone: '+264-855-63-6381',
            contactType: 'sales',
            email: 'enquiry@bangarahtradingenterprises.com',
            availableLanguage: ['en'],
          },
          {
            '@type': 'ContactPoint',
            telephone: '+264-813-416-764',
            contactType: 'emergency',
            availableLanguage: ['en'],
          },
        ],
      }}
    />
  )
}

type ProductJsonLdInput = {
  title: string
  slug: string
  description: string
  priceMinor: number
  currency: string
  sku?: string
  imageUrls?: string[]
  vendorName?: string
  inStock: boolean
}

export function ProductJsonLd(p: ProductJsonLdInput) {
  return (
    <JsonLd
      data={{
        '@context': 'https://schema.org',
        '@type': 'Product',
        inLanguage: 'en',
        name: p.title,
        description: p.description,
        sku: p.sku,
        image: p.imageUrls?.length ? p.imageUrls : [`${siteUrl}/logo.png`],
        brand: p.vendorName ? { '@type': 'Brand', name: p.vendorName } : undefined,
        offers: {
          '@type': 'Offer',
          url: `${siteUrl}/products/${p.slug}`,
          priceCurrency: p.currency,
          price: (p.priceMinor / 100).toFixed(2),
          availability: p.inStock
            ? 'https://schema.org/InStock'
            : 'https://schema.org/OutOfStock',
        },
      }}
    />
  )
}

export function BreadcrumbJsonLd({ items }: { items: { name: string; href: string }[] }) {
  return (
    <JsonLd
      data={{
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        inLanguage: 'en',
        itemListElement: items.map((it, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: it.name,
          item: `${siteUrl}${it.href}`,
        })),
      }}
    />
  )
}
