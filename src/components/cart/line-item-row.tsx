'use client'

import * as React from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Trash2 } from 'lucide-react'
import type { CartLineItem } from '@/lib/cart/types'
import { updateCartLine, removeCartLine } from '@/lib/cart/actions'
import { formatPrice } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

export function LineItemRow({ line }: { line: CartLineItem }) {
  const [pending, startTransition] = React.useTransition()
  const [qty, setQty] = React.useState(line.quantity)
  // R11 — ref tracks latest qty so rapid +/- clicks during the same
  // render don't all read the same stale closure value (was: 3 fast
  // clicks of + at qty=1 dispatched updateCartLine(2)×3 instead of
  // (2)(3)(4); only the last commit stuck and the user saw a stutter).
  const qtyRef = React.useRef(line.quantity)
  React.useEffect(() => {
    // Intentional prop->state sync: when the canonical line.quantity changes
    // externally (server reconciliation, cart merge), re-seed the local edit
    // state and the rapid-click ref. This is the deliberate case the
    // set-state-in-effect rule flags but cannot distinguish from a loop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQty(line.quantity)
    qtyRef.current = line.quantity
  }, [line.quantity])

  // R8 frontend M4 — never let the displayed/committed quantity hit 0.
  // Previously the "−" button at qty 1 set qty=0 (rendering a "0 ×
  // price = $0.00" ghost line until the server round-trip dropped the
  // row), and clearing the input + tabbing out committed 0 (silently
  // deleting the line). Quantity changes are clamped to >= 1; removal
  // goes exclusively through the trash button.
  const onQtyChange = (next: number) => {
    const clamped = Math.max(1, Math.min(99, next))
    setQty(clamped)
    qtyRef.current = clamped
    startTransition(async () => {
      await updateCartLine(line.productId, clamped)
    })
  }
  const incQty = () => onQtyChange(qtyRef.current + 1)
  const decQty = () => onQtyChange(qtyRef.current - 1)

  const onRemove = () => {
    startTransition(async () => {
      await removeCartLine(line.productId)
    })
  }

  return (
    <li className="flex gap-4 border-b border-border py-5 last:border-b-0" aria-busy={pending}>
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-muted">
        {line.imageUrl ? (
          <Image src={line.imageUrl} alt={line.title} fill sizes="80px" className="object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center font-display text-2xl text-brand-300">
            {line.title.charAt(0)}
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <Link
              href={`/products/${line.slug}`}
              className="font-medium hover:text-brand-700 line-clamp-2"
            >
              {line.title}
            </Link>
            {line.fulfillmentMode === 'quote' && (
              <Badge variant="spice" className="mt-1">Quote item</Badge>
            )}
          </div>
          <div className="text-sm font-semibold tabular-nums">
            {formatPrice(line.unitPriceMinor * qty, line.currency)}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <div className="inline-flex items-center rounded-full border border-border">
            <button
              type="button"
              onClick={decQty}
              className="h-8 w-8 rounded-l-full text-lg hover:bg-muted disabled:opacity-40"
              aria-label="Decrease quantity"
              disabled={pending || qty <= 1}
            >
              −
            </button>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={99}
              value={qty}
              onChange={(e) => {
                // Allow transient typing but clamp the floor to 1.
                const v = Math.min(99, Math.max(1, Number(e.target.value) || 1))
                setQty(v)
              }}
              onBlur={() => onQtyChange(qty)}
              className="h-8 w-12 border-x border-border text-center text-sm focus:outline-none"
              aria-label="Quantity"
            />
            <button
              type="button"
              onClick={incQty}
              className="h-8 w-8 rounded-r-full text-lg hover:bg-muted"
              aria-label="Increase quantity"
              disabled={pending}
            >
              +
            </button>
          </div>
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-spice-700"
            disabled={pending}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden /> Remove
          </button>
        </div>
      </div>
    </li>
  )
}
