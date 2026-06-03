'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { signInAction, type AuthFormState } from '@/lib/auth-actions'
import { Button } from '@/components/ui/button'

export function SignInForm() {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(signInAction, null)
  const params = useSearchParams()
  const next = params.get('next') ?? ''
  // J1 (round-4 C1) — programmatically associate the form-level error with
  // every input so SR users hear the failure when they land on an input,
  // and `aria-invalid` triggers the high-contrast invalid-state outline.
  const errorId = 'sign-in-error'
  const ariaProps = state?.error
    ? { 'aria-invalid': true as const, 'aria-describedby': errorId }
    : {}

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {next && <input type="hidden" name="next" value={next} />}
      <Field label="Email" name="email" type="email" autoComplete="email" required {...ariaProps} />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        {...ariaProps}
      />
      {state?.error && (
        <p id={errorId} role="alert" aria-live="polite" className="rounded-md bg-spice-50 px-3 py-2 text-sm text-spice-800">
          {state.error}
        </p>
      )}
      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        No account yet?{' '}
        <Link
          href={next ? `/sign-up?next=${encodeURIComponent(next)}` : '/sign-up'}
          className="font-medium text-brand-700 underline-offset-4 hover:underline"
        >
          Create one
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
