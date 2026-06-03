'use client'

import * as React from 'react'
import Image from 'next/image'
import { cn } from '@/lib/utils'

type GalleryImage = {
  url: string
  alt: string
}

export function ProductGallery({ images, title }: { images: GalleryImage[]; title: string }) {
  const [active, setActive] = React.useState(0)
  const hasImages = images.length > 0

  if (!hasImages) {
    return (
      <div className="aspect-square w-full rounded-2xl bg-gradient-to-br from-brand-50 to-accent-50">
        <div className="flex h-full items-center justify-center font-display text-6xl text-brand-300">
          {title.charAt(0)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-muted">
        <Image
          src={images[active].url}
          alt={images[active].alt}
          fill
          sizes="(min-width: 1024px) 600px, 100vw"
          className="object-cover"
          priority
        />
      </div>
      {images.length > 1 && (
        <ul className="flex gap-2 overflow-x-auto" role="tablist" aria-label="Product images">
          {images.map((img, i) => (
            <li key={`${img.url}-${i}`}>
              <button
                type="button"
                role="tab"
                aria-selected={i === active}
                aria-label={`View image ${i + 1}`}
                onClick={() => setActive(i)}
                className={cn(
                  'relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border-2 transition-all',
                  i === active
                    ? 'border-brand-700 ring-2 ring-brand-200'
                    : 'border-border hover:border-brand-300',
                )}
              >
                <Image src={img.url} alt={img.alt} fill sizes="80px" className="object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
