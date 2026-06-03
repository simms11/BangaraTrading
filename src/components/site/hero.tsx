import Link from 'next/link'
import { ArrowRight, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Container } from '@/components/ui/container'

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-brand-50 via-background to-accent-50/60 py-20 lg:py-28">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 -z-10 transform-gpu overflow-hidden blur-3xl"
      >
        <div
          className="relative left-[calc(50%-11rem)] aspect-[1155/678] w-[36rem] -translate-x-1/2 rotate-[30deg] bg-gradient-to-tr from-spice-400 to-accent-300 opacity-20 sm:left-[calc(50%-30rem)] sm:w-[72rem]"
          style={{
            clipPath:
              'polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)',
          }}
        />
      </div>
      <Container size="lg" className="grid items-center gap-12 lg:grid-cols-12">
        <div className="lg:col-span-7 space-y-6">
          <Badge variant="accent" className="gap-1.5">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Marketplace for African & Caribbean sole traders
          </Badge>
          <h1 className="font-display text-5xl font-semibold tracking-tight sm:text-6xl lg:text-7xl">
            Real provenance.{' '}
            <span className="bg-gradient-to-r from-brand-700 via-spice-500 to-accent-500 bg-clip-text text-transparent">
              Premium taste.
            </span>
          </h1>
          <p className="max-w-xl text-lg text-muted-foreground text-pretty">
            Patented Ayisha&apos;s Herbal and Kiyaya&apos;s sauces, pure Namibian honey, and
            curated Pan-African and Caribbean imports — sold directly by the makers, shipped
            across Africa and the diaspora.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg" variant="primary">
              <Link href="/shop">
                Shop the marketplace
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/quote">Request a bulk quote</Link>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Selling your own sauces, honey or food brand?{' '}
            <Link href="/sell" className="font-medium text-brand-700 underline-offset-4 hover:underline">
              Apply to list as a vendor
            </Link>
            .
          </p>
        </div>
        <div className="lg:col-span-5">
          <div className="relative rounded-3xl bg-gradient-to-br from-brand-900 to-brand-700 p-8 text-white shadow-xl">
            <div className="absolute -top-6 -right-6 rounded-2xl bg-accent-400 px-4 py-2 text-sm font-semibold text-brand-950 shadow-lg">
              Patented brands · Est. 2011
            </div>
            <h2 className="font-display text-3xl font-semibold">
              Curated by Bangarah, made by trusted producers.
            </h2>
            <ul className="mt-6 space-y-3 text-brand-100">
              {[
                "Ayisha's Herbal Sauces — signature recipes",
                "Kiyaya's Brand — Extra Hot, Hot & Sweet Chilli",
                "Kiyaya's Pure Honey — Namibian provenance",
                'Pan-African soft drinks & supplements',
                'Caribbean imports — books, music, film, apparel',
              ].map((s) => (
                <li key={s} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400" aria-hidden />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Container>
    </section>
  )
}
