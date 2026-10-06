import * as React from 'react'
import { cn } from '@/lib/utils'

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border bg-card text-card-foreground shadow-sm', className)} {...props} />
}
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 border-b px-5 py-4', className)} {...props} />
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('text-sm font-semibold tracking-tight', className)} {...props} />
}
export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-xs text-muted-foreground', className)} {...props} />
}
export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)} {...props} />
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton h-4 w-full', className)} />
}

const tones = {
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
} as const
export type Tone = keyof typeof tones

export function Badge({ tone = 'neutral', className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', tones[tone], className)}>{children}</span>
}

export function Alert({ tone = 'info', title, children, className }: { tone?: Exclude<Tone, 'neutral'>; title?: string; children?: React.ReactNode; className?: string }) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('rounded-md border px-4 py-3 text-sm', tones[tone], 'border-current/20', className)}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cn(title && 'mt-1', 'text-foreground/90')}>{children}</div>}
    </div>
  )
}
