import type { Metadata, Viewport } from 'next'
import { Inter, Fraunces } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  axes: ['SOFT', 'WONK', 'opsz'],
})

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Bangarah Trading — Premium African sauces, honey & specialty goods',
    template: '%s · Bangarah Trading',
  },
  description:
    'Marketplace for African and Caribbean sole traders. Premium sauces, pure honey, food supplements and specialty imports — shipped across Africa and the diaspora.',
  applicationName: 'Bangarah Trading',
  authors: [{ name: 'Bangarah Trading Enterprises' }],
  keywords: [
    'Bangarah Trading',
    "Ayisha's Herbal Sauces",
    "Kiyaya's Brand",
    'Namibia honey',
    'African marketplace',
    'Caribbean imports',
    'B2B trade Africa',
  ],
  openGraph: {
    title: 'Bangarah Trading — African marketplace',
    description:
      'Premium sauces, honey and specialty goods from African and Caribbean sole traders. Established 2011.',
    url: siteUrl,
    siteName: 'Bangarah Trading',
    type: 'website',
    locale: 'en_NA',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Bangarah Trading — African marketplace',
    description: 'Premium African and Caribbean sauces, honey and specialty goods.',
  },
  robots: { index: true, follow: true },
  // M14 (Phase 2) — the previous `icons` block referenced
  // /favicon.ico + /apple-touch-icon.png, neither of which exist under
  // public/, so every page request 404'd both. Removing the explicit
  // declaration so Next.js doesn't emit the <link rel="icon"> tags.
  // When favicon assets are added to public/ or src/app/icon.png, they
  // are picked up automatically by Next's file-based icons convention;
  // no metadata change is required at that point.
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fdfcf9' },
    { media: '(prefers-color-scheme: dark)', color: '#0a1335' },
  ],
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" className={`${inter.variable} ${fraunces.variable}`}>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-brand-900 focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  )
}
