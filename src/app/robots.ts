import type { MetadataRoute } from 'next'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // K5 (round-5 m8) — also disallow /vendor (session-gated dashboard)
      // and /orders + /quotes (token-gated guest pages — shouldn't be
      // indexed even though their meta declares robots:none).
      { userAgent: '*', allow: '/', disallow: ['/admin', '/api', '/account', '/vendor', '/orders', '/quotes'] },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  }
}
