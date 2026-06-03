import { ImageResponse } from 'next/og'

// m27 (Phase 2): default Open Graph image, auto-discovered by Next 13+
// App Router. Renders a 1200×630 brand panel so social shares of the
// homepage / shop / vendors / pages have preview imagery. Individual
// product / vendor pages can override by colocating their own
// `opengraph-image.tsx` if needed.

export const alt = 'Bangarah Trading — African & Caribbean marketplace'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '80px',
          background:
            'linear-gradient(135deg, #1a2e1a 0%, #2d5a2d 60%, #d4a574 100%)',
          color: '#faf6ef',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: 28,
            letterSpacing: 6,
            textTransform: 'uppercase',
            opacity: 0.8,
          }}
        >
          Bangarah Trading
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {/* Satori requires explicit display:flex on any element with
              more than one child node — a bare text + <br/> + text body
              fails the whole route at prerender. */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              fontSize: 88,
              fontWeight: 700,
              lineHeight: 1.05,
            }}
          >
            <span>African &amp; Caribbean</span>
            <span>marketplace</span>
          </div>
          <div style={{ fontSize: 32, opacity: 0.85, marginTop: 16 }}>
            Premium sauces, honey, supplements &amp; specialty imports.
          </div>
        </div>
        <div style={{ display: 'flex', fontSize: 24, opacity: 0.7 }}>
          bangarahtradingenterprises.com
        </div>
      </div>
    ),
    { ...size },
  )
}
