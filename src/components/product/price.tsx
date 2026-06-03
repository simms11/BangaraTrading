import { formatPrice } from '@/lib/utils'

interface PriceProps {
  amountMinor: number
  currency: string
  compareAtMinor?: number | null
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'text-base',
  md: 'text-xl',
  lg: 'text-3xl',
} as const

export function Price({ amountMinor, currency, compareAtMinor, size = 'md' }: PriceProps) {
  const hasCompare = typeof compareAtMinor === 'number' && compareAtMinor > amountMinor
  return (
    <div className={`flex items-baseline gap-2 ${sizeClasses[size]}`}>
      <span className="font-display font-semibold text-foreground tabular-nums">
        {formatPrice(amountMinor, currency)}
      </span>
      {hasCompare && (
        <span className="text-sm text-muted-foreground line-through tabular-nums">
          {formatPrice(compareAtMinor, currency)}
        </span>
      )}
    </div>
  )
}
