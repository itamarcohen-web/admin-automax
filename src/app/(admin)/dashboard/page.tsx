'use client'

import Link from 'next/link'
import { Banknote, CreditCard, HardDrive, Infinity as InfinityIcon, Sparkles, UserCheck, UserPlus, Users } from 'lucide-react'
import { ActionBadge, PaymentBadge, RegistrationBadge } from '@/components/app/badges'
import { PageHeader, StatCard } from '@/components/app/page'
import { Button } from '@/components/ui/button'
import { Alert, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/card'
import { describeError } from '@/lib/api'
import { fmtDateTime, fmtMoney, fmtRelative, fullName } from '@/lib/format'
import type { DashboardData } from '@/lib/types'
import { useApi } from '@/lib/use-api'

function Recent<T>({ title, href, rows, loading, empty, render }: { title: string; href?: string; rows: T[] | null | undefined; loading: boolean; empty: string; render: (r: T) => React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        {href && <Button asChild variant="ghost" size="sm"><Link href={href}>View all</Link></Button>}
      </CardHeader>
      <CardContent className="p-0">
        {loading && !rows ? (
          <div className="space-y-3 p-5">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-5" />)}</div>
        ) : rows && rows.length > 0 ? (
          <ul className="divide-y">{rows.map((r, i) => <li key={i} className="px-5 py-3 text-sm">{render(r)}</li>)}</ul>
        ) : (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">{empty}</p>
        )}
      </CardContent>
    </Card>
  )
}

export default function DashboardPage() {
  const { data, error, loading, reload } = useApi<DashboardData>('GET_DASHBOARD')
  const n = (v: number | undefined) => (v === undefined ? '—' : v.toLocaleString('en-GB'))
  return (
    <>
      <PageHeader title="Dashboard" description="A live overview of AutoMax." actions={<Button variant="outline" size="sm" onClick={reload} loading={loading && !!data}>Refresh</Button>} />
      {error && <Alert tone="danger" title="Unable to load the dashboard" className="mb-6">{describeError(error)} <button className="underline" onClick={reload}>Try again</button></Alert>}

      <section aria-label="Key numbers" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Users" value={n(data?.total_users)} loading={loading && !data} icon={<Users className="size-5" />} hint={data ? `${n(data.disabled_users)} disabled` : undefined} />
        <StatCard label="Active Users" value={n(data?.active_users_30d)} loading={loading && !data} icon={<UserCheck className="size-5" />} hint="signed in during the last 30 days" />
        <StatCard label="Active Subscriptions" value={n(data?.active_subscriptions)} loading={loading && !data} icon={<CreditCard className="size-5" />} hint="valid licences right now" />
        <StatCard label="Lifetime Users" value={n(data?.lifetime_users)} loading={loading && !data} icon={<InfinityIcon className="size-5" />} />
        <StatCard label="Talent Users" value={n(data?.talent_users)} loading={loading && !data} icon={<Sparkles className="size-5" />} />
        <StatCard label="Registered Devices" value={n(data?.registered_devices)} loading={loading && !data} icon={<HardDrive className="size-5" />} />
        <StatCard label="Payments" value={n(data?.payments_count)} loading={loading && !data} icon={<Banknote className="size-5" />} hint={data ? `${fmtMoney(data.payments_total_cents)} received` : undefined} />
        <StatCard label="Pending Registrations" value={n(data?.pending_registrations)} loading={loading && !data} icon={<UserPlus className="size-5" />} hint="status: new" />
      </section>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2">
        <Recent title="Recent Registrations" href="/registrations/" rows={data?.recent_registrations} loading={loading} empty="No registrations yet."
          render={(r) => (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0"><p className="bidi truncate font-medium">{fullName(r.first_name, r.last_name, r.business_name)}</p><p className="truncate text-xs text-muted-foreground">{r.email} · {fmtRelative(r.created_at)}</p></div>
              <RegistrationBadge status={r.status} />
            </div>
          )} />
        <Recent title="Recent Payments" href="/payments/" rows={data?.recent_payments} loading={loading} empty="No payments yet."
          render={(p) => (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0"><p className="font-medium tabular-nums">{fmtMoney(p.amount_cents, p.currency)}</p><p className="truncate text-xs text-muted-foreground">{p.email ?? 'deleted account'} · {p.provider} · {fmtRelative(p.paid_at)}</p></div>
              <PaymentBadge status={p.status} />
            </div>
          )} />
        <Recent title="Recent Users" href="/users/" rows={data?.recent_users} loading={loading} empty="No users yet."
          render={(u) => (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0"><a href={`/users/${u.id}/`} className="block truncate font-medium hover:underline">{u.email ?? u.id}</a><p className="bidi truncate text-xs text-muted-foreground">{u.full_name ?? '—'}</p></div>
              <span className="whitespace-nowrap text-xs text-muted-foreground" title={fmtDateTime(u.created_at)}>{fmtRelative(u.created_at)}</span>
            </div>
          )} />
        {data?.recent_admin_actions !== null && (
          <Recent title="Recent Admin Actions" href="/audit-log/" rows={data?.recent_admin_actions} loading={loading} empty="No admin actions yet."
            render={(a) => (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0"><ActionBadge action={a.action} /><p className="mt-1 truncate text-xs text-muted-foreground">{a.admin_email ?? 'system'}{a.target_email ? ` → ${a.target_email}` : ''}</p></div>
                <span className="whitespace-nowrap text-xs text-muted-foreground" title={fmtDateTime(a.created_at)}>{fmtRelative(a.created_at)}</span>
              </div>
            )} />
        )}
      </div>
    </>
  )
}
