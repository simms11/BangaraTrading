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

export type VendorApplicationEmailProps = {
  vendorName: string
  contactName: string
  contactEmail: string
  contactPhone?: string
  country: string
  city?: string
  tagline?: string
  bio: string
  categories?: string
  adminUrl: string
  siteUrl: string
}

export function VendorApplicationEmail(props: VendorApplicationEmailProps) {
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>New vendor application: {props.vendorName}</Preview>
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
            style={{ fontSize: 24, fontWeight: 600, color: '#0f1d4d', marginBottom: 8 }}
          >
            New vendor application
          </Heading>
          <Text style={{ color: '#57534e', fontSize: 14 }}>
            <strong>{props.vendorName}</strong> ({props.contactName} · {props.contactEmail})
            {props.contactPhone ? ` · ${props.contactPhone}` : ''}
          </Text>
          <Text style={{ color: '#57534e', fontSize: 13 }}>
            {[props.city, props.country].filter(Boolean).join(' · ')}
          </Text>
          {props.tagline && (
            <Text style={{ marginTop: 12, fontWeight: 600 }}>{props.tagline}</Text>
          )}
          <Hr style={{ borderColor: '#e7e2d8', margin: '24px 0' }} />
          <Text style={{ margin: 0, fontWeight: 600 }}>About the business</Text>
          <Text style={{ margin: 0, whiteSpace: 'pre-wrap', color: '#0f172a', fontSize: 14 }}>
            {props.bio}
          </Text>
          {props.categories && (
            <>
              <Hr style={{ borderColor: '#e7e2d8', margin: '24px 0' }} />
              <Text style={{ margin: 0, fontWeight: 600 }}>Product categories</Text>
              <Text style={{ margin: 0, color: '#0f172a', fontSize: 14 }}>{props.categories}</Text>
            </>
          )}
          <Hr style={{ borderColor: '#e7e2d8', margin: '24px 0' }} />
          <Section style={{ marginTop: 16 }}>
            <a
              href={props.adminUrl}
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
              Review in admin
            </a>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}
