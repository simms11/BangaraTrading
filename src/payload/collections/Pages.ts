import type { Access, CollectionConfig, Where } from 'payload'
import { isAdmin } from '../access'
import { revalidatePage } from '../hooks/revalidate'

// SECURITY (M10): the previous `publicRead` returned every page including
// drafts/legal-pending wording. Anyone could GET /api/pages/:id and read
// pre-publication policy. Restricting to `status: 'published'` for
// non-admins still lets public storefront SSR reads work (they only
// surface published content anyway) while keeping drafts internal.
const readAccess: Access = ({ req: { user } }) => {
  if (user?.role === 'admin') return true
  return { status: { equals: 'published' } } as Where
}

export const Pages: CollectionConfig = {
  slug: 'pages',
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'slug', 'status'] },
  access: {
    read: readAccess,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  hooks: {
    afterChange: [revalidatePage],
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true, index: true },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'draft',
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'Published', value: 'published' },
      ],
    },
    { name: 'content', type: 'richText' },
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
