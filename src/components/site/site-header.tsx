'use client'

import * as React from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Menu, X, ShoppingBag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const nav = [
  { href: '/shop', label: 'Shop' },
  { href: '/about', label: 'About' },
  { href: '/services', label: 'Services' },
  { href: '/vendors', label: 'Vendors' },
  { href: '/contact', label: 'Contact' },
]

export function SiteHeader({
  cartCount = 0,
  isSignedIn = false,
}: {
  cartCount?: number
  isSignedIn?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [scrolled, setScrolled] = React.useState(false)

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-colors',
        scrolled
          ? 'bg-brand-950/95 backdrop-blur shadow-md'
          : 'bg-brand-950',
      )}
    >
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between gap-6 px-6 text-white lg:px-8">
        <Link href="/" className="flex items-center gap-3" aria-label="Bangarah Trading home">
          <Image
            src="/logo.png"
            alt=""
            width={48}
            height={48}
            className="h-10 w-10 rounded-md object-contain"
            priority
          />
          <div className="leading-tight">
            <div className="font-display text-lg font-semibold">Bangarah Trading</div>
            <div className="text-xs text-brand-200">Marketplace · Est. 2011</div>
          </div>
        </Link>

        <nav className="hidden md:flex md:items-center md:gap-8" aria-label="Primary">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm font-medium text-brand-100 transition-colors hover:text-accent-300"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Button asChild variant="ghost" size="sm" className="text-brand-100 hover:bg-white/10 hover:text-white">
            <Link href={isSignedIn ? '/account' : '/sign-in'}>
              {isSignedIn ? 'Account' : 'Sign in'}
            </Link>
          </Button>
          <Button asChild variant="accent" size="sm" className="relative">
            <Link href="/cart" aria-label={`Cart, ${cartCount} item${cartCount === 1 ? '' : 's'}`}>
              <ShoppingBag className="h-4 w-4" aria-hidden />
              <span>Cart</span>
              {cartCount > 0 && (
                <span
                  aria-hidden
                  className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-950 px-1.5 text-xs font-semibold text-white"
                >
                  {cartCount}
                </span>
              )}
            </Link>
          </Button>
        </div>

        <button
          type="button"
          className="rounded-md p-2 text-white hover:bg-white/10 md:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label="Toggle menu"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X className="h-6 w-6" aria-hidden /> : <Menu className="h-6 w-6" aria-hidden />}
        </button>
      </div>

      {open && (
        <div id="mobile-nav" className="border-t border-white/10 bg-brand-900 md:hidden">
          <nav className="space-y-1 px-4 py-3" aria-label="Mobile">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="block rounded-md px-3 py-2 text-base text-brand-100 hover:bg-white/10 hover:text-white"
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-3 flex gap-2 px-3">
              <Button asChild variant="ghost" size="sm" className="flex-1 text-brand-100 hover:bg-white/10 hover:text-white">
                <Link href={isSignedIn ? '/account' : '/sign-in'} onClick={() => setOpen(false)}>
                  {isSignedIn ? 'Account' : 'Sign in'}
                </Link>
              </Button>
              <Button asChild variant="accent" size="sm" className="flex-1">
                <Link href="/cart" onClick={() => setOpen(false)}>
                  Cart{cartCount > 0 ? ` (${cartCount})` : ''}
                </Link>
              </Button>
            </div>
          </nav>
        </div>
      )}
    </header>
  )
}
