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

export type OrderConfirmationEmailProps = {
  orderNumber: string
  customerName?: string
  totalFormatted: string
  /** Final audit (frontend) — optional Subtotal/Shipping/Tax so the
   * line items visibly sum to the Total. R10: Tax row added so
   * Stripe-Tax orders don't show an unexplained gap between
   * Subtotal+Shipping and Total. */
  subtotalFormatted?: string
  shippingFormatted?: string
  taxFormatted?: string
  currency: string
  items: Array<{ title: string; quantity: number; lineTotalFormatted: string }>
  siteUrl: string
  manualPaymentInstructions?: string
}

export function OrderConfirmationEmail({
  orderNumber,
  customerName,
  totalFormatted,
  subtotalFormatted,
  shippingFormatted,
  taxFormatted,
  items,
  siteUrl,
  manualPaymentInstructions,
}: OrderConfirmationEmailProps) {
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Your Bangarah order {orderNumber} is confirmed</Preview>
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
            style={{ fontSize: 28, fontWeight: 600, color: '#0f1d4d', marginBottom: 8 }}
          >
            Thanks{customerName ? `, ${customerName}` : ''} — your order is in.
          </Heading>
          <Text style={{ color: '#57534e', fontSize: 14 }}>
            Order <strong>{orderNumber}</strong>
          </Text>

          {manualPaymentInstructions && (
            <Section
              style={{
                marginTop: 24,
                padding: 16,
                background: '#fef3c7',
                border: '1px solid #fde58a',
                borderRadius: 12,
                color: '#78350f',
                fontSize: 14,
                lineHeight: '20px',
              }}
            >
              <Text style={{ margin: 0, fontWeight: 600 }}>Payment instructions</Text>
              <Text style={{ margin: 0, marginTop: 6 }}>{manualPaymentInstructions}</Text>
            </Section>
          )}

          <Hr style={{ borderColor: '#e7e2d8', margin: '24px 0' }} />

          {items.map((item) => (
            <Section
              key={item.title + item.quantity}
              style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}
            >
              <Text style={{ margin: 0, color: '#0f172a' }}>
                {item.title} × {item.quantity}
              </Text>
              <Text style={{ margin: 0, color: '#0f172a' }}>{item.lineTotalFormatted}</Text>
            </Section>
          ))}

          <Hr style={{ borderColor: '#e7e2d8', margin: '16px 0' }} />

          {subtotalFormatted && (
            <Section style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
              <Text style={{ margin: 0, color: '#57534e' }}>Subtotal</Text>
              <Text style={{ margin: 0, color: '#57534e' }}>{subtotalFormatted}</Text>
            </Section>
          )}
          {shippingFormatted && (
            <Section style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
              <Text style={{ margin: 0, color: '#57534e' }}>Shipping</Text>
              <Text style={{ margin: 0, color: '#57534e' }}>{shippingFormatted}</Text>
            </Section>
          )}
          {taxFormatted && (
            <Section style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
              <Text style={{ margin: 0, color: '#57534e' }}>Tax</Text>
              <Text style={{ margin: 0, color: '#57534e' }}>{taxFormatted}</Text>
            </Section>
          )}
          <Section style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 4 }}>
            <Text style={{ margin: 0, fontWeight: 600 }}>Total</Text>
            <Text style={{ margin: 0, fontWeight: 600 }}>{totalFormatted}</Text>
          </Section>

          <Hr style={{ borderColor: '#e7e2d8', margin: '32px 0 16px' }} />
          <Text style={{ color: '#57534e', fontSize: 12 }}>
            Bangarah Trading Enterprises CC · Unit 8, Omumbonde Industrial Park, Okahandja, Namibia
            <br />
            Questions? Reply to this email or call +264 813 416 764.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}
