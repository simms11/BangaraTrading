import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import { formatDate } from '@/lib/utils'

export type QuoteResponseEmailProps = {
  quoteNumber: string
  customerName?: string
  totalFormatted: string
  validUntil?: string
  responseMessage?: string
  items: Array<{ title: string; quantity: number; unitPriceFormatted: string }>
  acceptUrl: string
  siteUrl: string
}

export function QuoteResponseEmail({
  quoteNumber,
  customerName,
  totalFormatted,
  validUntil,
  responseMessage,
  items,
  acceptUrl,
  siteUrl,
}: QuoteResponseEmailProps) {
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Your quote {quoteNumber} is ready · {totalFormatted}</Preview>
      <Body style={{ backgroundColor: '#fdfcf9', fontFamily: 'Inter, sans-serif', margin: 0 }}>
        <Container style={{ maxWidth: 560, margin: '0 auto', padding: 24 }}>
          <Section style={{ padding: '24px 0' }}>
            <Img
              src={`${siteUrl}/logo.png`}
              width="48"
              height="48"
              alt="Bangarah Trading"
              style={{ display: 'block' }}
            />
          </Section>

          <Heading
            as="h1"
            style={{ fontSize: 26, fontWeight: 600, color: '#0f1d4d', marginBottom: 8 }}
          >
            {customerName ? `${customerName}, your quote is ready.` : 'Your quote is ready.'}
          </Heading>

          <Text style={{ color: '#57534e', fontSize: 14 }}>
            Quote <strong>{quoteNumber}</strong>
            {validUntil ? ` · Valid until ${formatDate(validUntil)}` : ''}
          </Text>

          {responseMessage && (
            <Section
              style={{
                marginTop: 16,
                padding: 12,
                background: '#f5f3ee',
                borderRadius: 8,
                color: '#0f172a',
                fontSize: 14,
              }}
            >
              <Text style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{responseMessage}</Text>
            </Section>
          )}

          <Hr style={{ borderColor: '#e7e2d8', margin: '24px 0' }} />

          {items.map((it, i) => (
            <Section
              key={i}
              style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}
            >
              <Text style={{ margin: 0, color: '#0f172a' }}>
                {it.title} × {it.quantity}
              </Text>
              <Text style={{ margin: 0, color: '#0f172a' }}>{it.unitPriceFormatted}</Text>
            </Section>
          ))}

          <Hr style={{ borderColor: '#e7e2d8', margin: '16px 0' }} />
          <Section style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Text style={{ margin: 0, fontWeight: 600 }}>Total</Text>
            <Text style={{ margin: 0, fontWeight: 600 }}>{totalFormatted}</Text>
          </Section>

          <Section style={{ marginTop: 24 }}>
            <a
              href={acceptUrl}
              style={{
                display: 'inline-block',
                backgroundColor: '#0f1d4d',
                color: 'white',
                padding: '12px 24px',
                borderRadius: 999,
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              Accept &amp; proceed to checkout
            </a>
          </Section>

          <Hr style={{ borderColor: '#e7e2d8', margin: '32px 0 16px' }} />
          <Text style={{ color: '#57534e', fontSize: 12 }}>
            Bangarah Trading Enterprises CC · Unit 8, Omumbonde Industrial Park, Okahandja, Namibia
          </Text>
        </Container>
      </Body>
    </Html>
  )
}
