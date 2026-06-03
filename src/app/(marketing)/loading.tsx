import { Container } from '@/components/ui/container'

export default function MarketingLoading() {
  // min-h-screen — the fallback must fill the viewport. The streamed shell
  // flushes header + THIS fallback + footer; when the fallback is short, the
  // footer paints inside the viewport and the real page content shoves it
  // ~2,500px down as it streams in — a 0.45 CLS on every marketing route
  // (measured by Lighthouse with zero JS involved). With the fallback
  // viewport-tall, the footer starts below the fold and the content swap
  // happens out of view.
  return (
    <section className="min-h-screen py-20" aria-busy aria-live="polite">
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
