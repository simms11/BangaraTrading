import { SiteHeader } from '@/components/site/site-header'
import { SiteFooter } from '@/components/site/site-footer'
import { OrganizationJsonLd } from '@/components/seo/json-ld'
import { CookieBanner } from '@/components/site/cookie-banner'
import { PostHogLoader } from '@/components/analytics/posthog-loader'
import { readCart } from '@/lib/cart/store'
import { getCurrentUser } from '@/lib/auth'

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const [cart, user] = await Promise.all([readCart(), getCurrentUser()])
  const cartCount = cart.items.reduce((acc, i) => acc + i.quantity, 0)

  return (
    <>
      <OrganizationJsonLd />
      <SiteHeader cartCount={cartCount} isSignedIn={!!user} />
      <main id="main" className="pt-20">
        {children}
      </main>
      <SiteFooter />
      <CookieBanner />
      <PostHogLoader />
    </>
  )
}
