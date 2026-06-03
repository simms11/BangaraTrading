import Link from 'next/link'
import { cn } from '@/lib/utils'

type Cat = { slug: string; name: string }

export function CategoryNav({
  categories,
  current,
}: {
  categories: Cat[]
  current?: string
}) {
  return (
    <nav aria-label="Categories" className="flex flex-wrap gap-2">
      <Link
        href="/shop"
        className={cn(
          'rounded-full border px-4 py-1.5 text-sm transition-colors',
          !current
            ? 'border-brand-900 bg-brand-900 text-white'
            : 'border-border bg-white text-foreground hover:border-brand-300',
        )}
      >
        All
      </Link>
      {categories.map((c) => (
        <Link
          key={c.slug}
          href={`/shop?category=${c.slug}`}
          className={cn(
            'rounded-full border px-4 py-1.5 text-sm transition-colors',
            current === c.slug
              ? 'border-brand-900 bg-brand-900 text-white'
              : 'border-border bg-white text-foreground hover:border-brand-300',
          )}
        >
          {c.name}
        </Link>
      ))}
    </nav>
  )
}
