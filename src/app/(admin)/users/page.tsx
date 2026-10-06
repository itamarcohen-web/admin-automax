'use client'

import Link from 'next/link'
import { Plus } from 'lucide-react'
import { SubscriptionBadge } from '@/components/app/badges'
import { DataTable, ListCard, Pagination, SearchBox } from '@/components/app/data-table'
import { PageHeader, usePaged } from '@/components/app/page'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/card'
import { Select } from '@/components/ui/form'
import { useAuth } from '@/lib/auth'
import { fmtDate } from '@/lib/format'
import { can, type Page, type Plan, type UserRow } from '@/lib/types'
import { useApi } from '@/lib/use-api'

export default function UsersPage() {
  const { state } = useAuth()
  const role = state.status === 'ready' ? state.me.role : undefined
  const { params, filters, set, offset, setOffset, limit } = usePaged({ search: '', plan: '', status: '', sort: 'created_at', dir: 'desc' })
  const { data, error, loading, reload } = useApi<Page<UserRow>>('GET_USERS', params)
  const { data: plans } = useApi<Plan[]>('GET_PLANS')

  return (
    <>
      <PageHeader title="Users" description="Search, filter and manage every AutoMax account."
        actions={can(role, 'admin') ? <Button asChild><Link href="/users/new/"><Plus /> New user</Link></Button> : undefined} />
      <ListCard toolbar={
        <>
          <SearchBox value={filters.search} onChange={(v) => set({ search: v })} placeholder="E-mail, name or user ID" label="Search users" />
          <Select aria-label="Plan" className="w-40" value={filters.plan} onChange={(e) => set({ plan: e.target.value })}>
            <option value="">All plans</option>
            {plans?.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
          </Select>
          <Select aria-label="Status" className="w-44" value={filters.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">Any status</option>
            <option value="valid">Valid licence</option>
            <option value="active">Active</option>
            <option value="trialing">Trialing</option>
            <option value="past_due">Past due</option>
            <option value="canceled">Canceled</option>
            <option value="expired">Expired</option>
            <option value="none">No subscription</option>
            <option value="disabled">Disabled accounts</option>
          </Select>
          <Select aria-label="Sort" className="ml-auto w-44" value={`${filters.sort}:${filters.dir}`} onChange={(e) => { const [sort, dir] = e.target.value.split(':'); set({ sort, dir }) }}>
            <option value="created_at:desc">Newest first</option>
            <option value="created_at:asc">Oldest first</option>
            <option value="email:asc">E-mail A–Z</option>
            <option value="last_sign_in:desc">Last sign-in</option>
            <option value="devices:desc">Most devices</option>
          </Select>
        </>
      }>
        <DataTable<UserRow>
          rows={data?.rows} loading={loading} error={error} onRetry={reload} rowKey={(u) => u.id} empty="No users match these filters."
          columns={[
            { header: 'User', cell: (u) => (
              <div className="min-w-0">
                <a href={`/users/${u.id}/`} className="bidi block max-w-56 truncate font-medium hover:underline">{u.full_name || '—'}</a>
                <div className="mt-0.5 flex gap-1">{u.is_admin && <Badge tone="warning">admin</Badge>}{u.is_disabled && <Badge tone="danger">disabled</Badge>}{!u.email_confirmed_at && <Badge>unconfirmed</Badge>}</div>
              </div>
            ) },
            { header: 'Email', cell: (u) => <span className="block max-w-64 truncate">{u.email}</span> },
            { header: 'Plan', cell: (u) => (u.plan_name ? <span>{u.plan_name}{u.is_lifetime && <Badge tone="info" className="ml-1.5">lifetime</Badge>}</span> : <span className="text-muted-foreground">—</span>) },
            { header: 'Status', cell: (u) => <SubscriptionBadge status={u.sub_status} /> },
            { header: 'Devices', className: 'tabular-nums', cell: (u) => u.device_count },
            { header: 'Created', cell: (u) => <span className="whitespace-nowrap">{fmtDate(u.created_at)}</span> },
            { header: 'Actions', cell: (u) => <Button asChild variant="outline" size="sm"><a href={`/users/${u.id}/`} aria-label={`Open ${u.email ?? u.id}`}>Open</a></Button> },
          ]}
        />
        <Pagination total={data?.total ?? 0} limit={limit} offset={offset} onChange={setOffset} loading={loading} />
      </ListCard>
    </>
  )
}
