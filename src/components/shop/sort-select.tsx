'use client'

import { useRouter, useSearchParams } from 'next/navigation'

const options = [
  { value: 'newest', label: 'Newest' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
] as const

export function SortSelect({ value }: { value: string }) {
  const router = useRouter()
  const params = useSearchParams()

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Sort by</span>
      <select
        value={value}
        onChange={(e) => {
          const sp = new URLSearchParams(params.toString())
          sp.set('sort', e.target.value)
          sp.delete('page')
          router.push(`/shop?${sp.toString()}`)
        }}
        className="rounded-md border border-border bg-white px-3 py-1.5 text-sm focus:border-brand-700"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}
