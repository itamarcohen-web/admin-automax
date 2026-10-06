'use client'

import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { ActionDialog } from '@/components/app/action-dialog'
import { TalentBadge } from '@/components/app/badges'
import { DataTable, ListCard, Pagination, SearchBox } from '@/components/app/data-table'
import { PageHeader, usePaged } from '@/components/app/page'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/card'
import { Checkbox, Field, Input, Select } from '@/components/ui/form'
import { callApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { fmtDate } from '@/lib/format'
import { can, type Page, type TalentRow } from '@/lib/types'
import { useApi } from '@/lib/use-api'

export default function TalentPage() {
  const { state } = useAuth()
  const role = state.status === 'ready' ? state.me.role : undefined
  const { params, filters, set, offset, setOffset, limit } = usePaged({ search: '', status: '' })
  const { data, error, loading, reload } = useApi<Page<TalentRow>>('GET_TALENT', params)
  const [grant, setGrant] = useState(false)
  const [revoke, setRevoke] = useState<TalentRow | null>(null)
  const [email, setEmail] = useState('')
  const [months, setMonths] = useState('6')
  const [lifetime, setLifetime] = useState(false)
  const [note, setNote] = useState('')
  const mOk = lifetime || (Number.isInteger(Number(months)) && Number(months) >= 1 && Number(months) <= 120)

  return (
    <>
      <PageHeader title="Talent" description="Free access you grant for a number of months or for life. A grant for an e-mail that is not registered yet waits (pending) until that person signs up and confirms."
        actions={can(role, 'admin') ? <Button onClick={() => { setEmail(''); setNote(''); setLifetime(false); setMonths('6'); setGrant(true) }}><Sparkles /> Grant Talent</Button> : undefined} />
      <ListCard toolbar={
        <>
          <SearchBox value={filters.search} onChange={(v) => set({ search: v })} placeholder="E-mail or note" label="Search talent grants" />
          <Select aria-label="Status" className="w-40" value={filters.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">Any status</option><option value="applied">Applied</option><option value="pending">Pending</option><option value="revoked">Revoked</option>
          </Select>
        </>
      }>
        <DataTable<TalentRow>
          rows={data?.rows} loading={loading} error={error} onRetry={reload} rowKey={(g) => g.id} empty="No talent grants match these filters."
          columns={[
            { header: 'User', cell: (g) => (g.user_id ? <a href={`/users/${g.user_id}/`} className="block max-w-56 truncate font-medium hover:underline">{g.email}</a> : <span className="block max-w-56 truncate">{g.email} <Badge>no account yet</Badge></span>) },
            { header: 'Grant', cell: (g) => <span>{g.is_lifetime ? 'Lifetime' : `${g.months} month(s)`}{g.note && <span className="bidi block max-w-48 truncate text-xs text-muted-foreground">{g.note}</span>}</span> },
            { header: 'Created', cell: (g) => <span className="whitespace-nowrap">{fmtDate(g.created_at)}</span> },
            { header: 'Expires', cell: (g) => <span className="whitespace-nowrap">{g.is_lifetime ? 'never' : g.expires_at ? fmtDate(g.expires_at) : '—'}</span> },
            { header: 'Status', cell: (g) => <TalentBadge status={g.status} /> },
            { header: 'Granted by', cell: (g) => <span className="block max-w-44 truncate">{g.granted_by ?? '—'}</span> },
            { header: 'Actions', cell: (g) => (can(role, 'admin') && g.status !== 'revoked' ? <Button variant="destructive-outline" size="sm" onClick={() => setRevoke(g)}>Revoke</Button> : <span className="text-muted-foreground">—</span>) },
          ]}
        />
        <Pagination total={data?.total ?? 0} limit={limit} offset={offset} onChange={setOffset} loading={loading} />
      </ListCard>

      <ActionDialog open={grant} onOpenChange={setGrant} title="Grant Talent" confirmLabel="Grant" successMessage="Talent access granted." onDone={reload} canSubmit={/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) && mOk}
        description={<>Gives the person the free Talent plan. They create a normal AutoMax account with this e-mail and confirm it; if the account already exists the grant applies at once.</>}
        onSubmit={() => callApi('GRANT_TALENT', { email: email.trim(), months: lifetime ? undefined : Number(months), lifetime, note: note.trim() || undefined })}>
        <Field label="E-mail" htmlFor="t-email"><Input id="t-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} autoComplete="off" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Months (1–120)" htmlFor="t-months"><Input id="t-months" type="number" min={1} max={120} value={months} onChange={(e) => setMonths(e.target.value)} disabled={lifetime} /></Field>
          <div className="flex items-end pb-1.5"><Checkbox id="t-life" checked={lifetime} onChange={setLifetime} label="Lifetime" /></div>
        </div>
        <Field label="Note (optional)" htmlFor="t-note"><Input id="t-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className="bidi" /></Field>
      </ActionDialog>

      <ActionDialog open={!!revoke} onOpenChange={(o) => { if (!o) setRevoke(null) }} title="Revoke Talent" confirmLabel="Revoke" destructive successMessage="Talent access revoked." onDone={reload}
        description={<>Ends the free Talent access of <strong>{revoke?.email}</strong>. A running Talent subscription is canceled right away; a pending grant will never apply.</>}
        onSubmit={() => callApi('REVOKE_TALENT', { email: revoke!.email })} />
    </>
  )
}
