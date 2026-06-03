/**
 * J1 (round-4 C1): shared form-level error renderer.
 *
 * Every server-action form in the app surfaces one generic error message
 * on failure. Prior to round-4 these were rendered as `<p role="alert">`
 * with no id, so the error wasn't programmatically associated with the
 * inputs — screen-reader users heard the announcement but had no way to
 * navigate to the offending field (WCAG 1.3.1 / 4.1.2).
 *
 * The pattern is: render this component with a stable id, and spread
 * `useFormErrorAria(id, !!state?.error)` onto every input. The hook
 * returns `{ 'aria-invalid', 'aria-describedby' }` (or `{}`) so the
 * caller can `<Field {...aria} />` without conditional ternaries.
 */
import * as React from 'react'

export type FormErrorAria =
  | { 'aria-invalid': true; 'aria-describedby': string }
  | Record<string, never>

export function useFormErrorAria(id: string, hasError: boolean): FormErrorAria {
  return hasError ? { 'aria-invalid': true, 'aria-describedby': id } : {}
}

export function FormError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p
      id={id}
      role="alert"
      aria-live="polite"
      className="rounded-md bg-spice-50 px-3 py-2 text-sm text-spice-800"
    >
      {message}
    </p>
  )
}
