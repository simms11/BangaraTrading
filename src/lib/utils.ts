import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * J4 (round-4 M4): when no locale is passed, derive a sensible default
 * from the currency. The previous behaviour always used 'en-NA', so a
 * ZAR-denominated order rendered "N$ …" instead of "R …". The currency
 * map below covers our supported set; falls back to 'en' (Intl will then
 * use the currency-default formatting).
 */
const CURRENCY_LOCALE: Record<string, string> = {
  NAD: 'en-NA',
  ZAR: 'en-ZA',
  USD: 'en-US',
  GBP: 'en-GB',
  EUR: 'en-IE',
}

export function formatPrice(
  amountMinor: number,
  currency: string = 'NAD',
  locale?: string,
): string {
  const resolved = locale ?? CURRENCY_LOCALE[currency.toUpperCase()] ?? 'en'
  return new Intl.NumberFormat(resolved, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amountMinor / 100)
}

/**
 * J4 (round-4 M4): explicit-locale date formatter. Vercel functions run
 * UTC + en-US by default; the browser uses the user's OS locale. When
 * code does `new Date(...).toLocaleDateString()` with no args, the server-
 * rendered HTML and client-side React tree disagree → hydration mismatch
 * warning + Sentry noise. Standardise on `en-NA` for now (matches our
 * primary market) and accept an override.
 */
export function formatDate(input: string | number | Date, locale = 'en-NA'): string {
  const d = input instanceof Date ? input : new Date(input)
  return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * J6 (round-4 minor m1): reject characters dangerous in display contexts.
 *
 * Catches:
 *   - U+0000-U+001F + U+007F          (ASCII controls — CR/LF block email
 *                                      header injection)
 *   - U+0080-U+009F                   (C1 control range)
 *   - U+200B-U+200F                   (zero-width + bidi marks: brand-name
 *                                      homoglyphs like "Bangar<ZWSP>ah")
 *   - U+202A-U+202E                   (bidi-override: visual flip attacks
 *                                      like "Apple<RLO>txt.gov")
 *   - U+2028 / U+2029                 (line/paragraph separators)
 *   - U+2066-U+2069                   (more bidi isolate marks)
 *   - U+FEFF                          (BOM / zero-width no-break space)
 *
 * Built via `RegExp` constructor + `String.fromCharCode` so the source
 * file contains no literal control / bidi bytes (the literal-bytes
 * approach was the root cause of the Phase 5.13 binary-file regression).
 */
const DANGEROUS_CHAR_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  // R7 round-7 security m4 — soft hyphen (U+00AD) is invisible in most
  // fonts and lets "Bangar­ah" look identical to "Bangarah" — a
  // unique-constraint evasion + visual brand-impersonation vector.
  [0x00ad, 0x00ad],
  // R7 round-7 security m4 — combining grapheme joiner (U+034F) used
  // similarly for spoofing.
  [0x034f, 0x034f],
  [0x200b, 0x200f],
  [0x2028, 0x2029],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
]
const DANGEROUS_CHARS_RE = new RegExp(
  '[' +
    DANGEROUS_CHAR_RANGES.map(([lo, hi]) =>
      lo === hi
        ? `\\u${lo.toString(16).padStart(4, '0')}`
        : `\\u${lo.toString(16).padStart(4, '0')}-\\u${hi.toString(16).padStart(4, '0')}`,
    ).join('') +
    ']',
)
export function noDangerousChars(s: string): boolean {
  return !DANGEROUS_CHARS_RE.test(s)
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
