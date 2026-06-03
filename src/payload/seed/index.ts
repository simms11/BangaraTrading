/**
 * Idempotent seed: creates the admin user, anchor vendor (Bangarah),
 * categories, and a baseline product catalog drawn from the original
 * marketing site. Safe to run repeatedly — existing docs are matched
 * by slug/email and updated in place.
 *
 * Triggered via POST /api/dev/seed (gated by SEED_TOKEN in dev only).
 * See README.md for the curl invocation.
 */
import type { Payload } from 'payload'

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@bangarahtradingenterprises.com'
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2026'

type SeedCategory = {
  slug: string
  name: string
  description: string
  order: number
}

const CATEGORIES: SeedCategory[] = [
  { slug: 'sauces', name: 'Sauces', description: 'Signature herbal, hot, and sweet chilli sauces.', order: 1 },
  { slug: 'honey', name: 'Honey', description: 'Pure Namibian honey, processed and traceable.', order: 2 },
  { slug: 'beverages', name: 'Beverages', description: 'Pan-African soft drinks and refreshments.', order: 3 },
  { slug: 'supplements', name: 'Food supplements', description: 'Health, wellness and nutrition products.', order: 4 },
  { slug: 'caribbean-imports', name: 'Caribbean imports', description: 'Books, music, films and apparel from the Caribbean.', order: 5 },
  { slug: 'apparel', name: 'Apparel', description: 'Clothing and lifestyle goods.', order: 6 },
]

type SeedProduct = {
  slug: string
  title: string
  shortDescription: string
  fulfillmentMode: 'retail' | 'quote' | 'hybrid'
  priceMinor: number
  compareAtMinor?: number
  currency: 'NAD'
  sku: string
  categorySlugs: string[]
  vendorSlug: string
  trackQuantity: boolean
  quantity: number
  weightGrams: number
  tags: string[]
}

const VENDOR_BANGARAH_SLUG = 'bangarah-trading'
const VENDOR_SAMPLE_SLUG = 'okuva-naturals'

const PRODUCTS: SeedProduct[] = [
  {
    slug: 'ayishas-herbal-sauce-original',
    title: "Ayisha's Herbal Sauce — Original",
    shortDescription: 'Our patented signature herbal sauce. The original Bangarah recipe.',
    fulfillmentMode: 'hybrid',
    priceMinor: 7500,
    currency: 'NAD',
    sku: 'BANG-AYI-001',
    categorySlugs: ['sauces'],
    vendorSlug: VENDOR_BANGARAH_SLUG,
    trackQuantity: true,
    quantity: 240,
    weightGrams: 350,
    tags: ['signature', 'herbal', 'patented'],
  },
  {
    slug: 'kiyayas-sauce-extra-hot',
    title: "Kiyaya's Brand Sauce — Extra Hot",
    shortDescription: 'For the fearless. Extra hot chilli with depth and character.',
    fulfillmentMode: 'hybrid',
    priceMinor: 8500,
    currency: 'NAD',
    sku: 'BANG-KIY-XH',
    categorySlugs: ['sauces'],
    vendorSlug: VENDOR_BANGARAH_SLUG,
    trackQuantity: true,
    quantity: 180,
    weightGrams: 350,
    tags: ['extra-hot', 'chilli'],
  },
  {
    slug: 'kiyayas-sauce-hot',
    title: "Kiyaya's Brand Sauce — Hot",
    shortDescription: 'Balanced heat for everyday cooking.',
    fulfillmentMode: 'hybrid',
    priceMinor: 8500,
    currency: 'NAD',
    sku: 'BANG-KIY-HOT',
    categorySlugs: ['sauces'],
    vendorSlug: VENDOR_BANGARAH_SLUG,
    trackQuantity: true,
    quantity: 220,
    weightGrams: 350,
    tags: ['hot', 'chilli'],
  },
  {
    slug: 'kiyayas-sauce-sweet-chilli',
    title: "Kiyaya's Brand Sauce — Sweet Chilli",
    shortDescription: 'Mild, sweet, family-friendly. A favourite glaze.',
    fulfillmentMode: 'hybrid',
    priceMinor: 8500,
    currency: 'NAD',
    sku: 'BANG-KIY-SWT',
    categorySlugs: ['sauces'],
    vendorSlug: VENDOR_BANGARAH_SLUG,
    trackQuantity: true,
    quantity: 260,
    weightGrams: 350,
    tags: ['sweet-chilli', 'mild'],
  },
  {
    slug: 'kiyayas-pure-honey-500g',
    title: "Kiyaya's Pure Honey — 500g jar",
    shortDescription: 'Pure, unblended Namibian honey processed and packaged in Okahandja.',
    fulfillmentMode: 'hybrid',
    priceMinor: 12500,
    currency: 'NAD',
    sku: 'BANG-HON-500',
    categorySlugs: ['honey'],
    vendorSlug: VENDOR_BANGARAH_SLUG,
    trackQuantity: true,
    quantity: 150,
    weightGrams: 580,
    tags: ['pure', 'unblended', 'namibian'],
  },
  {
    slug: 'pan-african-cola-330ml',
    title: 'Pan-African Cola — 330ml',
    shortDescription: 'A refreshing soft drink from our Pan-African beverage line.',
    fulfillmentMode: 'retail',
    priceMinor: 1500,
    currency: 'NAD',
    sku: 'BANG-BEV-COLA',
    categorySlugs: ['beverages'],
    vendorSlug: VENDOR_BANGARAH_SLUG,
    trackQuantity: true,
    quantity: 600,
    weightGrams: 340,
    tags: ['beverage', 'pan-african'],
  },
  {
    slug: 'baobab-energy-supplement',
    title: 'Baobab Energy Food Supplement',
    shortDescription: 'Nutrient-rich baobab supplement for everyday wellness.',
    fulfillmentMode: 'hybrid',
    priceMinor: 22000,
    currency: 'NAD',
    sku: 'OKUVA-SUP-BAO',
    categorySlugs: ['supplements'],
    vendorSlug: VENDOR_SAMPLE_SLUG,
    trackQuantity: true,
    quantity: 80,
    weightGrams: 250,
    tags: ['supplement', 'baobab', 'wellness'],
  },
  {
    slug: 'caribbean-classics-vinyl',
    title: 'Caribbean Classics Vinyl Compilation',
    shortDescription: 'Curated Caribbean classics on 12" vinyl — part of our import line.',
    fulfillmentMode: 'quote',
    priceMinor: 65000,
    currency: 'NAD',
    sku: 'BANG-CAR-VIN',
    categorySlugs: ['caribbean-imports'],
    vendorSlug: VENDOR_BANGARAH_SLUG,
    trackQuantity: false,
    quantity: 0,
    weightGrams: 900,
    tags: ['caribbean', 'vinyl', 'import'],
  },
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertByField<T extends { id: any }>(args: {
  payload: Payload
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  collection: any
  field: string
  value: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>
}): Promise<T> {
  const { payload, collection, field, value, data } = args
  // Seed runs in a no-req context; overrideAccess everywhere so the
  // field-level RBAC introduced in B47 (e.g. role: 'admin' admin-only)
  // doesn't reject the seed payload.
  const existing = await payload.find({
    collection,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    where: { [field]: { equals: value } } as any,
    limit: 1,
    overrideAccess: true,
  })
  if (existing.docs[0]) {
    return (await payload.update({
      collection,
      id: existing.docs[0].id,
      data,
      overrideAccess: true,
    })) as unknown as T
  }
  return (await payload.create({
    collection,
    data,
    overrideAccess: true,
  })) as unknown as T
}

export type SeedReport = {
  admin: string
  vendors: number
  categories: number
  products: number
  featured: number
}

export async function seed(payload: Payload): Promise<SeedReport> {
  payload.logger?.info?.('▸ Seed: ensuring admin user…')
  const adminExisting = await payload.find({
    collection: 'users',
    where: { email: { equals: ADMIN_EMAIL } },
    limit: 1,
    overrideAccess: true,
  })
  const admin = adminExisting.docs[0]
    ? await payload.update({
        collection: 'users',
        id: adminExisting.docs[0].id,
        data: { name: 'Bangarah Admin', role: 'admin' },
        overrideAccess: true,
      })
    : await payload.create({
        collection: 'users',
        data: {
          email: ADMIN_EMAIL,
          password: ADMIN_PASSWORD,
          name: 'Bangarah Admin',
          role: 'admin',
        },
        overrideAccess: true,
      })

  const bangarah = await upsertByField<{ id: number | string }>({
    payload,
    collection: 'vendors',
    field: 'slug',
    value: VENDOR_BANGARAH_SLUG,
    data: {
      name: 'Bangarah Trading',
      slug: VENDOR_BANGARAH_SLUG,
      status: 'active',
      tagline: 'Patented sauces, pure honey — anchor vendor since 2011',
      bio: "The original trading house behind Bangarah. Producer of Ayisha's Herbal and Kiyaya's Brand sauces, and Kiyaya's Pure Honey. Based in Okahandja, Namibia.",
      country: 'NA',
      city: 'Okahandja',
      commissionRate: 0,
    },
  })
  const okuva = await upsertByField<{ id: number | string }>({
    payload,
    collection: 'vendors',
    field: 'slug',
    value: VENDOR_SAMPLE_SLUG,
    data: {
      name: 'Okuva Naturals',
      slug: VENDOR_SAMPLE_SLUG,
      status: 'active',
      tagline: 'Indigenous Southern African superfoods',
      bio: 'Sample partner vendor focused on baobab, marula, and other Southern African botanicals.',
      country: 'NA',
      city: 'Windhoek',
      commissionRate: 12,
    },
  })

  const categoryIdBySlug = new Map<string, number | string>()
  for (const c of CATEGORIES) {
    const doc = await upsertByField<{ id: number | string }>({
      payload,
      collection: 'categories',
      field: 'slug',
      value: c.slug,
      data: c,
    })
    categoryIdBySlug.set(c.slug, doc.id)
  }

  const vendorBySlug = new Map<string, number | string>([
    [VENDOR_BANGARAH_SLUG, bangarah.id],
    [VENDOR_SAMPLE_SLUG, okuva.id],
  ])
  let productCount = 0
  for (const p of PRODUCTS) {
    const vendorId = vendorBySlug.get(p.vendorSlug)
    if (!vendorId) continue
    const categoryIds = p.categorySlugs
      .map((s) => categoryIdBySlug.get(s))
      .filter((x): x is number | string => Boolean(x))
    await upsertByField({
      payload,
      collection: 'products',
      field: 'slug',
      value: p.slug,
      data: {
        title: p.title,
        slug: p.slug,
        shortDescription: p.shortDescription,
        fulfillmentMode: p.fulfillmentMode,
        status: 'published',
        priceMinor: p.priceMinor,
        compareAtMinor: p.compareAtMinor,
        currency: p.currency,
        sku: p.sku,
        vendor: vendorId,
        categories: categoryIds,
        tags: p.tags.map((value) => ({ value })),
        inventory: {
          trackQuantity: p.trackQuantity,
          quantity: p.quantity,
          allowBackorder: false,
          lowStockThreshold: 10,
        },
        shipping: {
          weightGrams: p.weightGrams,
          requiresShipping: true,
        },
      },
    })
    productCount += 1
  }

  const featuredSlugs = [
    'ayishas-herbal-sauce-original',
    'kiyayas-sauce-extra-hot',
    'kiyayas-pure-honey-500g',
  ]
  const featured = await payload.find({
    collection: 'products',
    where: { slug: { in: featuredSlugs } },
    limit: 10,
    depth: 0,
    overrideAccess: true,
  })
  const existingSettings = await payload.findGlobal({
    slug: 'site-settings',
    overrideAccess: true,
  })
  await payload.updateGlobal({
    slug: 'site-settings',
    overrideAccess: true,
    data: {
      ...existingSettings,
      featuredProducts: featured.docs.map((d) => d.id),
    },
  })

  return {
    admin: admin.email,
    vendors: 2,
    categories: categoryIdBySlug.size,
    products: productCount,
    featured: featured.docs.length,
  }
}
