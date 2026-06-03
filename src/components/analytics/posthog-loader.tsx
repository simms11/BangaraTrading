'use client'

import * as React from 'react'

const CONSENT_KEY = 'bangarah_cookie_consent_v1'

type Consent = { necessary: true; analytics: boolean; acceptedAt: number }

declare global {
  interface Window {
    posthog?: {
      init: (key: string, opts: Record<string, unknown>) => void
      opt_in_capturing: () => void
      opt_out_capturing: () => void
      __loaded?: boolean
    }
  }
}

/**
 * Loads PostHog via its CDN snippet, gated on cookie consent.
 *
 * We deliberately do NOT bundle posthog-js into our app JS — instead we
 * inject the official loader at runtime when the visitor opts in. Three
 * benefits: (1) zero JS cost for visitors who decline analytics; (2) keeps
 * our shared bundle small; (3) PostHog can update without us redeploying.
 *
 * The component listens for the `bangarah:consent` event the cookie banner
 * dispatches, so the snippet appears the moment the visitor opts in (no
 * refresh required). If consent is withdrawn, we call opt_out_capturing.
 */
export function PostHogLoader() {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  const host =
    process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com'

  React.useEffect(() => {
    if (!key) return

    const loadSnippet = () => {
      if (window.posthog?.__loaded) {
        window.posthog.opt_in_capturing()
        return
      }
      const s = document.createElement('script')
      s.src = `${host}/static/array.js`
      s.async = true
      s.onload = () => {
        if (!window.posthog) return
        window.posthog.init(key, {
          api_host: host,
          capture_pageview: 'history_change',
          disable_session_recording: true,
          persistence: 'localStorage+cookie',
          autocapture: false,
        })
      }
      document.head.appendChild(s)
    }

    const apply = (consent: Consent | null) => {
      if (consent?.analytics) loadSnippet()
      else if (window.posthog?.__loaded) window.posthog.opt_out_capturing()
    }

    try {
      const raw = window.localStorage.getItem(CONSENT_KEY)
      const consent = raw ? (JSON.parse(raw) as Consent) : null
      apply(consent)
    } catch {
      /* no-op */
    }

    const handler = (event: Event) => {
      apply((event as CustomEvent<Consent>).detail)
    }
    window.addEventListener('bangarah:consent', handler)
    return () => window.removeEventListener('bangarah:consent', handler)
  }, [key, host])

  return null
}
