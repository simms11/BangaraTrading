import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { Container } from '@/components/ui/container'
import { SignUpForm } from '@/components/auth/sign-up-form'
import { getCurrentUser } from '@/lib/auth'

export const metadata: Metadata = {
  title: 'Create your account',
  alternates: { canonical: '/sign-up' },
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await getCurrentUser()
  if (user) {
    // R11 — preserve the `next` destination so a session-restored guest
    // mid-checkout returns there instead of /account.
    const sp = await searchParams
    const next = typeof sp.next === 'string' ? sp.next : ''
    const safeNext = next && /^\/[^/\\]/.test(next) && !/[\x00-\x1F\x7F]/.test(next) ? next : null
    redirect(safeNext ?? '/account')
  }

  return (
    <section className="py-20">
      <Container size="sm" className="max-w-md space-y-6">
        <header className="space-y-2 text-center">
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            Create your account
          </h1>
          <p className="text-muted-foreground">
            Track orders, save addresses, and check out faster next time.
          </p>
        </header>
        {/* Clean-room frontend — Suspense boundary required because
            SignUpForm reads useSearchParams (the `next` param). */}
        <Suspense fallback={null}>
          <SignUpForm />
        </Suspense>
      </Container>
    </section>
  )
}
