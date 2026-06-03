'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Button } from '@/components/ui/button'
import { reportError } from '@/lib/report-error'

export default function MarketingError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    reportError(error)
  }, [error])

  return (
    <section className="py-24">
      <Container size="md" className="text-center space-y-6">
        <p className="font-mono text-xs text-muted-foreground">
          Reference {error.digest ?? 'unknown'}
        </p>
        <h1 className="font-display text-4xl font-semibold tracking-tight">
          Something went wrong
        </h1>
        <p className="mx-auto max-w-md text-muted-foreground">
          We&apos;ve been notified. Try again in a moment, or pick up where you left off.
        </p>
        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button variant="primary" onClick={() => reset()}>
            Try again
          </Button>
          <Button asChild variant="outline">
            <Link href="/">Back home</Link>
          </Button>
        </div>
      </Container>
    </section>
  )
}
