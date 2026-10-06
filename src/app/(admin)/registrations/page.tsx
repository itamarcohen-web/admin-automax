'use client'

import { useState } from 'react'
import { Eye } from 'lucide-react'
import { ActionDialog } from '@/components/app/action-dialog'
import { RegistrationBadge } from '@/components/app/badges'
import { DataTable, ListCard, Pagination, SearchBox } from '@/components/app/data-table'
import { Dl, PageHeader, usePaged } from '@/components/app/page'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, Select, Textarea } from '@/components/ui/form'
import { callApi } from '@/lib/api'
import { fmtDateTime, fullName } from '@/lib/format'
import type { Page, RegistrationRow } from '@/lib/types'
import { useApi } from '@/lib/use-api'

const STATUSES = [
  ['new', 'New (pending)'], ['contacted', 'Contacted'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['spam', 'Spam'],
] as const

export default function RegistrationsPage() {
  const { params, filters, set, offset, setOffset, limit } = usePaged({ search: '', status: '' })
  const { data, error, loading, reload } = useApi<Page<RegistrationRow>>('GET_REGISTRATIONS', params)
  const [view, setView] = useState<RegistrationRow | null>(null)
  const [edit, setEdit] = useState<{ row: RegistrationRow; status: string } | null>(null)
  const [notes, setNotes] = useState('')

  const startEdit = (row: RegistrationRow, status: string) => { setNotes(row.admin_notes ?? ''); setEdit({ row, status }) }

  return (
    <>
      <PageHeader title="Registrations" description="Customer sign-up requests from the AutoMax app. After approving, create the account and grant a plan." />
      <ListCard toolbar={
        <>
          <SearchBox value={filters.search} onChange={(v) => set({ search: v })} placeholder="Name, business, e-mail or phone" label="Search registrations" />
          <Select aria-label="Status" className="w-44" value={filters.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">Any status</option>
            {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </>
      }>
        <DataTable<RegistrationRow>
          rows={data?.rows} loading={loading} error={error} onRetry={reload} rowKey={(r) => r.id} empty="No registrations match these filters."
          columns={[
            { header: 'Name', cell: (r) => <div className="min-w-0"><p className="bidi max-w-56 truncate font-medium">{fullName(r.first_name, r.last_name, r.business_name)}</p><Badge className="mt-0.5">{r.customer_type}</Badge></div> },
            { header: 'Email', cell: (r) => <span className="block max-w-56 truncate">{r.email}{r.has_account && <Badge tone="success" className="ml-1.5">has account</Badge>}</span> },
            { header: 'Status', cell: (r) => <RegistrationBadge status={r.status} /> },
            { header: 'Created', cell: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.created_at)}</span> },
            { header: 'Actions', cell: (r) => (
              <div className="flex flex-wrap gap-1.5">
                <Button variant="outline" size="sm" onClick={() => setView(r)} aria-label={`Details of ${r.email}`}><Eye /> Details</Button>
                {r.status !== 'approved' && <Button variant="outline" size="sm" onClick={() => startEdit(r, 'approved')}>Approve</Button>}
                {r.status !== 'rejected' && <Button variant="destructive-outline" size="sm" onClick={() => startEdit(r, 'rejected')}>Reject</Button>}
                {r.status !== 'new' && <Button variant="ghost" size="sm" onClick={() => startEdit(r, 'new')}>Mark Pending</Button>}
                <Select aria-label={`More statuses for ${r.email}`} className="h-8 w-28 text-xs" value="" onChange={(e) => { if (e.target.value) startEdit(r, e.target.value) }}>
                  <option value="">More…</option>
                  {STATUSES.filter(([v]) => !['approved', 'rejected', 'new', r.status].includes(v)).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </div>
            ) },
          ]}
        />
        <Pagination total={data?.total ?? 0} limit={limit} offset={offset} onChange={setOffset} loading={loading} />
      </ListCard>

      <Dialog open={!!view} onOpenChange={(o) => { if (!o) setView(null) }}>
        <DialogContent wide>
          {view && (
            <>
              <DialogHeader><DialogTitle className="bidi">{fullName(view.first_name, view.last_name, view.business_name)}</DialogTitle><DialogDescription>{view.customer_type === 'business' ? 'Business registration' : 'Private customer'} · {fmtDateTime(view.created_at)}</DialogDescription></DialogHeader>
              <Dl items={[
                ['Email', view.email], ['Phone', <bdi key="p">{view.phone_e164}</bdi>],
                ...(view.customer_type === 'business' ? ([['Business name', <span key="b" className="bidi">{view.business_name}</span>], ['Company number', view.company_number]] as [string, React.ReactNode][]) : []),
                ['Country', `${view.country_name ?? ''} (${view.country_code})`], ['City', <span key="c" className="bidi">{view.city}</span>],
                ['Address', <span key="a" className="bidi">{view.street} {view.house_number}{view.apartment ? `, ${view.apartment}` : ''}{view.postal_code ? ` · ${view.postal_code}` : ''}</span>],
                ['App language / version', `${view.language ?? '—'} / ${view.app_version ?? '—'}`], ['Notification e-mail', view.mail_sent ? 'sent' : 'not confirmed'],
                ['Notes', <span key="n" className="bidi">{view.admin_notes ?? '—'}</span>], ['Account', view.has_account ? 'An account with this e-mail exists' : 'No account yet'],
              ]} />
            </>
          )}
        </DialogContent>
      </Dialog>

      <ActionDialog open={!!edit} onOpenChange={(o) => { if (!o) setEdit(null) }} title="Change registration status" confirmLabel={`Set “${edit?.status}”`} destructive={edit?.status === 'rejected' || edit?.status === 'spam'} successMessage="Status updated." onDone={reload}
        description={<>Marks the registration of <strong>{edit?.row.email}</strong> as <strong>{edit?.status}</strong>. This does not create an account or contact the customer.</>}
        onSubmit={() => callApi('SET_REGISTRATION_STATUS', { id: edit!.row.id, status: edit!.status, notes: notes.trim() || undefined })}>
        <Field label="Notes (optional)" htmlFor="reg-notes"><Textarea id="reg-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} className="bidi" /></Field>
      </ActionDialog>
    </>
  )
}
