'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { signUpAction, type AuthFormState } from '@/lib/auth-actions'
import { Button } from '@/components/ui/button'

export function SignUpForm() {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(signUpAction, null)
  // Clean-room frontend — forward a same-origin `next` so a guest sent to
  // sign-up mid-checkout returns there after creating an account.
  const params = useSearchParams()
  const next = params.get('next') ?? ''
  // J1 (round-4 C1) — see sign-in-form.tsx for the rationale.
  const errorId = 'sign-up-error'
  const ariaProps = state?.error
    ? { 'aria-invalid': true as const, 'aria-describedby': errorId }
    : {}

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {next && <input type="hidden" name="next" value={next} />}
      <Field label="Full name" name="name" autoComplete="name" required {...ariaProps} />
      <Field label="Email" name="email" type="email" autoComplete="email" required {...ariaProps} />
      <Field
        label="Password (min 8 chars)"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={8}
        required
        {...ariaProps}
      />
      {state?.error && (
        <p id={errorId} role="alert" aria-live="polite" className="rounded-md bg-spice-50 px-3 py-2 text-sm text-spice-800">
          {state.error}
        </p>
      )}
      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Creating account…' : 'Create account'}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link
          href={next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in'}
          className="font-medium text-brand-700 underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
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
