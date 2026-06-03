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

export type NewQuoteEmailProps = {
  quoteNumber: string
  /**
   * H7 minor: forwarded into the customer-facing view URL so the customer
   * can return to their quote after closing the redirect tab. Required for
   * the C2 token-gate to work end-to-end — without it the URL in the email
   * lands on a 404 because the page rejects token-less access.
   */
  confirmationToken?: string
  customerName: string
  customerEmail: string
  companyName?: string
  destinationCountry?: string
  message?: string
  items: Array<{ title: string; quantity: number }>
  siteUrl: string
  /** When true, this is the ops alert (different copy + link); when false, customer ack */
  isOpsAlert?: boolean
}

export function NewQuoteEmail({
  quoteNumber,
  confirmationToken,
  customerName,
  customerEmail,
  companyName,
  destinationCountry,
  message,
  items,
  siteUrl,
  isOpsAlert,
}: NewQuoteEmailProps) {
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        {isOpsAlert
          ? `New quote request ${quoteNumber} from ${customerName}`
          : `We received your quote ${quoteNumber}`}
      </Preview>
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
            {isOpsAlert
              ? `New quote request — ${quoteNumber}`
              : `Thanks ${customerName} — we'll be in touch`}
          </Heading>

          <Text style={{ color: '#57534e', fontSize: 14 }}>
            {isOpsAlert ? (
              <>
                From <strong>{customerName}</strong>
                {companyName ? ` (${companyName})` : ''} · {customerEmail}
                {destinationCountry ? ` · ships to ${destinationCountry}` : ''}
              </>
            ) : (
              <>
                Your quote <strong>{quoteNumber}</strong> has been received. We&apos;ll respond
                with pricing and lead time within one business day.
              </>
            )}
          </Text>

          {message && (
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
              <Text style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{message}</Text>
            </Section>
          )}

          <Hr style={{ borderColor: '#e7e2d8', margin: '24px 0' }} />

          {items.length > 0 && (
            <>
              <Text style={{ margin: 0, fontWeight: 600 }}>Items requested</Text>
              {items.map((it, i) => (
                <Text key={i} style={{ margin: 0, padding: '6px 0', color: '#0f172a' }}>
                  {it.title} × {it.quantity}
                </Text>
              ))}
            </>
          )}

          {!isOpsAlert && confirmationToken && (
            <>
              <Hr style={{ borderColor: '#e7e2d8', margin: '24px 0' }} />
              <Text style={{ color: '#57534e', fontSize: 13 }}>
                You can view this quote any time at:{' '}
                <a
                  href={`${siteUrl}/quotes/${quoteNumber}?t=${confirmationToken}`}
                >
                  {siteUrl}/quotes/{quoteNumber}
                </a>
              </Text>
            </>
          )}

          {isOpsAlert && (
            <>
              <Hr style={{ borderColor: '#e7e2d8', margin: '24px 0' }} />
              <Text style={{ color: '#57534e', fontSize: 13 }}>
                Open the quote in admin to respond:{' '}
                <a href={`${siteUrl}/admin/collections/quotes`}>
                  {siteUrl}/admin/collections/quotes
                </a>
              </Text>
            </>
          )}
        </Container>
      </Body>
    </Html>
  )
}
