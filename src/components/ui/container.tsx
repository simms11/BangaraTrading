import * as React from 'react'
import { cn } from '@/lib/utils'

interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  as?: keyof HTMLElementTagNameMap
}

const sizes = {
  sm: 'max-w-3xl',
  md: 'max-w-5xl',
  lg: 'max-w-6xl',
  xl: 'max-w-7xl',
} as const

export function Container({
  className,
  size = 'lg',
  as: Tag = 'div',
  ...props
}: ContainerProps) {
  const Component = Tag as React.ElementType
  return (
    <Component
      className={cn('mx-auto w-full px-6 lg:px-8', sizes[size], className)}
      {...props}
    />
  )
}
