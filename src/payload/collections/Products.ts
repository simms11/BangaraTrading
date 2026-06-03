import type { Access, CollectionConfig, Where } from 'payload'
import { isAdminFieldAccess, isAdminOrVendor } from '../access'
import { auditProduct } from '../hooks/audit'
import { revalidateProduct } from '../hooks/revalidate'

const readAccess: Access = ({ req: { user } }) => {
  if (user?.role === 'admin') return true
  if (user?.role === 'vendor' && user.vendor) {
    const vendorId = typeof user.vendor === 'object' ? user.vendor.id : user.vendor
    return {
      or: [
        // M8 (Phase 2) — anonymous reads now ALSO filter by
        // vendor.status==='active'. listProducts/getProductBySlug
        // already do this, but Payload's auto-exposed /api/products
        // REST endpoint uses this access function directly, so a
        // partner integration / mobile app / curl could otherwise see
        // paused/banned vendors' products. The vendor's own row still
        // sees their own products regardless of their status.
        {
          and: [
            { status: { equals: 'published' } } as Where,
            { 'vendor.status': { equals: 'active' } } as Where,
          ],
        } as Where,
        { vendor: { equals: vendorId } } as Where,
      ],
    } as Where
  }
  return {
    and: [
      { status: { equals: 'published' } } as Where,
      { 'vendor.status': { equals: 'active' } } as Where,
    ],
  } as Where
}

const updateAccess: Access = ({ req: { user } }) => {
  if (user?.role === 'admin') return true
  if (user?.role === 'vendor' && user.vendor) {
    const vendorId = typeof user.vendor === 'object' ? user.vendor.id : user.vendor
    return { vendor: { equals: vendorId } } as Where
  }
  return false
}

export const Products: CollectionConfig = {
  slug: 'products',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'vendor', 'status', 'priceMinor', 'fulfillmentMode'],
  },
  access: {
    read: readAccess,
    create: isAdminOrVendor,
    update: updateAccess,
    delete: ({ req: { user } }) => user?.role === 'admin',
  },
  hooks: {
    // I2 (C2) fix: vendor users may not create products attributed to a
    // different vendor's id. Round-1 closed the symmetric hole on
    // Vendors.update (vendor → other-vendor PATCH) but the create path
    // here only checked role, not identity. A logged-in vendor could
    // POST a product with `vendor: <other vendor id>` and pollute the
    // victim's catalog. We force `data.vendor` to equal the user's
    // own vendor on every vendor-initiated write.
    beforeChange: [
      ({ data, req, operation }) => {
        const user = req.user
        if (!user || user.role !== 'vendor') return data
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const userVendor = (user as any).vendor
        const userVendorId =
          typeof userVendor === 'object' && userVendor !== null
            ? (userVendor as { id: number | string }).id
            : userVendor
        if (userVendorId == null) {
          // Vendor user with no linked vendor — shouldn't reach here
          // because collection access already rejected, but defensive.
          throw new Error('Refused: vendor user has no linked vendor row.')
        }
        if (operation === 'create') {
          // On create, hard-force the vendor field to the user's own row.
          // Silently allowing data.vendor to be omitted would mean the
          // admin form's value flows through; we just over-write.
          return { ...data, vendor: userVendorId }
        }
        // On update, reject any attempt to change the vendor relation.
        if (data.vendor != null) {
          const submittedId =
            typeof data.vendor === 'object' && data.vendor !== null
              ? (data.vendor as { id: number | string }).id
              : data.vendor
          if (String(submittedId) !== String(userVendorId)) {
            throw new Error(
              'Refused: vendors cannot transfer products to another vendor.',
            )
          }
        }
        return data
      },
    ],
    afterChange: [auditProduct, revalidateProduct],
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true, index: true },
    {
      name: 'vendor',
      type: 'relationship',
      relationTo: 'vendors',
      required: true,
      hasMany: false,
      index: true,
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'draft',
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'Pending review', value: 'pending' },
        { label: 'Published', value: 'published' },
        { label: 'Archived', value: 'archived' },
      ],
      // SECURITY (C4): admin-only write. The previous absence of any
      // field-level access let a vendor PATCH status="published" directly
      // and skip the documented draft→pending→published review gate —
      // critical for banned/fraud vendors who still held a session.
      // Vendors create in 'draft' (default) and request review via a
      // server action that uses overrideAccess.
      access: { update: isAdminFieldAccess },
    },
    {
      name: 'fulfillmentMode',
      type: 'select',
      required: true,
      defaultValue: 'retail',
      options: [
        { label: 'Retail (instant checkout)', value: 'retail' },
        { label: 'Quote (B2B / bulk)', value: 'quote' },
        { label: 'Retail + quote available', value: 'hybrid' },
      ],
      admin: {
        description:
          'Retail items check out instantly via Stripe/Flutterwave. Quote items go through the B2B quote flow.',
      },
    },
    { name: 'shortDescription', type: 'textarea' },
    {
      name: 'description',
      type: 'richText',
    },
    {
      name: 'categories',
      type: 'relationship',
      relationTo: 'categories',
      hasMany: true,
    },
    {
      name: 'tags',
      type: 'array',
      fields: [{ name: 'value', type: 'text', required: true }],
    },
    {
      name: 'images',
      type: 'array',
      minRows: 1,
      fields: [
        { name: 'image', type: 'upload', relationTo: 'media', required: true },
        { name: 'alt', type: 'text', required: true },
      ],
    },
    {
      name: 'priceMinor',
      type: 'number',
      required: true,
      min: 0,
      admin: {
        description: 'Price in minor units (cents). e.g. 12500 = 125.00.',
      },
    },
    {
      name: 'compareAtMinor',
      type: 'number',
      min: 0,
      admin: { description: 'Was-price in minor units. Optional.' },
    },
    {
      name: 'currency',
      type: 'select',
      required: true,
      defaultValue: 'NAD',
      options: [
        { label: 'NAD (Namibian Dollar)', value: 'NAD' },
        { label: 'ZAR (South African Rand)', value: 'ZAR' },
        { label: 'USD', value: 'USD' },
        { label: 'GBP', value: 'GBP' },
        { label: 'EUR', value: 'EUR' },
      ],
    },
    {
      name: 'sku',
      type: 'text',
      unique: true,
      admin: { description: 'Internal SKU. Auto-generated if blank.' },
    },
    {
      name: 'inventory',
      type: 'group',
      fields: [
        { name: 'trackQuantity', type: 'checkbox', defaultValue: true },
        { name: 'quantity', type: 'number', defaultValue: 0, min: 0 },
        { name: 'allowBackorder', type: 'checkbox', defaultValue: false },
        {
          name: 'lowStockThreshold',
          type: 'number',
          defaultValue: 5,
          min: 0,
        },
      ],
    },
    {
      name: 'shipping',
      type: 'group',
      fields: [
        { name: 'weightGrams', type: 'number', min: 0 },
        { name: 'lengthCm', type: 'number', min: 0 },
        { name: 'widthCm', type: 'number', min: 0 },
        { name: 'heightCm', type: 'number', min: 0 },
        {
          name: 'requiresShipping',
          type: 'checkbox',
          defaultValue: true,
        },
      ],
    },
    {
      name: 'seo',
      type: 'group',
      fields: [
        { name: 'title', type: 'text' },
        { name: 'description', type: 'textarea' },
        { name: 'image', type: 'upload', relationTo: 'media' },
      ],
    },
  ],
  timestamps: true,
}
