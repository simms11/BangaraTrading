import 'server-only'
import { getPayload as _getPayload } from 'payload'
import config from '@payload-config'

let cached: Awaited<ReturnType<typeof _getPayload>> | null = null

export async function getPayload() {
  if (cached) return cached
  cached = await _getPayload({ config })
  return cached
}

export type SafeAsyncResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

export async function safe<T>(fn: () => Promise<T>): Promise<SafeAsyncResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[bangarah:payload]', error)
    }
    return { ok: false, error }
  }
}
