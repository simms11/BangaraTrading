import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getCurrentUser } from '@/lib/auth'
import { listVendorProducts } from '@/lib/queries/vendor-dashboard'
import { formatPrice } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Your products',
  robots: { index: false, follow: false },
}

const statusVariant: Record<string, 'default' | 'accent' | 'spice'> = {
  draft: 'default',
  pending: 'accent',
  published: 'default',
  archived: 'spice',
}

export default async function VendorProductsPage() {
  const user = await getCurrentUser()
  if (!user?.vendor) redirect('/sign-in?next=/vendor/products')
  const vendorId =
    typeof user.vendor === 'object'
      ? (user.vendor as { id: number | string }).id
      : (user.vendor as number | string)
  const products = await listVendorProducts(vendorId)

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Products</h1>
        <Button asChild variant="primary" size="sm">
          <Link href="/admin/collections/products/create">Add a product</Link>
        </Button>
      </header>

      {products.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-white p-10 text-center">
          <p className="text-muted-foreground">No products yet.</p>
          <Button asChild variant="primary" className="mt-4">
            <Link href="/admin/collections/products/create">Create your first product</Link>
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3" scope="col">Product</th>
                <th className="px-4 py-3" scope="col">Status</th>
                <th className="px-4 py-3" scope="col">Mode</th>
                <th className="px-4 py-3 text-right" scope="col">Price</th>
                <th className="px-4 py-3 text-right" scope="col">Stock</th>
                <th className="px-4 py-3 text-right" scope="col">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {(products as any[]).map((p) => (
                <tr key={p.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <Link href={`/products/${p.slug}`} className="font-medium hover:text-brand-700">
                      {p.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">{p.sku ?? '—'}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={statusVariant[p.status] ?? 'default'}>{p.status}</Badge>
                  </td>
                  <td className="px-4 py-3 capitalize text-muted-foreground">
                    {p.fulfillmentMode}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatPrice(p.priceMinor, p.currency)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {p.inventory?.trackQuantity ? p.inventory?.quantity ?? 0 : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button asChild variant="link" size="sm">
                      <a href={`/admin/collections/products/${p.id}`}>Edit</a>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
