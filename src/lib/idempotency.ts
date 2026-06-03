import 'server-only'
import { getPayload } from '@/lib/payload'

/**
 * Atomically claim a webhook event id. Returns true the first time, false on
 * every subsequent call for the same key. Backed by the unique constraint on
 * processed_events.key — the DB does the work.
 */
export async function claimEvent(args: {
  processor: 'stripe' | 'flutterwave'
  eventId: string
  kind?: string
  orderId?: string | number
}): Promise<boolean> {
  const payload = await getPayload()
  const key = `${args.processor}:${args.eventId}`
  try {
    await payload.create({
      collection: 'processed-events',
      overrideAccess: true,
      data: {
        key,
        processor: args.processor,
        kind: args.kind,
        orderId: args.orderId != null ? String(args.orderId) : undefined,
      },
    })
    return true
  } catch (e) {
    // Unique constraint violation → already processed. Any other error
    // re-throws so the caller can decide how to handle it.
    //
    // J6 (round-4 m5) — prefer the Postgres SQLSTATE code (23505 =
    // unique_violation) over substring-matching the wrapped error
    // message. Payload + pg-error wrapping can reword the message in a
    // minor; checking the code first is robust. Substring fallback kept
    // for adapters that mask the code.
    const code = (e as { code?: string }).code
    if (code === '23505') return false
    const message = (e as Error).message?.toLowerCase() ?? ''
    if (message.includes('unique') || message.includes('duplicate')) return false
    throw e
  }
}

/**
 * Idempotency *check* without claiming. The webhook handlers use this so a
 * hard-fail (e.g. amount mismatch) can be retried by the provider without
 * the retry being short-circuited as a duplicate. Once business logic
 * succeeds, the handler calls claimEvent to lock the key.
 */
export async function hasEvent(args: {
  processor: 'stripe' | 'flutterwave'
  eventId: string
}): Promise<boolean> {
  const payload = await getPayload()
  const key = `${args.processor}:${args.eventId}`
  const { docs } = await payload.find({
    collection: 'processed-events',
    where: { key: { equals: key } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return docs.length > 0
}
