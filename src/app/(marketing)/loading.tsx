import { Container } from '@/components/ui/container'

export default function MarketingLoading() {
  return (
    <section className="py-20" aria-busy aria-live="polite">
      <Container size="md" className="space-y-6">
        <div className="h-12 w-2/3 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="h-40 animate-pulse rounded-xl bg-muted" />
          <div className="h-40 animate-pulse rounded-xl bg-muted" />
          <div className="h-40 animate-pulse rounded-xl bg-muted" />
        </div>
      </Container>
    </section>
  )
}
