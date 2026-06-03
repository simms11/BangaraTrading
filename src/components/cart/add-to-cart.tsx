'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ShoppingBag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { addToCartBySlug } from '@/lib/cart/actions'

export function AddToCart({
  slug,
  label = 'Add to cart',
}: {
  slug: string
  label?: string
}) {
  const router = useRouter()
  const [qty, setQty] = React.useState(1)
  const [pending, startTransition] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)

  const onAdd = () => {
    setError(null)
    startTransition(async () => {
      const res = await addToCartBySlug(slug, qty)
      if (!res.ok) {
        setError(res.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="inline-flex items-center rounded-full border border-border">
        <button
          type="button"
          onClick={() => setQty((q) => Math.max(1, q - 1))}
          className="h-11 w-11 rounded-l-full text-lg hover:bg-muted"
          aria-label="Decrease quantity"
          disabled={pending}
        >
          −
        </button>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={99}
          value={qty}
          onChange={(e) => setQty(Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
          className="h-11 w-14 border-x border-border text-center text-base focus:outline-none"
          aria-label="Quantity"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'add-to-cart-error' : undefined}
        />
        <button
          type="button"
          onClick={() => setQty((q) => Math.min(99, q + 1))}
          className="h-11 w-11 rounded-r-full text-lg hover:bg-muted"
          aria-label="Increase quantity"
          disabled={pending}
        >
          +
        </button>
      </div>
      <Button size="lg" variant="primary" onClick={onAdd} disabled={pending}>
        <ShoppingBag className="h-4 w-4" aria-hidden />
        {pending ? 'Adding…' : label}
      </Button>
      {error && (
        <p id="add-to-cart-error" role="alert" aria-live="polite" className="text-sm text-spice-700">
          {error}
        </p>
      )}
    </div>
  )
}
