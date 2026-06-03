import type { GlobalConfig } from 'payload'
import { revalidateSettings } from '../hooks/revalidate'

export const SiteSettings: GlobalConfig = {
  slug: 'site-settings',
  label: 'Site settings',
  access: {
    read: () => true,
    update: ({ req: { user } }) => user?.role === 'admin',
  },
  hooks: {
    afterChange: [revalidateSettings],
  },
  fields: [
    {
      name: 'hero',
      type: 'group',
      label: 'Homepage hero',
      fields: [
        { name: 'eyebrow', type: 'text', defaultValue: 'Marketplace for African & Caribbean sole traders' },
        { name: 'headlineLeading', type: 'text', defaultValue: 'Real provenance.' },
        { name: 'headlineTrailing', type: 'text', defaultValue: 'Premium taste.' },
        {
          name: 'subhead',
          type: 'textarea',
          defaultValue:
            "Patented Ayisha's Herbal and Kiyaya's sauces, pure Namibian honey, and curated Pan-African and Caribbean imports — sold directly by the makers, shipped across Africa and the diaspora.",
        },
      ],
    },
    {
      name: 'featuredProducts',
      type: 'relationship',
      relationTo: 'products',
      hasMany: true,
      admin: { description: 'Order matters. Shown on homepage and feeds.' },
    },
    {
      name: 'announcement',
      type: 'group',
      fields: [
        { name: 'enabled', type: 'checkbox', defaultValue: false },
        { name: 'text', type: 'text' },
        { name: 'linkLabel', type: 'text' },
        { name: 'linkHref', type: 'text' },
      ],
    },
  ],
}
