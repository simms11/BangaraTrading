'use client'

import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { formatPrice } from '@/lib/utils'

export type ShippingMethodOption = {
  id: string
  label: string
  description?: string
  amountMinor: number
  currency: string
  estimatedDays?: { min: number; max: number }
}

type QuoteResponse = { methods: ShippingMethodOption[]; oversize: boolean }

export function ShippingPicker({
  countryFieldName,
  postalCodeFieldName,
  regionFieldName,
  cityFieldName,
  onSelectMethod,
}: {
  countryFieldName: string
  postalCodeFieldName: string
  regionFieldName: string
  cityFieldName: string
  onSelectMethod?: (method: ShippingMethodOption | null) => void
}) {
  const [methods, setMethods] = React.useState<ShippingMethodOption[]>([])
  const [oversize, setOversize] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [selectedId, setSelectedId] = React.useState<string>('')

  // R8 frontend M2 — read the current selection through a ref so
  // `fetchOptions` does NOT depend on `selectedId`. Previously `selectedId`
  // was a useCallback dep, which recreated `fetchOptions` on every method
  // pick → the re-quote effect tore down + re-attached its listener AND
  // fired an immediate re-quote on each pick (wasteful network call), and
  // made the closure/listener relationship fragile. With a ref, the
  // effect only re-binds on address-field changes and the "still valid?"
  // check always reads the latest selection.
  const selectedIdRef = React.useRef('')
  React.useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  const fetchOptions = React.useCallback(async (destination: {
    country: string
    region?: string
    city?: string
    postalCode?: string
  }) => {
    if (!destination.country) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/shipping/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(destination),
      })
      if (!res.ok) throw new Error('Could not fetch shipping rates.')
      const data = (await res.json()) as QuoteResponse
      setMethods(data.methods)
      setOversize(data.oversize)
      // Only auto-pick when nothing is chosen yet, or the previously
      // chosen method genuinely no longer exists for the new address.
      const stillValid = data.methods.some((m) => m.id === selectedIdRef.current)
      if (!stillValid) {
        const first = data.methods[0]?.id ?? ''
        setSelectedId(first)
        onSelectMethod?.(data.methods[0] ?? null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setLoading(false)
    }
  }, [onSelectMethod])

  // Re-quote on country change with a small debounce.
  React.useEffect(() => {
    const form = document.querySelector<HTMLFormElement>('form')
    if (!form) return
    const handler = () => {
      const fd = new FormData(form)
      const destination = {
        country: String(fd.get(countryFieldName) ?? ''),
        region: String(fd.get(regionFieldName) ?? '') || undefined,
        city: String(fd.get(cityFieldName) ?? '') || undefined,
        postalCode: String(fd.get(postalCodeFieldName) ?? '') || undefined,
      }
      fetchOptions(destination)
    }
    handler()
    const watch = [countryFieldName, postalCodeFieldName, regionFieldName, cityFieldName]
    let timer: number | undefined
    const onChange = (e: Event) => {
      const target = e.target as HTMLInputElement | null
      if (!target?.name || !watch.includes(target.name)) return
      window.clearTimeout(timer)
      timer = window.setTimeout(handler, 350)
    }
    form.addEventListener('input', onChange)
    return () => {
      window.clearTimeout(timer)
      form.removeEventListener('input', onChange)
    }
  }, [countryFieldName, postalCodeFieldName, regionFieldName, cityFieldName, fetchOptions])

  return (
    <div>
      {oversize && (
        <p className="mb-3 rounded-md bg-accent-50 px-3 py-2 text-sm text-accent-900">
          Heads up — this is a heavy shipment. Only pickup is offered automatically. For
          delivery, please use the bulk quote flow.
        </p>
      )}
      {loading && <p className="text-sm text-muted-foreground">Fetching shipping options…</p>}
      {error && (
        <p role="alert" className="rounded-md bg-spice-50 px-3 py-2 text-sm text-spice-800">
          {error}
        </p>
      )}
      {!loading && !error && methods.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Enter a shipping country to see options.
        </p>
      )}
      {methods.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="sr-only">Choose a shipping method</legend>
          {methods.map((m) => (
            <label
              key={m.id}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-4 transition ${
                selectedId === m.id ? 'border-brand-700 bg-brand-50' : 'border-border bg-white'
              }`}
            >
              <input
                type="radio"
                name="shippingMethodId"
                value={m.id}
                checked={selectedId === m.id}
                onChange={() => {
                  setSelectedId(m.id)
                  onSelectMethod?.(m)
                }}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <span className="font-medium">{m.label}</span>
                    {m.description && (
                      <p className="text-xs text-muted-foreground">{m.description}</p>
                    )}
                    {m.estimatedDays && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {m.estimatedDays.min === m.estimatedDays.max
                          ? `${m.estimatedDays.max} days`
                          : `${m.estimatedDays.min}–${m.estimatedDays.max} days`}
                      </p>
                    )}
                  </div>
                  {m.amountMinor === 0 ? (
                    <Badge variant="default">Free</Badge>
                  ) : (
                    <span className="text-sm font-semibold tabular-nums">
                      {formatPrice(m.amountMinor, m.currency)}
                    </span>
                  )}
                </div>
              </div>
            </label>
          ))}
          {/* The selected method's amountMinor is persisted via a hidden input
              so the server action can trust the chosen method without re-quoting. */}
          <ShippingHidden
            method={methods.find((m) => m.id === selectedId)}
          />
        </fieldset>
      )}
    </div>
  )
}

function ShippingHidden({ method }: { method: ShippingMethodOption | undefined }) {
  return (
    <>
      <input type="hidden" name="shippingLabel" value={method?.label ?? ''} />
      <input
        type="hidden"
        name="shippingAmountMinor"
        value={String(method?.amountMinor ?? 0)}
      />
    </>
  )
}
