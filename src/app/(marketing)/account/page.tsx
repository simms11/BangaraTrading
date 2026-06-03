import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Container } from '@/components/ui/container'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardTitle } from '@/components/ui/card'
import { getCurrentUser } from '@/lib/auth'
import { signOutAction } from '@/lib/auth-actions'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Your account',
  alternates: { canonical: '/account' },
  // H7 minor: align with /account/orders + /account/quotes — auth-gated
  // pages should explicitly opt out of indexing even though the access
  // gate already rejects crawlers without a session cookie.
  robots: { index: false, follow: false },
}

export default async function AccountPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/sign-in')
  if (user.role === 'vendor') redirect('/vendor')
  if (user.role === 'admin') redirect('/admin')

  return (
    <section className="py-16">
      <Container size="md" className="space-y-8">
        <header className="space-y-2">
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            Hi {user.name ?? user.email.split('@')[0]}
          </h1>
          <p className="text-muted-foreground">{user.email}</p>
        </header>

        <div className="grid gap-6 sm:grid-cols-2">
          <Card>
            <CardContent className="space-y-3 pt-6">
              <CardTitle>Orders</CardTitle>
              <p className="text-sm text-muted-foreground">
                Your order history and tracking.
              </p>
              <Button asChild variant="primary">
                <Link href="/account/orders">View orders</Link>
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-3 pt-6">
              <CardTitle>Quotes</CardTitle>
              <p className="text-sm text-muted-foreground">
                Bulk and wholesale enquiries you&apos;ve submitted.
              </p>
              <Button asChild variant="outline">
                <Link href="/account/quotes">View quotes</Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        <form action={signOutAction}>
          <Button type="submit" variant="link" className="px-0">
            Sign out
          </Button>
        </form>
      </Container>
    </section>
  )
}
