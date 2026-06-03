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

export type VendorApprovedEmailProps = {
  vendorName: string
  storefrontUrl: string
  signInUrl: string
  siteUrl: string
}

export function VendorApprovedEmail(props: VendorApprovedEmailProps) {
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{props.vendorName} is now live on Bangarah</Preview>
      <Body style={{ backgroundColor: '#fdfcf9', fontFamily: 'Inter, sans-serif', margin: 0 }}>
        <Container style={{ maxWidth: 560, margin: '0 auto', padding: 24 }}>
          <Section style={{ padding: '24px 0' }}>
            <Img
              src={`${props.siteUrl}/logo.png`}
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
            Welcome to Bangarah, {props.vendorName}
          </Heading>
          <Text style={{ color: '#0f172a', fontSize: 14, lineHeight: '20px' }}>
            Your vendor account has been approved. Your storefront is live and customers can now
            order from you.
          </Text>
          <Section style={{ marginTop: 24 }}>
            <a
              href={props.signInUrl}
              style={{
                display: 'inline-block',
                backgroundColor: '#0f1d4d',
                color: 'white',
                padding: '12px 24px',
                borderRadius: 999,
                textDecoration: 'none',
                fontWeight: 600,
                marginRight: 12,
              }}
            >
              Open vendor dashboard
            </a>
            <a
              href={props.storefrontUrl}
              style={{
                display: 'inline-block',
                color: '#0f1d4d',
                padding: '12px 24px',
                textDecoration: 'underline',
                fontWeight: 600,
              }}
            >
              View your storefront
            </a>
          </Section>
          <Hr style={{ borderColor: '#e7e2d8', margin: '32px 0 16px' }} />
          <Text style={{ color: '#57534e', fontSize: 12 }}>
            Need help? Reply to this email or call +264 813 416 764.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}
