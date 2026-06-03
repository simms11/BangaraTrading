'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { reportError } from '@/lib/report-error'

export default function VendorError({
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
    <div className="rounded-2xl border border-spice-200 bg-spice-50 p-8 text-spice-900">
      <p className="font-mono text-xs text-muted-foreground">
        Reference {error.digest ?? 'unknown'}
      </p>
      <h2 className="mt-2 font-display text-2xl font-semibold">
        We hit a problem loading your dashboard.
      </h2>
      <p className="mt-2 text-sm">
        We&apos;ve been notified. Try again, or refresh the page.
      </p>
      <div className="mt-4">
        <Button variant="primary" size="sm" onClick={() => reset()}>
          Try again
        </Button>
      </div>
    </div>
  )
}
