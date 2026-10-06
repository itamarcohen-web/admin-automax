'use client'

import { useCallback, useEffect, useState } from 'react'
import { KeyRound, ShieldAlert, ShieldCheck } from 'lucide-react'
import { ActionDialog } from '@/components/app/action-dialog'
import { RoleBadge } from '@/components/app/badges'
import { DataTable } from '@/components/app/data-table'
import { CopyText, Dl, PageHeader } from '@/components/app/page'
import { Button } from '@/components/ui/button'
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, Select } from '@/components/ui/form'
import { callApi, UiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { readEnv } from '@/lib/env'
import { fmtDateTime } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { can, type AdminRow, type Me, type Role } from '@/lib/types'
import { useApi } from '@/lib/use-api'

interface Factor { id: string; status: string }
interface Enrollment { factorId: string; qr: string; secret: string }

function MfaCard({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const [factors, setFactors] = useState<Factor[]>([])
  const [enroll, setEnroll] = useState<Enrollment | null>(null)
  const [code, setCode] = useState('')
  const [disable, setDisable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [tick, setTick] = useState(0)
  const load = useCallback(async () => { setTick((t) => t + 1) }, [])
  useEffect(() => {
    let live = true
    void supabase().auth.mfa.listFactors().then(({ data }) => { if (live) setFactors((data?.totp ?? []).map((f) => ({ id: f.id, status: f.status }))) })
    return () => { live = false }
  }, [tick])

  const verified = factors.find((f) => f.status === 'verified')

  const start = async () => {
    setBusy(true); setErr(null)
    try {
      // an abandoned, never-verified enrolment would block a new one: remove those first
      const { data: all } = await supabase().auth.mfa.listFactors()
      for (const f of all?.all ?? []) if (f.factor_type === 'totp' && f.status === 'unverified') await supabase().auth.mfa.unenroll({ factorId: f.id })
      const { data, error } = await supabase().auth.mfa.enroll({ factorType: 'totp', friendlyName: 'AutoMax Admin' })
      if (error || !data) throw new Error()
      setEnroll({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
    } catch { setErr('Could not start the enrolment. Please try again.') }
    setBusy(false)
  }
  const confirm = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!enroll) return
    setBusy(true); setErr(null)
    const { error } = await supabase().auth.mfa.challengeAndVerify({ factorId: enroll.factorId, code: code.replace(/\s+/g, '') })
    setBusy(false)
    if (error) { setErr('That code is not valid. Check the clock on your phone and try the current code.'); return }
    setEnroll(null); setCode('')
    await load(); onChanged()
  }
  const cancel = async () => {
    if (enroll) await supabase().auth.mfa.unenroll({ factorId: enroll.factorId }).catch(() => undefined)
    setEnroll(null); setCode(''); setErr(null)
  }

  return (
    <Card>
      <CardHeader><CardTitle>Two-factor authentication (TOTP)</CardTitle></CardHeader>
      <CardContent className="grid gap-4">
        {verified && !enroll && (
          <>
            <div className="flex items-center gap-2"><ShieldCheck className="size-5 text-success" aria-hidden /><span className="text-sm font-medium">Enabled</span><Badge tone="success">protected</Badge></div>
            <p className="text-sm text-muted-foreground">Every sign-in needs a code from your authenticator app, and the server refuses admin requests from sessions that skipped it.</p>
            <div>
              <Button variant="destructive-outline" size="sm" onClick={() => setDisable(true)} disabled={me.mfa_required} title={me.mfa_required ? 'MFA is required for administrators on this project' : undefined}>Disable two-factor</Button>
              {me.mfa_required && <p className="mt-2 text-xs text-muted-foreground">The project requires MFA for every administrator, so it cannot be turned off here.</p>}
            </div>
          </>
        )}
        {!verified && !enroll && (
          <>
            <div className="flex items-center gap-2"><ShieldAlert className="size-5 text-warning" aria-hidden /><span className="text-sm font-medium">Not enabled</span></div>
            <p className="text-sm text-muted-foreground">Protect this console with a one-time code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…). Strongly recommended for every administrator.</p>
            <div><Button onClick={start} loading={busy}><KeyRound /> Enable two-factor</Button></div>
          </>
        )}
        {enroll && (
          <form onSubmit={confirm} className="grid gap-4 sm:max-w-md" noValidate>
            <p className="text-sm">1. Scan this QR code with your authenticator app (or type the key).</p>
            {/* QR is an SVG data URI generated by Supabase Auth */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={enroll.qr} alt="QR code for your authenticator app" width={176} height={176} className="rounded-md bg-white p-2" />
            <p className="text-xs text-muted-foreground">Key: <CopyText text={enroll.secret} shown={enroll.secret.replace(/(.{4})/g, '$1 ').trim()} /></p>
            <Field label="2. Enter the 6-digit code" htmlFor="mfa-code" error={err}>
              <Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} aria-invalid={!!err} />
            </Field>
            <div className="flex gap-2"><Button type="submit" loading={busy} disabled={code.replace(/\s/g, '').length < 6}>Verify and enable</Button><Button variant="outline" onClick={() => void cancel()}>Cancel</Button></div>
          </form>
        )}
        {err && !enroll && <p role="alert" className="text-sm text-danger">{err}</p>}
      </CardContent>
      <ActionDialog open={disable} onOpenChange={setDisable} title="Disable two-factor authentication" confirmLabel="Disable" destructive typed="DISABLE MFA" successMessage="Two-factor authentication disabled." onDone={() => { void load(); onChanged() }}
        description={<>Your account will be protected by the password alone. This is allowed only from a session that already passed the two-factor check.</>}
        onSubmit={async () => {
          const f = verified
          if (!f) return
          const { error } = await supabase().auth.mfa.unenroll({ factorId: f.id })
          if (error) throw new UiError('Could not disable it. Sign out, sign in again with your code, and retry.')
        }} />
    </Card>
  )
}

function AdminsCard({ me }: { me: Me }) {
  const { data, error, loading, reload } = useApi<AdminRow[]>('GET_ADMINS')
  const [add, setAdd] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('admin')
  const [edit, setEdit] = useState<{ row: AdminRow; role: Role; active: boolean } | null>(null)
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between"><CardTitle>Administrators</CardTitle><Button size="sm" onClick={() => { setEmail(''); setRole('admin'); setAdd(true) }}>Add admin</Button></CardHeader>
      <CardContent className="p-0">
        <DataTable<AdminRow>
          rows={data ?? undefined} loading={loading} error={error} onRetry={reload} rowKey={(a) => a.user_id} empty="No administrators."
          columns={[
            { header: 'Admin', cell: (a) => <span className="block max-w-56 truncate font-medium">{a.email}{a.user_id === me.user_id && <Badge className="ml-1.5">you</Badge>}</span> },
            { header: 'Role', cell: (a) => <RoleBadge role={a.role} /> },
            { header: 'Status', cell: (a) => (a.is_active ? <Badge tone="success">active</Badge> : <Badge tone="danger">deactivated</Badge>) },
            { header: 'MFA', cell: (a) => (a.mfa_enrolled === null ? '—' : a.mfa_enrolled ? <Badge tone="success">on</Badge> : <Badge tone="warning">off</Badge>) },
            { header: 'Last sign-in', cell: (a) => <span className="whitespace-nowrap">{fmtDateTime(a.last_sign_in_at)}</span> },
            { header: 'Actions', cell: (a) => (a.user_id === me.user_id ? <span className="text-muted-foreground">—</span> : <Button variant="outline" size="sm" onClick={() => setEdit({ row: a, role: a.role, active: a.is_active })}>Change</Button>) },
          ]}
        />
      </CardContent>

      <ActionDialog open={add} onOpenChange={setAdd} title="Add an administrator" confirmLabel="Add admin" successMessage="Administrator added." onDone={reload} canSubmit={/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())}
        description={<>The person must already have a confirmed AutoMax account. They sign in at this console with the same e-mail and password. Ask them to enable two-factor authentication straight away.</>}
        onSubmit={() => callApi('ADD_ADMIN', { email: email.trim(), role })}>
        <Field label="Account e-mail" htmlFor="a-email"><Input id="a-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} autoComplete="off" /></Field>
        <Field label="Role" htmlFor="a-role" hint="support: read + devices + registrations · admin: operations · super_admin: everything incl. releases, legal, deletions, admins">
          <Select id="a-role" value={role} onChange={(e) => setRole(e.target.value as Role)}><option value="support">support</option><option value="admin">admin</option><option value="super_admin">super_admin</option></Select>
        </Field>
      </ActionDialog>

      <ActionDialog open={!!edit} onOpenChange={(o) => { if (!o) setEdit(null) }} title="Change administrator" confirmLabel="Save" destructive={edit ? !edit.active : false} successMessage="Administrator updated." onDone={reload}
        description={<>Role and access of <strong>{edit?.row.email}</strong>. A deactivated admin is refused immediately by the server. There is always at least one active super admin.</>}
        onSubmit={() => callApi('SET_ADMIN', { user_id: edit!.row.user_id, role: edit!.role, active: edit!.active })}>
        {edit && (
          <>
            <Field label="Role" htmlFor="e-role"><Select id="e-role" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value as Role })}><option value="support">support</option><option value="admin">admin</option><option value="super_admin">super_admin</option></Select></Field>
            <Field label="Access" htmlFor="e-active"><Select id="e-active" value={edit.active ? '1' : '0'} onChange={(e) => setEdit({ ...edit, active: e.target.value === '1' })}><option value="1">Active</option><option value="0">Deactivated</option></Select></Field>
          </>
        )}
      </ActionDialog>
    </Card>
  )
}

export default function SettingsPage() {
  const { state, refreshMe } = useAuth()
  const [expires, setExpires] = useState<string | null>(null)
  useEffect(() => { void supabase().auth.getSession().then(({ data }) => setExpires(data.session?.expires_at ? new Date(data.session.expires_at * 1000).toISOString() : null)) }, [])
  if (state.status !== 'ready') return null
  const me = state.me
  const env = readEnv()
  const idle = 'error' in env ? 30 : env.idleMinutes

  return (
    <>
      <PageHeader title="Settings" description="Your account and security. Nothing here can lower the protection of the console in one click." />
      {me.mfa_required && !me.mfa_enrolled && <Alert tone="warning" title="Two-factor authentication is required" className="mb-6">Enable it below to continue using the console.</Alert>}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Current admin</CardTitle></CardHeader>
          <CardContent><Dl items={[['Email', me.email], ['Role', <RoleBadge key="r" role={me.role} />], ['User ID', <CopyText key="i" text={me.user_id} />], ['Two-factor', me.mfa_enrolled ? 'Enabled' : 'Not enabled']]} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Session & security</CardTitle></CardHeader>
          <CardContent><Dl items={[
            ['Access token refreshes', expires ? fmtDateTime(expires) : '—'], ['Auto sign-out after', `${idle} minutes without activity`],
            ['Authorization', 'Checked by the server on every request (admin list, role, MFA)'], ['Secrets in this browser', 'None: only the public key'],
            ['Every action', 'Recorded in the audit log'], ['Password changes', 'Use “Forgot password” in the AutoMax sign-in'],
          ]} /></CardContent>
        </Card>
        <MfaCard me={me} onChanged={() => void refreshMe()} />
        {can(me.role, 'super_admin') && <AdminsCard me={me} />}
      </div>
    </>
  )
}
