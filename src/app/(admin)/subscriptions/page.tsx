'use client'

import { useState } from 'react'
import { SubscriptionBadge } from '@/components/app/badges'
import { DataTable, ListCard, Pagination, SearchBox } from '@/components/app/data-table'
import { PageHeader, usePaged } from '@/components/app/page'
import { UserDialogs, type Dlg } from '@/components/app/user-dialogs'
import { Badge } from '@/components/ui/card'
import { Select } from '@/components/ui/form'
import { useAuth } from '@/lib/auth'
import { fmtDate } from '@/lib/format'
import { can, type Page, type Plan, type SubscriptionRow } from '@/lib/types'
import { useApi } from '@/lib/use-api'

export default function SubscriptionsPage() {
  const { state } = useAuth()
  const role = state.status === 'ready' ? state.me.role : undefined
  const { params, filters, set, offset, setOffset, limit } = usePaged({ search: '', status: '' })
  const { data, error, loading, reload } = useApi<Page<SubscriptionRow>>('GET_SUBSCRIPTIONS', params)
  const { data: plans } = useApi<Plan[]>('GET_PLANS')
  const [target, setTarget] = useState<{ row: SubscriptionRow; dlg: Dlg } | null>(null)

  return (
    <>
      <PageHeader title="Subscriptions" description="Every licence. Changes are applied through the existing licensing functions and logged." />
      <ListCard toolbar={
        <>
          <SearchBox value={filters.search} onChange={(v) => set({ search: v })} placeholder="E-mail or user ID" label="Search subscriptions" />
          <Select aria-label="Status" className="w-44" value={filters.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">Any status</option>
            <option value="valid">Valid right now</option>
            <option value="active">Active</option>
            <option value="trialing">Trialing</option>
            <option value="past_due">Past due</option>
            <option value="canceled">Canceled</option>
            <option value="expired">Expired</option>
          </Select>
        </>
      }>
        <DataTable<SubscriptionRow>
          rows={data?.rows} loading={loading} error={error} onRetry={reload} rowKey={(s) => s.id} empty="No subscriptions match these filters."
          columns={[
            { header: 'User', cell: (s) => <a href={`/users/${s.user_id}/`} className="block max-w-56 truncate font-medium hover:underline">{s.email ?? s.user_id}</a> },
            { header: 'Plan', cell: (s) => s.plan_name },
            { header: 'Status', cell: (s) => <span className="inline-flex items-center gap-1"><SubscriptionBadge status={s.status} />{s.cancel_at_period_end && <Badge tone="warning">ending</Badge>}</span> },
            { header: 'Period start', cell: (s) => <span className="whitespace-nowrap">{fmtDate(s.current_period_start)}</span> },
            { header: 'Period end', cell: (s) => <span className="whitespace-nowrap">{s.is_lifetime ? 'never' : fmtDate(s.current_period_end)}</span> },
            { header: 'Lifetime', cell: (s) => (s.is_lifetime ? <Badge tone="info">yes</Badge> : <span className="text-muted-foreground">no</span>) },
            { header: 'Provider', cell: (s) => s.provider },
            { header: 'Created', cell: (s) => <span className="whitespace-nowrap">{fmtDate(s.created_at)}</span> },
            { header: 'Actions', cell: (s) => can(role, 'admin') ? (
              <Select aria-label={`Actions for ${s.email ?? s.user_id}`} className="w-36" value="" onChange={(e) => { if (e.target.value) setTarget({ row: s, dlg: e.target.value as Dlg }) }}>
                <option value="">Actions…</option>
                <option value="plan">Change plan</option>
                <option value="extend">Extend</option>
                <option value="cancel">Cancel</option>
                <option value="reactivate">Reactivate</option>
                <option value="lifetime">Grant lifetime</option>
              </Select>
            ) : <span className="text-xs text-muted-foreground">read only</span> },
          ]}
        />
        <Pagination total={data?.total ?? 0} limit={limit} offset={offset} onChange={setOffset} loading={loading} />
      </ListCard>
      {target && (
        <UserDialogs dlg={target.dlg} close={(o) => { if (!o) setTarget(null) }} userId={target.row.user_id} email={target.row.email ?? target.row.user_id}
          currentPlan={target.row.plan_code} plans={plans ?? []} onDone={reload} />
      )}
    </>
  )
}
