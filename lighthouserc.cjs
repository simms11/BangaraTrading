/**
 * Lighthouse CI configuration.
 *
 * Asserts performance + accessibility + best-practices + SEO budgets on
 * the highest-traffic routes. The thresholds are intentionally tight —
 * if you genuinely need to ship a regression, edit this file in the same
 * PR so it's reviewable.
 */
module.exports = {
  ci: {
    collect: {
      url: [
        'http://localhost:3000/',
        'http://localhost:3000/shop',
        'http://localhost:3000/products/ayishas-herbal-sauce-original',
        'http://localhost:3000/about',
      ],
      numberOfRuns: 2,
      settings: {
        // Mobile preset by default; bump to desktop for stricter assertions later.
        preset: 'desktop',
        // Newer Lighthouse stopped appending "Chrome-Lighthouse" to its
        // network UA. Next 15 streams metadata into the <body> on dynamic
        // routes UNLESS the UA matches its html-limited-bots list (which
        // includes Chrome-Lighthouse) — without the token the
        // meta-description audit scores 0 on every page even though the
        // tag is served. Restoring it keeps the audit honest with zero
        // production behavior change.
        emulatedUserAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Chrome-Lighthouse',
        // Skip PWA category — we're not registering a service worker.
        onlyCategories: [
          'performance',
          'accessibility',
          'best-practices',
          'seo',
        ],
      },
    },
    assert: {
      assertions: {
        // Categories
        'categories:performance': ['error', { minScore: 0.85 }],
        'categories:accessibility': ['error', { minScore: 0.95 }],
        'categories:best-practices': ['error', { minScore: 0.9 }],
        'categories:seo': ['error', { minScore: 0.9 }],

        // Core Web Vitals
        'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
        'total-blocking-time': ['error', { maxNumericValue: 300 }],

        // Bytes
        'unused-javascript': ['warn', { maxNumericValue: 100_000 }],

        // A11y-specific tightenings
        'color-contrast': 'error',
        'image-alt': 'error',
        label: 'error',
        'meta-description': 'error',
        'html-has-lang': 'error',
      },
    },
    upload: {
      target: 'temporary-public-storage',
    },
  },
}
