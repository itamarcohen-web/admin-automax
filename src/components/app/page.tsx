'use client'

import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Card, CardContent, Skeleton } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Check, Copy } from 'lucide-react'

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function StatCard({ label, value, hint, loading, icon }: { label: string; value: ReactNode; hint?: string; loading?: boolean; icon?: ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          {loading ? <Skeleton className="mt-2 h-8 w-20" /> : <p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p>}
          {hint && !loading && <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>}
        </div>
        {icon && <div className="rounded-md bg-accent p-2 text-muted-foreground" aria-hidden>{icon}</div>}
      </CardContent>
    </Card>
  )
}

/** a value that can be copied (ids, hashes) */
export function CopyText({ text, shown, className }: { text: string; shown?: string; className?: string }) {
  const [done, setDone] = useState(false)
  const copy = useCallback(async () => {
    try { await navigator.clipboard.writeText(text); setDone(true); window.setTimeout(() => setDone(false), 1500) } catch { /* clipboard blocked */ }
  }, [text])
  return (
    <span className={`inline-flex items-center gap-1 ${className ?? ''}`}>
      <code className="break-all font-mono text-xs" title={text}>{shown ?? text}</code>
      <Button variant="ghost" size="icon" className="size-6" onClick={copy} aria-label={done ? 'Copied' : `Copy ${shown ?? text}`}>{done ? <Check className="text-success" /> : <Copy />}</Button>
    </span>
  )
}

export function Dl({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">{k}</dt>
          <dd className="mt-0.5 break-words text-sm">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

/** server-paged list state: filters + offset. Changing a filter returns to the first page. */
export function usePaged(initial: Record<string, string> = {}, limit = 25) {
  const [filters, setFilters] = useState<Record<string, string>>(initial)
  const [offset, setOffset] = useState(0)
  const set = useCallback((patch: Record<string, string>) => { setFilters((f) => ({ ...f, ...patch })); setOffset(0) }, [])
  const params = useMemo(() => {
    const p: Record<string, unknown> = { limit, offset }
    for (const [k, v] of Object.entries(filters)) if (v !== '') p[k] = v
    return p
  }, [filters, limit, offset])
  return { params, filters, set, offset, setOffset, limit }
}
