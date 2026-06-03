'use client'

import * as React from 'react'
import { useActionState } from 'react'
import { acceptQuoteAction, type QuoteFormState } from '@/lib/quote-actions'
import { Button } from '@/components/ui/button'

export function AcceptQuoteForm({
  quoteNumber,
  confirmationToken,
}: {
  quoteNumber: string
  /** Per-quote token forwarded from the URL `?t=...` — gates acceptance. */
  confirmationToken: string
}) {
  const [state, formAction, pending] = useActionState<QuoteFormState, FormData>(
    acceptQuoteAction,
    null,
  )
  const [billingSame, setBillingSame] = React.useState(true)
  // J1 (round-4 C1) — a11y form error wiring.
  const errorId = 'accept-quote-error'
  const ariaErrorProps = state?.error
    ? { 'aria-invalid': true as const, 'aria-describedby': errorId }
    : {}

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <input type="hidden" name="quoteNumber" value={quoteNumber} />
      <input type="hidden" name="confirmationToken" value={confirmationToken} />

      <Section title="Ship to">
        <AddressFields prefix="shipping" ariaErrorProps={ariaErrorProps} />
      </Section>

      <Section title="Bill to">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="billingSameAsShipping"
            checked={billingSame}
            onChange={(e) => setBillingSame(e.target.checked)}
          />
          Same as shipping
        </label>
        {!billingSame && (
          <div className="mt-4">
            <AddressFields prefix="billing" ariaErrorProps={ariaErrorProps} />
          </div>
        )}
      </Section>

      {state?.error && (
        <p id={errorId} role="alert" aria-live="polite" className="rounded-md bg-spice-50 px-3 py-2 text-sm text-spice-800">
          {state.error}
        </p>
      )}

      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Creating order…' : 'Accept quote & create order'}
      </Button>
      <p className="text-xs text-muted-foreground">
        Accepting locks in the quoted pricing. You&apos;ll be redirected to choose a payment
        method on the order page.
      </p>
    </form>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  )
}

function Field({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <input
        {...props}
        className="mt-1 block w-full rounded-md border border-border bg-white px-3 py-2 text-base focus:border-brand-700 focus:outline-none"
      />
    </label>
  )
}

function AddressFields({
  prefix,
  ariaErrorProps,
}: {
  prefix: 'shipping' | 'billing'
  ariaErrorProps?: { 'aria-invalid'?: true; 'aria-describedby'?: string }
}) {
  const aria = ariaErrorProps ?? {}
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field label="Full name" name={`${prefix}.name`} required {...aria} />
      </div>
      <div className="sm:col-span-2">
        <Field label="Street address" name={`${prefix}.line1`} required {...aria} />
      </div>
      <div className="sm:col-span-2">
        <Field label="Apartment, suite (optional)" name={`${prefix}.line2`} {...aria} />
      </div>
      <Field label="City" name={`${prefix}.city`} required {...aria} />
      <Field label="Region / state" name={`${prefix}.region`} {...aria} />
      <Field label="Postal code" name={`${prefix}.postalCode`} required {...aria} />
      <Field label="Country" name={`${prefix}.country`} defaultValue="Namibia" required {...aria} />
      <div className="sm:col-span-2">
        <Field label="Phone (optional)" name={`${prefix}.phone`} type="tel" {...aria} />
      </div>
    </div>
  )
}
