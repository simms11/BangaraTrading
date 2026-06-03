import type { CollectionConfig } from 'payload'
import { isAdmin, publicRead } from '../access'

export const Categories: CollectionConfig = {
  slug: 'categories',
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'slug', 'parent'] },
  access: {
    read: publicRead,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  hooks: {
    beforeChange: [
      // R7 round-7 data m7 — prevent cycles in the parent chain. An
      // admin who sets A.parent=B and then B.parent=A would crash every
      // breadcrumb / nav renderer with infinite recursion. We walk the
      // ancestor chain from the proposed parent up to root; if we hit
      // the doc being edited we reject.
      async ({ data, originalDoc, req, operation }) => {
        if (operation !== 'create' && operation !== 'update') return data
        const parentRef = data?.parent
        if (!parentRef) return data
        const selfId = originalDoc?.id
        if (!selfId) return data
        const parentId =
          typeof parentRef === 'object' && parentRef !== null
            ? (parentRef as { id?: number | string }).id
            : parentRef
        let cursor: number | string | null | undefined = parentId
        const visited = new Set<string>()
        let depth = 0
        while (cursor && depth < 32) {
          if (String(cursor) === String(selfId)) {
            throw new Error(
              `Refused: setting parent would create a cycle in the category tree.`,
            )
          }
          if (visited.has(String(cursor))) {
            // Already a cycle elsewhere in the tree — reject too so we
            // don't propagate a corrupted state.
            throw new Error(
              `Refused: existing category tree already contains a cycle at id ${cursor}.`,
            )
          }
          visited.add(String(cursor))
          const next = (await req.payload.findByID({
            collection: 'categories',
            id: cursor,
            depth: 0,
            overrideAccess: true,
          })) as { parent?: number | string | { id: number | string } | null }
          const nextParent = next?.parent
          cursor =
            nextParent && typeof nextParent === 'object'
              ? nextParent.id
              : (nextParent as number | string | null | undefined)
          depth += 1
        }
        return data
      },
    ],
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true, index: true },
    { name: 'description', type: 'textarea' },
    { name: 'parent', type: 'relationship', relationTo: 'categories' },
    { name: 'image', type: 'upload', relationTo: 'media' },
    {
      name: 'order',
      type: 'number',
      defaultValue: 0,
      admin: { description: 'Display order in nav (lower first).' },
    },
  ],
  timestamps: true,
}
