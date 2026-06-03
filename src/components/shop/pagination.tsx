import Link from 'next/link'
import { cn } from '@/lib/utils'

export function Pagination({
  page,
  totalPages,
  baseParams,
}: {
  page: number
  totalPages: number
  baseParams: URLSearchParams
}) {
  if (totalPages <= 1) return null

  const hrefFor = (p: number) => {
    const sp = new URLSearchParams(baseParams.toString())
    if (p === 1) sp.delete('page')
    else sp.set('page', String(p))
    const qs = sp.toString()
    return qs ? `/shop?${qs}` : '/shop'
  }

  return (
    <nav className="flex items-center justify-center gap-1" aria-label="Pagination">
      {page > 1 && (
        <Link
          href={hrefFor(page - 1)}
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:border-brand-300"
        >
          Previous
        </Link>
      )}
      {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
        <Link
          key={p}
          href={hrefFor(p)}
          aria-current={p === page ? 'page' : undefined}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm',
            p === page
              ? 'bg-brand-900 text-white'
              : 'border border-border bg-white hover:border-brand-300',
          )}
        >
          {p}
        </Link>
      ))}
      {page < totalPages && (
        <Link
          href={hrefFor(page + 1)}
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:border-brand-300"
        >
          Next
        </Link>
      )}
    </nav>
  )
}
