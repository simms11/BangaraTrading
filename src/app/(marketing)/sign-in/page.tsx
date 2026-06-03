import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { Container } from '@/components/ui/container'
import { SignInForm } from '@/components/auth/sign-in-form'
import { getCurrentUser } from '@/lib/auth'

export const metadata: Metadata = {
  title: 'Sign in',
  alternates: { canonical: '/sign-in' },
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await getCurrentUser()
  if (user) {
    // R11 — preserve the `next` destination for a guest mid-checkout
    // whose session is restored (e.g. browser back-button from Stripe).
    // Same safety guard as the post-login redirect.
    const sp = await searchParams
    const next = typeof sp.next === 'string' ? sp.next : ''
    const safeNext = next && /^\/[^/\\]/.test(next) && !/[\x00-\x1F\x7F]/.test(next) ? next : null
    redirect(safeNext ?? '/account')
  }

  return (
    <section className="py-20">
      <Container size="sm" className="max-w-md space-y-6">
        <header className="space-y-2 text-center">
          <h1 className="font-display text-4xl font-semibold tracking-tight">Welcome back</h1>
          <p className="text-muted-foreground">Sign in to your Bangarah account.</p>
        </header>
        {/* Clean-room frontend — Suspense boundary required because
            SignInForm reads useSearchParams (the `next` param). */}
        <Suspense fallback={null}>
          <SignInForm />
        </Suspense>
      </Container>
    </section>
  )
}
