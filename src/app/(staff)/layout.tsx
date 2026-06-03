import Link from 'next/link'
import Image from 'next/image'
import { redirect } from 'next/navigation'
import { LayoutDashboard, Receipt, ExternalLink } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth'
import { signOutAction } from '@/lib/auth-actions'
import { Container } from '@/components/ui/container'
import { Button } from '@/components/ui/button'

const nav = [
  { href: '/admin-reports', label: 'Reports', icon: LayoutDashboard },
  { href: '/admin/collections/orders', label: 'Orders', icon: Receipt },
]

/**
 * Layout for admin-only Next.js surfaces (e.g. /admin-reports).
 * The Payload `/admin` SPA has its own chrome and is unrelated.
 */
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect('/sign-in?next=/admin-reports')
  if (user.role !== 'admin') redirect('/')

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-brand-900 focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to main content
      </a>
      <div className="min-h-screen bg-muted/30">
        <header className="bg-brand-950 text-white">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-6 lg:px-8">
            <Link href="/" className="flex items-center gap-3" aria-label="Bangarah home">
              <Image
                src="/logo.png"
                alt=""
                width={40}
                height={40}
                className="h-9 w-9 rounded-md object-contain"
                priority
              />
              <div className="leading-tight">
                <div className="font-display text-base font-semibold">Bangarah Operations</div>
                <div className="text-xs text-brand-200">{user.email}</div>
              </div>
            </Link>
            <div className="flex items-center gap-3">
              <Button asChild variant="ghost" size="sm" className="text-brand-100 hover:bg-white/10 hover:text-white">
                <Link href="/">View storefront</Link>
              </Button>
              <form action={signOutAction}>
                <Button
                  type="submit"
                  variant="ghost"
                  size="sm"
                  className="text-brand-100 hover:bg-white/10 hover:text-white"
                >
                  Sign out
                </Button>
              </form>
            </div>
          </div>
        </header>

        <Container size="xl" className="grid gap-8 py-10 lg:grid-cols-[220px_1fr]">
          <nav aria-label="Operations" className="space-y-1">
            {nav.map((item) => {
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-foreground hover:bg-white hover:text-brand-900"
                >
                  <Icon className="h-4 w-4 text-muted-foreground group-hover:text-brand-700" aria-hidden />
                  {item.label}
                </Link>
              )
            })}
            <Link
              href="/admin"
              className="group mt-4 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-white hover:text-brand-900"
            >
              <ExternalLink className="h-4 w-4" aria-hidden />
              Payload admin
            </Link>
          </nav>
          <main id="main">{children}</main>
        </Container>
      </div>
    </>
  )
}
