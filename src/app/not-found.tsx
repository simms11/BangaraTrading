import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Button } from '@/components/ui/button'
import { SiteHeader } from '@/components/site/site-header'
import { SiteFooter } from '@/components/site/site-footer'
import { readCart } from '@/lib/cart/store'
import { getCurrentUser } from '@/lib/auth'

export default async function NotFound() {
  // M15 (Phase 2) — the 404 page used to render <SiteHeader/> with
  // hard-coded zeros, which made the header forget the user's cart
  // count and signed-in state on any mistyped URL. Match the marketing
  // layout's pattern and pass real values through.
  const [cart, user] = await Promise.all([readCart(), getCurrentUser()])
  const cartCount = cart.items.reduce((acc, i) => acc + i.quantity, 0)
  return (
    <>
      <SiteHeader cartCount={cartCount} isSignedIn={!!user} />
      <main id="main" className="pt-20">
        <section className="py-32">
          <Container size="md" className="text-center space-y-6">
            <p className="font-mono text-sm text-brand-700">404</p>
            <h1 className="font-display text-5xl font-semibold tracking-tight">Page not found</h1>
            <p className="mx-auto max-w-md text-muted-foreground">
              The page you&apos;re looking for has either moved or isn&apos;t live yet.
            </p>
            <Button asChild variant="primary">
              <Link href="/">Back home</Link>
            </Button>
          </Container>
        </section>
      </main>
      <SiteFooter />
    </>
  )
}
