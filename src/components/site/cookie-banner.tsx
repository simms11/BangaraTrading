'use client'

import * as React from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

const STORAGE_KEY = 'bangarah_cookie_consent_v1'

type Consent = {
  necessary: true
  analytics: boolean
  acceptedAt: number
}

function loadConsent(): Consent | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Consent
    if (parsed?.necessary !== true) return null
    return parsed
  } catch {
    return null
  }
}

function saveConsent(c: Consent) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(c))
  // Dispatch a custom event so analytics scripts can listen and opt in.
  window.dispatchEvent(new CustomEvent('bangarah:consent', { detail: c }))
}

export function CookieBanner() {
  const [open, setOpen] = React.useState(false)
  const [analytics, setAnalytics] = React.useState(false)

  React.useEffect(() => {
    const existing = loadConsent()
    if (!existing) setOpen(true)
  }, [])

  if (!open) return null

  const acceptAll = () => {
    saveConsent({ necessary: true, analytics: true, acceptedAt: Date.now() })
    setOpen(false)
  }
  const acceptNecessary = () => {
    saveConsent({ necessary: true, analytics: false, acceptedAt: Date.now() })
    setOpen(false)
  }
  const save = () => {
    saveConsent({ necessary: true, analytics, acceptedAt: Date.now() })
    setOpen(false)
  }

  return (
    <div
      role="dialog"
      aria-label="Cookie preferences"
      aria-modal="false"
      className="fixed inset-x-3 bottom-3 z-[60] max-w-2xl rounded-2xl border border-border bg-white p-5 shadow-xl sm:left-1/2 sm:right-auto sm:-translate-x-1/2"
    >
      <h2 className="font-display text-lg font-semibold">Cookies & your privacy</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        We use cookies to keep you signed in and your cart intact. Optional analytics
        cookies help us understand which products and pages perform best.{' '}
        <Link href="/cookies" className="font-medium text-brand-700 underline-offset-4 hover:underline">
          Read our cookie policy
        </Link>
        .
      </p>
      <div className="mt-3 space-y-2 text-sm">
        <label className="flex items-start gap-2 text-muted-foreground">
          <input type="checkbox" checked disabled className="mt-1" />
          <span>
            <strong className="text-foreground">Necessary</strong> — always on. Required for sign-in, cart, and order processing.
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={analytics}
            onChange={(e) => setAnalytics(e.target.checked)}
            className="mt-1"
            id="cookie-analytics"
          />
          <span>
            <strong>Analytics</strong> — anonymous usage stats so we can improve the
            store. No advertising, no third-party data sale.
          </span>
        </label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={acceptAll}>
          Accept all
        </Button>
        <Button variant="outline" size="sm" onClick={save}>
          Save preferences
        </Button>
        <Button variant="ghost" size="sm" onClick={acceptNecessary}>
          Necessary only
        </Button>
      </div>
    </div>
  )
}
