import { stripeProcessor } from './stripe'
import { flutterwaveProcessor } from './flutterwave'
import { manualProcessor } from './manual'
import type { PaymentProcessor, ProcessorName } from './types'

export const processors: Record<ProcessorName, PaymentProcessor> = {
  stripe: stripeProcessor,
  flutterwave: flutterwaveProcessor,
  manual: manualProcessor,
}

export function listConfiguredProcessors(): ProcessorName[] {
  const out: ProcessorName[] = []
  if (stripeProcessor.isConfigured()) out.push('stripe')
  if (flutterwaveProcessor.isConfigured()) out.push('flutterwave')
  // Manual is always available as a fallback unless an env explicitly disables it
  if (process.env.DISABLE_MANUAL_CHECKOUT !== 'true') out.push('manual')
  return out
}

export function getProcessor(name: ProcessorName): PaymentProcessor {
  return processors[name]
}
