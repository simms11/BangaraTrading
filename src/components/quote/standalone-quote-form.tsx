'use client'

import { useActionState } from 'react'
import { submitQuoteFromFormAction, type QuoteFormState } from '@/lib/quote-actions'
import { Button } from '@/components/ui/button'
import { FormError, useFormErrorAria } from '@/components/ui/form-error'

export function StandaloneQuoteForm({
  productSlug,
  productTitle,
  defaultName,
  defaultEmail,
  hasSignedInUser,
}: {
  productSlug?: string
  productTitle?: string
  defaultName: string
  defaultEmail: string
  hasSignedInUser: boolean
}) {
  const [state, formAction, pending] = useActionState<QuoteFormState, FormData>(
    submitQuoteFromFormAction,
    null,
  )
  const errorId = 'standalone-quote-error'
  const aria = useFormErrorAria(errorId, !!state?.error)

  // Clean-room frontend major — render a confirmation when a product-less
  // general enquiry was routed to ops (no redirect, no quote row).
  if (state?.success) {
    return (
      <div
        role="status"
        className="rounded-xl border border-brand-200 bg-brand-50/60 p-6 text-sm"
      >
        <p className="font-medium text-brand-900">Thanks — your enquiry is in.</p>
        <p className="mt-1 text-muted-foreground">
          Our team typically responds within one business day with pricing, lead time,
          and shipping options. We&apos;ll reach you at the email you provided.
        </p>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="productSlug" value={productSlug ?? ''} />
      {productSlug && productTitle && (
        <div className="rounded-xl border border-border bg-brand-50/50 p-4 text-sm">
          <p className="text-muted-foreground">Quoting</p>
          <p className="font-medium">{productTitle}</p>
        </div>
      )}
      <Field
        label="Quantity"
        name="quantity"
        type="number"
        min={1}
        max={99999}
        defaultValue={productSlug ? '100' : '1'}
        required
        inputMode="numeric"
        {...aria}
      />
      <Field label="Full name" name="customerName" required defaultValue={defaultName} {...aria} />
      {!hasSignedInUser && (
        <Field
          label="Email"
          name="customerEmail"
          type="email"
          required
          defaultValue={defaultEmail}
          {...aria}
        />
      )}
      <Field label="Phone (optional)" name="customerPhone" type="tel" {...aria} />
      <Field label="Company / business (optional)" name="companyName" {...aria} />
      <Field label="Destination country" name="destinationCountry" defaultValue="Namibia" {...aria} />
      <label className="block">
        <span className="text-sm font-medium">What do you need?</span>
        <textarea
          name="message"
          rows={5}
          maxLength={4000}
          minLength={10}
          required
          {...aria}
          className="mt-1 block w-full rounded-md border border-border bg-white px-3 py-2 text-base focus:border-brand-700 focus:outline-none"
          placeholder="Volume, timing, packaging, target landed price, any specs…"
        />
      </label>
      <FormError id={errorId} message={state?.error} />
      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Submitting…' : 'Submit quote request'}
      </Button>
      <p className="text-xs text-muted-foreground">
        We typically respond within one business day with pricing, lead time, and shipping
        options.
      </p>
    </form>
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
