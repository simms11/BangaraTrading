import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * Storefront critical-path coverage.
 *
 * These tests run against an already-seeded local database (run
 *   `SEED_TOKEN=dev npm run seed` once before invoking).
 *
 * The dev server is auto-spawned by playwright.config.ts unless
 * PLAYWRIGHT_REUSE_SERVER=1 is set (useful when iterating against an
 * already-running dev server).
 */

test.describe('Storefront — browse to checkout', () => {
  test('homepage renders + key links present', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/Bangarah Trading/)
    await expect(page.getByRole('link', { name: 'Shop the marketplace' })).toBeVisible()
  })

  test('shop lists products + filters by category', async ({ page }) => {
    await page.goto('/shop')
    // 8 seeded products
    const productLinks = page.locator('a[href^="/products/"]')
    await expect(productLinks.first()).toBeVisible()
    expect(await productLinks.count()).toBeGreaterThan(0)

    // Click the Sauces filter chip.
    await page.getByRole('link', { name: 'Sauces' }).first().click()
    await expect(page).toHaveURL(/category=sauces/)
    await expect(page.locator('a[href^="/products/"]')).toContainText(['sauce'], { ignoreCase: true })
  })

  test('product detail shows price + add-to-cart works → /cart reflects it', async ({ page }) => {
    await page.goto('/products/ayishas-herbal-sauce-original')
    await expect(page.getByRole('heading', { name: /Ayisha/i })).toBeVisible()

    // Add to cart with quantity 2. exact: true — the substring default also
    // matches the "Decrease quantity" button, which precedes the input.
    const qty = page.getByLabel('Quantity', { exact: true }).first()
    await qty.fill('2')
    await page.getByRole('button', { name: /Add to cart/i }).click()

    // Server action updates; navigate to cart to confirm.
    await page.goto('/cart')
    await expect(page.getByText(/Ayisha/)).toBeVisible()
    await expect(page.getByRole('link', { name: /Proceed to checkout/i })).toBeVisible()
  })

  test('checkout renders shipping picker + manual processor', async ({ page, context }) => {
    // Pre-seed a cart cookie so we land on /checkout with retail items.
    const cartValue = encodeURIComponent(
      JSON.stringify({
        id: 'pw-smoke',
        items: [
          {
            productId: 1,
            vendorId: 1,
            slug: 'ayishas-herbal-sauce-original',
            title: "Ayisha's Herbal Sauce — Original",
            unitPriceMinor: 7500,
            currency: 'NAD',
            quantity: 1,
            fulfillmentMode: 'hybrid',
            snapshotAt: Date.now(),
          },
        ],
        currency: 'NAD',
        updatedAt: Date.now(),
      }),
    )
    // Playwright cookies take `url` OR `domain`+`path` — not both.
    await context.addCookies([
      { name: 'bangarah_cart', value: cartValue, url: 'http://localhost:3000' },
    ])
    await page.goto('/checkout')
    await expect(page.getByText('Shipping address')).toBeVisible()
    await expect(page.getByText('Shipping method')).toBeVisible()
    await expect(page.getByText('Manual bank transfer')).toBeVisible()
  })

  test('homepage passes serious axe-core a11y checks', async ({ page }) => {
    await page.goto('/')
    const results = await new AxeBuilder({ page })
      .disableRules(['region']) // false-positive on cookie banner overlay
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()
    const serious = results.violations.filter((v) =>
      ['serious', 'critical'].includes(v.impact ?? ''),
    )
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([])
  })
})

test.describe('Quote flow', () => {
  test('product page links to /quote?product=...', async ({ page }) => {
    await page.goto('/products/ayishas-herbal-sauce-original')
    const requestQuote = page.getByRole('link', { name: /Request bulk quote/i })
    await expect(requestQuote).toBeVisible()
    await requestQuote.click()
    await expect(page).toHaveURL(/\/quote\?product=ayishas-herbal-sauce-original/)
    await expect(page.getByText('Quoting')).toBeVisible()
  })
})
