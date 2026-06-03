'use client'

import { useActionState } from 'react'
import { submitQuoteFromCartAction, type QuoteFormState } from '@/lib/quote-actions'
import { Button } from '@/components/ui/button'
import { FormError, useFormErrorAria } from '@/components/ui/form-error'

export function SubmitQuoteForm({
  defaultName,
  defaultEmail,
  hasSignedInUser,
}: {
  defaultName: string
  defaultEmail: string
  hasSignedInUser: boolean
}) {
  const [state, formAction, pending] = useActionState<QuoteFormState, FormData>(
    submitQuoteFromCartAction,
    null,
  )
  const errorId = 'submit-quote-error'
  const aria = useFormErrorAria(errorId, !!state?.error)

  return (
    <form action={formAction} className="space-y-4" noValidate>
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
        <span className="text-sm font-medium">Message (optional)</span>
        <textarea
          name="message"
          rows={4}
          maxLength={4000}
          {...aria}
          className="mt-1 block w-full rounded-md border border-border bg-white px-3 py-2 text-base focus:border-brand-700 focus:outline-none"
          placeholder="Volume, timing, special requirements…"
        />
      </label>
      <FormError id={errorId} message={state?.error} />
      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Submitting…' : 'Submit quote request'}
      </Button>
      <p className="text-xs text-muted-foreground">
        We typically respond within one business day. Retail items in your cart remain there for
        normal checkout.
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
