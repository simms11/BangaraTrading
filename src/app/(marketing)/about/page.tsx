import type { Metadata } from 'next'
import { Container } from '@/components/ui/container'
import { Badge } from '@/components/ui/badge'
import { Award, Globe, ShieldCheck } from 'lucide-react'

export const metadata: Metadata = {
  title: 'About — Established 2011',
  description:
    'Bangarah Trading Enterprises is a Namibia-registered Close Corporation specializing in premium sauces, honey, and Pan-African and Caribbean specialty goods.',
  alternates: { canonical: '/about' },
}

export default function AboutPage() {
  return (
    <article className="py-20">
      <Container size="md" className="space-y-12">
        <header className="space-y-4">
          <Badge variant="accent">Established 2011</Badge>
          <h1 className="text-5xl font-semibold tracking-tight">
            A trading house with integrity at its core
          </h1>
          <p className="text-xl text-muted-foreground text-pretty">
            Registered under the Namibian Close Corporation Act, Bangarah Trading Enterprises has
            delivered quality sauces, honeys and specialty goods across Southern Africa and beyond
            for over a decade — and is now a marketplace home for sole traders sharing the same
            values.
          </p>
        </header>

        <div className="grid gap-6 md:grid-cols-3">
          <div className="rounded-2xl border border-border bg-white p-6 shadow-sm">
            <Award className="h-8 w-8 text-brand-600" aria-hidden />
            <h2 className="mt-4 text-lg font-semibold">Patented brands</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Ayisha&apos;s Herbal and Kiyaya&apos;s Brand sauces are produced to international
              quality standards and are proudly patented.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-white p-6 shadow-sm">
            <Globe className="h-8 w-8 text-brand-600" aria-hidden />
            <h2 className="mt-4 text-lg font-semibold">Pan-African reach</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Established trade networks across Namibia, Southern Africa, and the Caribbean
              diaspora — import, export, manufacture, distribute.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-white p-6 shadow-sm">
            <ShieldCheck className="h-8 w-8 text-brand-600" aria-hidden />
            <h2 className="mt-4 text-lg font-semibold">Trusted by 500+ customers</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              From single jars of honey to bulk wholesale orders, our 24/7 emergency support and
              transparent pricing keep buyers coming back.
            </p>
          </div>
        </div>

        <div className="prose prose-lg max-w-none text-muted-foreground">
          <p>
            From our facility at Unit 8, Omumbonde Industrial Park in Okahandja, we manufacture
            premium sauces — including the Extra Hot, Hot and Sweet Chilli lines — alongside honey
            processing and packaging for our own Kiyaya&apos;s Pure Honey brand.
          </p>
          <p>
            Beyond our own brands, we curate Pan-African soft drinks, food supplements and
            Caribbean imports — books, music, films and clothing — for customers across Namibia
            and the diaspora. Our marketplace now welcomes other sole traders who share our
            commitment to freshness, reliability and provenance.
          </p>
        </div>
      </Container>
    </article>
  )
}
