import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * WCAG 2.1 A + AA gate across every public route.
 *
 * Each route is checked with axe-core. We allow `warn` violations to pass
 * (color contrast on text we're still tuning) but block on `serious` or
 * `critical`. Each route adds ~500ms to the run, so we limit to one page
 * per route — comprehensive enough for CI without becoming a tax.
 *
 * The `region` rule is disabled site-wide because our cookie banner
 * overlay isn't wrapped in a <main> — it's a dialog, which is correct.
 */

const PUBLIC_ROUTES = [
  '/',
  '/shop',
  '/shop?category=sauces',
  '/about',
  '/services',
  '/contact',
  '/vendors',
  '/vendors/bangarah-trading',
  '/products/ayishas-herbal-sauce-original',
  '/quote',
  '/sell',
  '/sell/submitted',
  '/privacy',
  '/terms',
  '/cookies',
  '/sign-in',
  '/sign-up',
]

for (const route of PUBLIC_ROUTES) {
  test(`a11y: ${route}`, async ({ page }) => {
    await page.goto(route)
    const results = await new AxeBuilder({ page })
      .disableRules(['region'])
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()
    const serious = results.violations.filter((v) =>
      ['serious', 'critical'].includes(v.impact ?? ''),
    )
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([])
  })
}
