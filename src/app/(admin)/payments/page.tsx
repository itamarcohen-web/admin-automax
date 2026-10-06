'use client'

import { PaymentBadge } from '@/components/app/badges'
import { DataTable, ListCard, Pagination, SearchBox } from '@/components/app/data-table'
import { CopyText, PageHeader, usePaged } from '@/components/app/page'
import { Badge } from '@/components/ui/card'
import { Select } from '@/components/ui/form'
import { fmtDateTime, fmtMoney } from '@/lib/format'
import type { Page, PaymentRow } from '@/lib/types'
import { useApi } from '@/lib/use-api'

type PaymentsPage = Page<PaymentRow> & { paid_total_cents: number }

export default function PaymentsPage() {
  const { params, filters, set, offset, setOffset, limit } = usePaged({ search: '', status: '', provider: '', archived: '' })
  const query = { ...params, archived: filters.archived === '1' }
  const { data, error, loading, reload } = useApi<PaymentsPage>('GET_PAYMENTS', query)

  return (
    <>
      <PageHeader title="Payments" description="Read-only financial history. Payments cannot be edited or deleted from this console." />
      <ListCard toolbar={
        <>
          <SearchBox value={filters.search} onChange={(v) => set({ search: v })} placeholder="E-mail, user ID or payment ID" label="Search payments" />
          <Select aria-label="Status" className="w-40" value={filters.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">Any status</option>
            <option value="paid">Paid</option>
            <option value="failed">Failed</option>
            <option value="refunded">Refunded</option>
          </Select>
          <Select aria-label="Source" className="w-52" value={filters.archived} onChange={(e) => set({ archived: e.target.value })}>
            <option value="">Current accounts</option>
            <option value="1">Archive (deleted accounts)</option>
          </Select>
          {data && <p className="ml-auto text-sm text-muted-foreground" aria-live="polite">Paid in this view: <strong className="tabular-nums text-foreground">{fmtMoney(data.paid_total_cents)}</strong></p>}
        </>
      }>
        <DataTable<PaymentRow>
          rows={data?.rows} loading={loading} error={error} onRetry={reload} rowKey={(p) => p.id} empty="No payments match these filters."
          columns={[
            { header: 'User', cell: (p) => (p.user_id && !p.archived ? <a href={`/users/${p.user_id}/`} className="block max-w-56 truncate font-medium hover:underline">{p.email ?? p.user_id}</a> : <span className="inline-flex items-center gap-1.5">{p.email ?? 'unknown'} <Badge>deleted</Badge></span>) },
            { header: 'Amount', className: 'tabular-nums', cell: (p) => fmtMoney(p.amount_cents, p.currency) },
            { header: 'Currency', cell: (p) => p.currency },
            { header: 'Status', cell: (p) => <PaymentBadge status={p.status} /> },
            { header: 'Provider', cell: (p) => p.provider },
            { header: 'Provider payment ID', cell: (p) => (p.provider_payment_id ? <CopyText text={p.provider_payment_id} shown={p.provider_payment_id.length > 22 ? p.provider_payment_id.slice(0, 22) + '…' : p.provider_payment_id} /> : <span className="text-muted-foreground">manual</span>) },
            { header: 'Created', cell: (p) => <span className="whitespace-nowrap">{fmtDateTime(p.paid_at ?? p.created_at)}</span> },
          ]}
        />
        <Pagination total={data?.total ?? 0} limit={limit} offset={offset} onChange={setOffset} loading={loading} />
      </ListCard>
    </>
  )
}
