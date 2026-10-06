'use client'

import type { ReactNode } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, Skeleton } from '@/components/ui/card'
import { Input } from '@/components/ui/form'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { describeError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useEffect, useState } from 'react'

export interface Column<T> {
  header: string
  cell: (row: T) => ReactNode
  className?: string
}

export function DataTable<T>({
  columns, rows, loading, error, onRetry, rowKey, empty = 'Nothing to show.', skeletonRows = 6,
}: {
  columns: Column<T>[]
  rows: T[] | undefined
  loading: boolean
  error?: unknown
  onRetry?: () => void
  rowKey: (row: T) => string
  empty?: string
  skeletonRows?: number
}) {
  if (error && !rows?.length) {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 px-6 py-14 text-center">
        <AlertTriangle className="size-8 text-danger" aria-hidden />
        <p className="text-sm font-medium">{describeError(error, 'Unable to load this list.')}</p>
        {onRetry && <Button variant="outline" size="sm" onClick={onRetry}><RefreshCw /> Try again</Button>}
      </div>
    )
  }
  return (
    <Table aria-busy={loading}>
      <THead>
        <TR className="hover:bg-transparent">{columns.map((c) => <TH key={c.header} className={c.className}>{c.header}</TH>)}</TR>
      </THead>
      <TBody>
        {!rows && loading
          ? Array.from({ length: skeletonRows }, (_, i) => (
              <TR key={i} className="hover:bg-transparent">{columns.map((c) => <TD key={c.header}><Skeleton className="h-4 w-4/5" /></TD>)}</TR>
            ))
          : rows?.map((r) => (
              <TR key={rowKey(r)} className={cn(loading && 'opacity-60')}>
                {columns.map((c) => <TD key={c.header} className={c.className}>{c.cell(r)}</TD>)}
              </TR>
            ))}
      </TBody>
      {rows && rows.length === 0 && !loading && (
        <caption className="px-6 py-14 text-center">
          <Inbox className="mx-auto mb-2 size-8 text-muted-foreground" aria-hidden />
          <span className="text-sm text-muted-foreground">{empty}</span>
        </caption>
      )}
    </Table>
  )
}

export function Pagination({ total, limit, offset, onChange, loading }: { total: number; limit: number; offset: number; onChange: (offset: number) => void; loading?: boolean }) {
  const from = total === 0 ? 0 : offset + 1
  const to = Math.min(offset + limit, total)
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t px-4 py-3 text-sm">
      <p className="text-muted-foreground" aria-live="polite">{total === 0 ? 'No results' : `${from}–${to} of ${total.toLocaleString('en-GB')}`}</p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={offset <= 0 || loading} onClick={() => onChange(Math.max(0, offset - limit))}><ChevronLeft /> Previous</Button>
        <Button variant="outline" size="sm" disabled={offset + limit >= total || loading} onClick={() => onChange(offset + limit)}>Next <ChevronRight /></Button>
      </div>
    </nav>
  )
}

/** debounced search box: the server does the searching */
export function SearchBox({ value, onChange, placeholder = 'Search…', label = 'Search' }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string }) {
  const [text, setText] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => { if (text !== value) onChange(text) }, 350)
    return () => window.clearTimeout(t)
  }, [text, value, onChange])
  return (
    <div className="relative w-full sm:w-72">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input type="search" aria-label={label} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} className="pl-9" maxLength={100} />
    </div>
  )
}

export function ListCard({ toolbar, children }: { toolbar?: ReactNode; children: ReactNode }) {
  return (
    <Card className="overflow-hidden">
      {toolbar && <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">{toolbar}</div>}
      {children}
    </Card>
  )
}
