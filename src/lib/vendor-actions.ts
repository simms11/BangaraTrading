'use server'

import { nanoid } from 'nanoid'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getPayload } from '@/lib/payload'
import { slugify } from '@/lib/utils'
import { sendNewVendorOps } from '@/lib/email'
import {
  checkActionRateLimit,
  FIFTEEN_MIN,
} from '@/lib/action-rate-limit'

// J6 (round-4): use the shared display-safety predicate.
import { noDangerousChars as noControlChars } from '@/lib/utils'
const applicationSchema = z.object({
  name: z
    .string()
    .min(1, 'Business name required')
    .max(120)
    .refine(noControlChars, 'Invalid characters in business name.'),
  contactName: z
    .string()
    .min(1)
    .max(120)
    .refine(noControlChars, 'Invalid characters in contact name.'),
  contactEmail: z.string().email(),
  contactPhone: z
    .string()
    .max(40)
    .refine(noControlChars, 'Invalid characters in phone.')
    .optional(),
  country: z
    .string()
    .min(2)
    .max(80)
    .refine(noControlChars, 'Invalid characters in country.'),
  city: z
    .string()
    .max(80)
    .refine(noControlChars, 'Invalid characters in city.')
    .optional(),
  tagline: z
    .string()
    .max(160)
    .refine(noControlChars, 'Invalid characters in tagline.')
    .optional(),
  bio: z.string().max(4000),
  categories: z.string().max(500).optional(),
})

export type VendorApplicationState = { error?: string } | null

export async function submitVendorApplicationAction(
  _prev: VendorApplicationState,
  formData: FormData,
): Promise<VendorApplicationState> {
  // M14: 5 applications per IP per 15 min — generous for a real applicant,
  // tight enough to stop scripted spam from polluting the vendor pipeline
  // and burning the ops email quota.
  const limited = await checkActionRateLimit('vendor-application', {
    limit: 5,
    windowMs: FIFTEEN_MIN,
  })
  if (!limited.ok) return { error: limited.message }

  const parsed = applicationSchema.safeParse({
    name: String(formData.get('name') ?? ''),
    contactName: String(formData.get('contactName') ?? ''),
    contactEmail: String(formData.get('contactEmail') ?? ''),
    contactPhone: String(formData.get('contactPhone') ?? '') || undefined,
    country: String(formData.get('country') ?? ''),
    city: String(formData.get('city') ?? '') || undefined,
    tagline: String(formData.get('tagline') ?? '') || undefined,
    bio: String(formData.get('bio') ?? ''),
    categories: String(formData.get('categories') ?? '') || undefined,
  })
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { error: first ? `${first.path.join('.')}: ${first.message}` : 'Invalid input.' }
  }

  const payload = await getPayload()

  // B27 fix: rely on DB-level uniqueness rather than read-then-write.
  // We try the natural slug first; on collision, append a CSPRNG nanoid
  // suffix and retry up to ~10 times.
  //
  // I11 minor: previously used Math.random()-derived 4-char base-36 suffix
  // which is non-cryptographic and birthday-prone at 1k+ collisions on a
  // popular slug. nanoid is CSPRNG-backed and uses a wider alphabet.
  let baseSlug = slugify(parsed.data.name)
  if (!baseSlug) baseSlug = `vendor-${Date.now().toString(36)}`

  let vendor: { id: number | string; name: string } | null = null
  for (let attempt = 0; attempt < 10; attempt++) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${nanoid(6).toLowerCase()}`
    try {
      vendor = await payload.create({
        collection: 'vendors',
        overrideAccess: true,
        data: {
          name: parsed.data.name,
          slug,
          status: 'pending',
          tagline: parsed.data.tagline,
          bio: parsed.data.bio,
          country: parsed.data.country,
          city: parsed.data.city,
          commissionRate: 10,
        },
      })
      break
    } catch (e) {
      const msg = (e as Error).message?.toLowerCase() ?? ''
      if (msg.includes('unique') || msg.includes('duplicate')) {
        continue // collision — retry with a new suffix
      }
      // B28 fix: never surface raw error text — could leak DB internals.
      console.error('[vendor-application] create failed:', e)
      return { error: 'Could not submit application. Please try again.' }
    }
  }

  if (!vendor) {
    return {
      error:
        'Could not generate a unique storefront URL for this business name. Please tweak the name and try again.',
    }
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
  await sendNewVendorOps({
    props: {
      vendorName: vendor.name,
      contactName: parsed.data.contactName,
      contactEmail: parsed.data.contactEmail,
      contactPhone: parsed.data.contactPhone,
      country: parsed.data.country,
      city: parsed.data.city,
      tagline: parsed.data.tagline,
      bio: parsed.data.bio,
      categories: parsed.data.categories,
      adminUrl: `${siteUrl}/admin/collections/vendors/${vendor.id}`,
      siteUrl,
    },
  })

  redirect('/sell/submitted')
}
