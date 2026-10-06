'use client'

import { useState, useSyncExternalStore, type ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft, Ban, CheckCircle2, KeyRound, Mail, Pencil, Trash2, UserX } from 'lucide-react'
import { ActionBadge, PaymentBadge, SubscriptionBadge, TalentBadge } from '@/components/app/badges'
import { UserDialogs, type Dlg } from '@/components/app/user-dialogs'
import { CopyText, Dl, PageHeader } from '@/components/app/page'
import { Button } from '@/components/ui/button'
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/card'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { describeError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { fmtDate, fmtDateTime, fmtMoney, isUuid } from '@/lib/format'
import { can, type Plan, type UserDetail } from '@/lib/types'
import { useApi } from '@/lib/use-api'

const noop = () => () => undefined
function idFromLocation(): string {
  const parts = window.location.pathname.split('/').filter(Boolean)
  return parts[0] === 'users' && parts[1] ? parts[1] : ''
}

function Section({ title, description, children, empty }: { title: string; description?: string; children?: ReactNode; empty?: string }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle>{description && <p className="text-xs text-muted-foreground">{description}</p>}</CardHeader>
      <CardContent className={children ? 'p-0' : undefined}>{children ?? <p className="py-4 text-center text-sm text-muted-foreground">{empty}</p>}</CardContent>
    </Card>
  )
}

export function UserDetailView() {
  const id = useSyncExternalStore(noop, idFromLocation, () => '')
  if (!id) return <div className="space-y-3" role="status" aria-label="Loading"><Skeleton className="h-8 w-64" /><Skeleton className="h-40" /></div>
  if (!isUuid(id)) return <Alert tone="danger" title="User not found">That address is not a valid user ID. <Link className="underline" href="/users/">Back to users</Link></Alert>
  return <UserDetailLoader id={id} />
}

function UserDetailLoader({ id }: { id: string }) {
  const { data, error, loading, reload } = useApi<UserDetail>('GET_USER', { user_id: id })
  const { data: plans } = useApi<Plan[]>('GET_PLANS')

  if (error && !data) {
    return (
      <>
        <BackLink />
        <Alert tone="danger" title={error.status === 404 ? 'User not found' : 'Unable to load this user'}>{describeError(error)} <button className="underline" onClick={reload}>Try again</button></Alert>
      </>
    )
  }
  if (!data) return <><BackLink /><div className="space-y-4" role="status" aria-label="Loading user"><Skeleton className="h-9 w-72" /><Skeleton className="h-28" /><Skeleton className="h-48" /></div></>
  return <UserDetailBody d={data} plans={plans ?? []} reload={reload} refreshing={loading} />
}

const BackLink = () => <Link href="/users/" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> All users</Link>

function UserDetailBody({ d, plans, reload, refreshing }: { d: UserDetail; plans: Plan[]; reload: () => void; refreshing: boolean }) {
  const { state } = useAuth()
  const role = state.status === 'ready' ? state.me.role : undefined
  const isSelf = state.status === 'ready' && state.me.user_id === d.account.id
  const [dlg, setDlg] = useState<Dlg>(null)
  const close = (o: boolean) => { if (!o) setDlg(null) }

  const sub = d.subscriptions.find((s) => s.is_valid) ?? d.subscriptions[0]
  const disabled = d.profile?.is_disabled || (d.account.banned_until !== null && new Date(d.account.banned_until) > new Date())
  const canCancel = !!sub && ['active', 'trialing', 'past_due'].includes(sub.status)
  const canReactivate = !!sub && (sub.cancel_at_period_end || (['canceled', 'expired', 'past_due'].includes(sub.status) && (sub.is_lifetime || new Date(sub.current_period_end) > new Date())))
  const activeTalent = d.talent_grants.some((g) => g.status !== 'revoked')
  const protectedAccount = d.is_admin || isSelf
  const email = d.account.email ?? ''

  return (
    <>
      <BackLink />
      <PageHeader title={d.profile?.full_name || email || 'User'} description={email}
        actions={<Button variant="outline" size="sm" onClick={reload} loading={refreshing}>Refresh</Button>} />

      <div className="mb-6 flex flex-wrap gap-2" aria-label="Account state">
        {disabled ? <Badge tone="danger">Account disabled</Badge> : <Badge tone="success">Account enabled</Badge>}
        {d.is_admin && <Badge tone="warning">Administrator</Badge>}
        {d.account.email_confirmed_at ? <Badge tone="neutral">E-mail confirmed</Badge> : <Badge tone="warning">E-mail not confirmed</Badge>}
        <SubscriptionBadge status={sub?.status} />
        {sub?.is_lifetime && <Badge tone="info">Lifetime</Badge>}
      </div>

      {disabled && d.profile?.disabled_reason && <Alert tone="warning" title="Disabled" className="mb-6">{d.profile.disabled_reason} <span className="text-muted-foreground">({fmtDateTime(d.profile.disabled_at)})</span></Alert>}

      {can(role, 'support') && (
        <Card className="mb-6">
          <CardHeader><CardTitle>Actions</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {can(role, 'admin') && (
              <>
                <Button variant="outline" size="sm" onClick={() => setDlg('name')}><Pencil /> Edit name</Button>
                <Button variant="outline" size="sm" onClick={() => setDlg('plan')} disabled={!sub} title={sub ? undefined : 'No subscription yet: use Extend'}>Change Plan</Button>
                <Button variant="outline" size="sm" onClick={() => setDlg('extend')}>Extend Subscription</Button>
                <Button variant="outline" size="sm" onClick={() => setDlg('lifetime')} disabled={!!sub?.is_lifetime && sub.is_valid}>Grant Lifetime</Button>
                <Button variant="destructive-outline" size="sm" onClick={() => setDlg('cancel')} disabled={!canCancel}>Cancel Subscription</Button>
                <Button variant="outline" size="sm" onClick={() => setDlg('reactivate')} disabled={!canReactivate}>Reactivate Subscription</Button>
                <Button variant="outline" size="sm" onClick={() => setDlg('talent')}>Grant Talent</Button>
                <Button variant="destructive-outline" size="sm" onClick={() => setDlg('revoke')} disabled={!activeTalent}>Revoke Talent</Button>
                {disabled
                  ? <Button variant="outline" size="sm" onClick={() => setDlg('enable')}><CheckCircle2 /> Enable Account</Button>
                  : <Button variant="destructive-outline" size="sm" onClick={() => setDlg('disable')} disabled={protectedAccount} title={protectedAccount ? 'Administrators cannot be disabled here' : undefined}><Ban /> Disable Account</Button>}
                <Button variant="outline" size="sm" onClick={() => setDlg('reset')}><KeyRound /> Reset Password</Button>
                <Button variant="outline" size="sm" onClick={() => setDlg('email')}><Mail /> Change Email</Button>
              </>
            )}
            {can(role, 'super_admin') && (
              <Button variant="destructive" size="sm" className="ml-auto" onClick={() => setDlg('delete')} disabled={protectedAccount} title={protectedAccount ? 'Administrators cannot be deleted here' : undefined}><Trash2 /> Delete Account</Button>
            )}
            {!can(role, 'admin') && <p className="text-sm text-muted-foreground">Your role (support) can remove devices and read this page.</p>}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-2">
        <Section title="Profile">
          <div className="p-5"><Dl items={[
            ['Full name', <span key="n" className="bidi">{d.profile?.full_name ?? '—'}</span>], ['Email', email],
            ['User ID', <CopyText key="i" text={d.account.id} />], ['Created', fmtDateTime(d.account.created_at)],
            ['Last activity', fmtDateTime(d.account.last_sign_in_at)], ['Profile updated', fmtDateTime(d.profile?.updated_at)],
            ...(d.registration ? [['Registration', <span key="r">{d.registration.customer_type} · {d.registration.status} · {d.registration.phone_e164}</span>] as [string, ReactNode]] : []),
          ]} /></div>
        </Section>

        <div className="xl:col-span-2"><Section title="Subscription" empty={d.subscriptions.length ? undefined : 'No subscription.'}>
          {d.subscriptions.length > 0 && (
            <Table>
              <THead><TR className="hover:bg-transparent"><TH>Plan</TH><TH>Status</TH><TH>Period start</TH><TH>Period end</TH><TH>Provider</TH></TR></THead>
              <TBody>
                {d.subscriptions.map((s) => (
                  <TR key={s.id}>
                    <TD><span className="font-medium">{s.plan_name}</span><span className="block text-xs text-muted-foreground">{s.max_devices} device(s){s.is_lifetime ? ' · lifetime' : ''}</span></TD>
                    <TD><SubscriptionBadge status={s.status} />{s.cancel_at_period_end && <Badge tone="warning" className="ml-1">cancels at end</Badge>}</TD>
                    <TD className="whitespace-nowrap">{fmtDate(s.current_period_start)}</TD>
                    <TD className="whitespace-nowrap">{s.is_lifetime ? 'never' : fmtDate(s.current_period_end)}</TD>
                    <TD>{s.provider}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Section></div>

        <Section title="Devices" description={sub ? `${d.devices.length} of ${sub.max_devices} used` : undefined} empty={d.devices.length ? undefined : 'No computers registered.'}>
          {d.devices.length > 0 && (
            <Table>
              <THead><TR className="hover:bg-transparent"><TH>Device</TH><TH>First seen</TH><TH>Last seen</TH><TH><span className="sr-only">Remove</span></TH></TR></THead>
              <TBody>
                {d.devices.map((v) => (
                  <TR key={v.id}>
                    <TD><span className="bidi block max-w-48 truncate font-medium">{v.device_name ?? 'Unnamed'}</span><CopyText text={v.device_id} shown={v.device_id.slice(0, 12) + '…'} /></TD>
                    <TD className="whitespace-nowrap">{fmtDate(v.first_seen)}</TD>
                    <TD className="whitespace-nowrap">{fmtDateTime(v.last_seen)}</TD>
                    <TD><Button variant="destructive-outline" size="sm" onClick={() => setDlg({ device: v.device_id, name: v.device_name })} aria-label={`Remove device ${v.device_name ?? v.device_id.slice(0, 8)}`}><UserX /> Remove</Button></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Section>

        <Section title="Talent" empty={d.talent_grants.length ? undefined : 'No talent grants for this account.'}>
          {d.talent_grants.length > 0 && (
            <Table>
              <THead><TR className="hover:bg-transparent"><TH>Status</TH><TH>Grant</TH><TH>Granted</TH><TH>Granted by</TH></TR></THead>
              <TBody>
                {d.talent_grants.map((g) => (
                  <TR key={g.id}>
                    <TD><TalentBadge status={g.status} /></TD>
                    <TD>{g.is_lifetime ? 'Lifetime' : `${g.months} month(s)`}{g.note && <span className="bidi block max-w-48 truncate text-xs text-muted-foreground">{g.note}</span>}</TD>
                    <TD className="whitespace-nowrap">{fmtDate(g.created_at)}</TD>
                    <TD>{g.granted_by ?? '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Section>

        <div className="xl:col-span-2">
          <Section title="Payments" description="Financial records are read-only." empty={d.payments.length ? undefined : 'No payments.'}>
            {d.payments.length > 0 && (
              <Table>
                <THead><TR className="hover:bg-transparent"><TH>Amount</TH><TH>Status</TH><TH>Provider</TH><TH>Payment ID</TH><TH>Created</TH></TR></THead>
                <TBody>
                  {d.payments.map((p) => (
                    <TR key={p.id}>
                      <TD className="tabular-nums">{fmtMoney(p.amount_cents, p.currency)}</TD><TD><PaymentBadge status={p.status} /></TD><TD>{p.provider}</TD>
                      <TD>{p.provider_payment_id ? <CopyText text={p.provider_payment_id} /> : <span className="text-muted-foreground">manual</span>}</TD>
                      <TD className="whitespace-nowrap">{fmtDateTime(p.paid_at)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Section>
        </div>

        <Section title="Legal acceptances" empty={d.legal_acceptances.length ? undefined : 'No accepted documents yet.'}>
          {d.legal_acceptances.length > 0 && (
            <Table>
              <THead><TR className="hover:bg-transparent"><TH>Version</TH><TH>Context</TH><TH>Accepted</TH></TR></THead>
              <TBody>{d.legal_acceptances.map((a) => <TR key={a.sha256}><TD><span className="font-medium">{a.version}</span><span className="block"><CopyText text={a.sha256} shown={a.sha256.slice(0, 12) + '…'} /></span></TD><TD>{a.context}{a.app_version ? ` · ${a.app_version}` : ''}</TD><TD className="whitespace-nowrap">{fmtDateTime(a.accepted_at)}</TD></TR>)}</TBody>
            </Table>
          )}
        </Section>

        {can(role, 'admin') && (
          <Section title="Audit history" description="Admin actions on this account." empty={d.audit.length ? undefined : 'No admin actions yet.'}>
            {d.audit.length > 0 && (
              <ul className="divide-y">
                {d.audit.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <div className="min-w-0"><ActionBadge action={a.action} /><p className="mt-1 truncate text-xs text-muted-foreground">{a.admin_email ?? 'system'}</p></div>
                    <span className="whitespace-nowrap text-xs text-muted-foreground">{fmtDateTime(a.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}
      </div>

      <UserDialogs dlg={dlg} close={close} userId={d.account.id} email={email} initialName={d.profile?.full_name ?? ''} currentPlan={sub?.plan_code} plans={plans} onDone={reload} />
    </>
  )
}
