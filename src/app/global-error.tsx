'use client'

import { useEffect } from 'react'
import { reportError } from '@/lib/report-error'

/**
 * Catches errors thrown inside the root layout itself (very rare). Renders
 * its own <html>/<body> because Next's layout machinery is unavailable
 * at this level. Native <a> is required for the same reason.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string }
}) {
  useEffect(() => {
    reportError(error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: '64px 24px',
          fontFamily: 'system-ui, sans-serif',
          background: '#fdfcf9',
          color: '#0f172a',
        }}
      >
        <div style={{ maxWidth: 560, margin: '0 auto', textAlign: 'center' }}>
          <p style={{ fontFamily: 'monospace', color: '#57534e', fontSize: 12 }}>
            Reference {error.digest ?? 'unknown'}
          </p>
          <h1 style={{ fontSize: 32, fontWeight: 600, margin: '12px 0' }}>
            Something went wrong.
          </h1>
          <p style={{ color: '#57534e' }}>
            We&apos;ve been notified and are looking into it. Please try again shortly.
          </p>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            style={{
              display: 'inline-block',
              marginTop: 24,
              padding: '10px 20px',
              borderRadius: 999,
              background: '#0f1d4d',
              color: 'white',
              textDecoration: 'none',
              fontWeight: 600,
            }}
          >
            Back home
          </a>
        </div>
      </body>
    </html>
  )
}
