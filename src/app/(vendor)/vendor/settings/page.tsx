import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardTitle } from '@/components/ui/card'
import { getCurrentUser } from '@/lib/auth'
import { getVendorById } from '@/lib/queries/vendor-dashboard'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Vendor settings',
  robots: { index: false, follow: false },
}

export default async function VendorSettingsPage() {
  const user = await getCurrentUser()
  if (!user?.vendor) redirect('/sign-in?next=/vendor/settings')
  const vendorId =
    typeof user.vendor === 'object'
      ? (user.vendor as { id: number | string }).id
      : (user.vendor as number | string)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v: any = await getVendorById(vendorId)

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Storefront profile and payout details. Updates go through admin so we can verify
          changes — click below to open the editor.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-3 pt-6">
            <CardTitle>Storefront profile</CardTitle>
            <dl className="space-y-2 text-sm">
              <Row label="Business name" value={v?.name} />
              <Row label="Slug" value={v?.slug ? `/vendors/${v.slug}` : '—'} />
              <Row label="Tagline" value={v?.tagline ?? '—'} />
              <Row
                label="Location"
                value={[v?.city, v?.country].filter(Boolean).join(' · ') || '—'}
              />
              <Row label="Status" value={<Badge>{v?.status ?? 'unknown'}</Badge>} />
            </dl>
            <Button asChild variant="primary" size="sm">
              <Link href={`/admin/collections/vendors/${vendorId}`}>Edit profile in admin</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 pt-6">
            <CardTitle>Payout details</CardTitle>
            <p className="text-sm text-muted-foreground">
              For your security, bank details are read/written only via admin. Bangarah verifies
              every change.
            </p>
            <dl className="space-y-2 text-sm">
              <Row label="Method" value={v?.payout?.method ?? '—'} />
              <Row label="Bank" value={v?.payout?.bankName ?? '—'} />
              <Row label="Account holder" value={v?.payout?.accountHolder ?? '—'} />
              <Row
                label="Account number"
                value={
                  v?.payout?.accountNumber
                    ? `••• ${String(v.payout.accountNumber).slice(-4)}`
                    : '—'
                }
              />
            </dl>
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin/collections/vendors/${vendorId}`}>Update payout details</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <CardTitle>Commission</CardTitle>
          <p className="text-sm text-muted-foreground">
            Platform commission applied to your sales is{' '}
            <strong className="text-foreground">{v?.commissionRate ?? 10}%</strong> of gross. This
            is set per-vendor by Bangarah operations. If you have a contracted rate, contact us.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  )
}
