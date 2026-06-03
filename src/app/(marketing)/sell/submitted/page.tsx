import type { Metadata } from 'next'
import Link from 'next/link'
import { CheckCircle2 } from 'lucide-react'
import { Container } from '@/components/ui/container'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = {
  title: 'Application submitted',
  robots: { index: false, follow: false },
}

export default function VendorApplicationSubmittedPage() {
  return (
    <section className="py-20">
      <Container size="sm" className="max-w-xl space-y-6 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" aria-hidden />
        <h1 className="font-display text-4xl font-semibold tracking-tight">
          Application received
        </h1>
        <p className="text-muted-foreground">
          Thanks for applying to sell on Bangarah. We&apos;ll review your application personally
          and email you within one business day with next steps. If approved, we&apos;ll set up
          your vendor account and walk you through publishing your first products.
        </p>
        <Button asChild variant="primary">
          <Link href="/shop">Back to the marketplace</Link>
        </Button>
      </Container>
    </section>
  )
}
