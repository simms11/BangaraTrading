'use client'

import * as React from 'react'
import { useActionState } from 'react'
import { placeOrderAction, type CheckoutFormState } from '@/lib/checkout-actions'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { FormError, useFormErrorAria } from '@/components/ui/form-error'
import { ShippingPicker } from './shipping-picker'

type Processor = 'stripe' | 'flutterwave' | 'manual'

const processorLabel: Record<Processor, { label: string; description: string }> = {
  stripe: { label: 'Card (Stripe)', description: 'Visa, Mastercard, Apple Pay. International.' },
  flutterwave: {
    label: 'Card / mobile money (Flutterwave)',
    description: 'NAD/ZAR cards, mobile money, bank transfer. Africa-friendly.',
  },
  manual: {
    label: 'Manual bank transfer',
    description: 'We email you bank details; order ships once funds clear.',
  },
}

export function CheckoutForm({
  availableProcessors,
  defaultEmail,
  hasSignedInUser,
}: {
  availableProcessors: Processor[]
  defaultEmail: string
  hasSignedInUser: boolean
}) {
  const [state, formAction, pending] = useActionState<CheckoutFormState, FormData>(
    placeOrderAction,
    null,
  )
  const [billingSame, setBillingSame] = React.useState(true)
  const [processor, setProcessor] = React.useState<Processor>(availableProcessors[0] ?? 'manual')
  const errorId = 'checkout-error'
  const aria = useFormErrorAria(errorId, !!state?.error)

  return (
    <form action={formAction} className="space-y-8" noValidate>
      {!hasSignedInUser && (
        <Section title="Contact">
          <Field
            label="Email"
            name="email"
            type="email"
            defaultValue={defaultEmail}
            required
            autoComplete="email"
            {...aria}
          />
        </Section>
      )}

      <Section title="Shipping address">
        <AddressFields prefix="shipping" ariaErrorProps={aria} />
      </Section>

      <Section title="Shipping method">
        <ShippingPicker
          countryFieldName="shipping.country"
          postalCodeFieldName="shipping.postalCode"
          regionFieldName="shipping.region"
          cityFieldName="shipping.city"
        />
      </Section>

      <Section title="Billing address">
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
            <AddressFields prefix="billing" ariaErrorProps={aria} />
          </div>
        )}
      </Section>

      <Section title="Payment method">
        <fieldset className="space-y-2">
          <legend className="sr-only">Choose a payment method</legend>
          {availableProcessors.map((p) => {
            const info = processorLabel[p]
            return (
              <label
                key={p}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-4 transition ${
                  processor === p ? 'border-brand-700 bg-brand-50' : 'border-border bg-white'
                }`}
              >
                <input
                  type="radio"
                  name="processor"
                  value={p}
                  checked={processor === p}
                  onChange={() => setProcessor(p)}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{info.label}</span>
                    {p === 'manual' && <Badge variant="default">Available</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">{info.description}</p>
                </div>
              </label>
            )
          })}
        </fieldset>
      </Section>

      <Section title="Order notes (optional)">
        <textarea
          name="notes"
          rows={3}
          maxLength={2000}
          className="block w-full rounded-md border border-border bg-white px-3 py-2 text-base focus:border-brand-700 focus:outline-none"
          placeholder="Delivery instructions, special requests…"
        />
      </Section>

      <FormError id={errorId} message={state?.error} />

      <Button type="submit" size="lg" variant="primary" className="w-full" disabled={pending}>
        {pending ? 'Placing order…' : 'Place order'}
      </Button>

      <p className="text-xs text-muted-foreground">
        By placing this order you agree to Bangarah Trading&apos;s terms. You&apos;ll be
        redirected to complete payment if a card processor is selected.
      </p>
    </form>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      <div className="mt-4 space-y-3">{children}</div>
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
        <Field label="Full name" name={`${prefix}.name`} autoComplete={`${prefix} name`} required {...aria} />
      </div>
      <div className="sm:col-span-2">
        <Field
          label="Street address"
          name={`${prefix}.line1`}
          autoComplete={`${prefix} address-line1`}
          required
          {...aria}
        />
      </div>
      <div className="sm:col-span-2">
        <Field
          label="Apartment, suite (optional)"
          name={`${prefix}.line2`}
          autoComplete={`${prefix} address-line2`}
          {...aria}
        />
      </div>
      <Field
        label="City"
        name={`${prefix}.city`}
        autoComplete={`${prefix} address-level2`}
        required
        {...aria}
      />
      <Field
        label="Region / State"
        name={`${prefix}.region`}
        autoComplete={`${prefix} address-level1`}
        {...aria}
      />
      <Field
        label="Postal code"
        name={`${prefix}.postalCode`}
        autoComplete={`${prefix} postal-code`}
        required
        {...aria}
      />
      <Field
        label="Country"
        name={`${prefix}.country`}
        autoComplete={`${prefix} country-name`}
        defaultValue="Namibia"
        required
        {...aria}
      />
      <div className="sm:col-span-2">
        <Field label="Phone (optional)" name={`${prefix}.phone`} autoComplete="tel" type="tel" {...aria} />
      </div>
    </div>
  )
}
