'use client'

import { useActionState } from 'react'
import {
  submitVendorApplicationAction,
  type VendorApplicationState,
} from '@/lib/vendor-actions'
import { Button } from '@/components/ui/button'
import { FormError, useFormErrorAria } from '@/components/ui/form-error'

export function VendorApplicationForm() {
  const [state, formAction, pending] = useActionState<VendorApplicationState, FormData>(
    submitVendorApplicationAction,
    null,
  )
  const errorId = 'vendor-application-error'
  const aria = useFormErrorAria(errorId, !!state?.error)

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <Field label="Business / brand name" name="name" required maxLength={120} {...aria} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Contact name" name="contactName" required maxLength={120} {...aria} />
        <Field
          label="Contact email"
          name="contactEmail"
          type="email"
          required
          autoComplete="email"
          {...aria}
        />
        <Field label="Contact phone (optional)" name="contactPhone" type="tel" {...aria} />
        <Field
          label="Country"
          name="country"
          required
          defaultValue="Namibia"
          autoComplete="country-name"
          {...aria}
        />
        <Field label="City (optional)" name="city" {...aria} />
        <Field
          label="Tagline (optional · max 160 chars)"
          name="tagline"
          maxLength={160}
          {...aria}
        />
      </div>
      <Textarea
        label="What do you sell? Tell us about the business."
        name="bio"
        rows={5}
        maxLength={4000}
        required
        placeholder="Provenance, production capacity, certifications, why customers should care…"
        {...aria}
      />
      <Textarea
        label="Product categories (optional)"
        name="categories"
        rows={2}
        maxLength={500}
        placeholder="Sauces, honey, dried fruit, apparel…"
        {...aria}
      />
      <FormError id={errorId} message={state?.error} />
      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Submitting…' : 'Submit application'}
      </Button>
      <p className="text-xs text-muted-foreground">
        We review every application personally. You&apos;ll hear from us within two business days
        — typically the same day.
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

function Textarea({
  label,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <textarea
        {...props}
        className="mt-1 block w-full rounded-md border border-border bg-white px-3 py-2 text-base focus:border-brand-700 focus:outline-none"
      />
    </label>
  )
}
