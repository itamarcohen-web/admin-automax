'use client'

import { useState } from 'react'
import { FilePlus2 } from 'lucide-react'
import { ActionDialog } from '@/components/app/action-dialog'
import { DataTable, ListCard } from '@/components/app/data-table'
import { CopyText, PageHeader } from '@/components/app/page'
import { Button } from '@/components/ui/button'
import { Alert, Badge } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/form'
import { callApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { fmtDateTime } from '@/lib/format'
import { can, type LegalRow } from '@/lib/types'
import { useApi } from '@/lib/use-api'

const SHA = /^[0-9a-fA-F]{64}$/

export default function LegalPage() {
  const { state } = useAuth()
  const role = state.status === 'ready' ? state.me.role : undefined
  const isSuper = can(role, 'super_admin')
  const { data, error, loading, reload } = useApi<LegalRow[]>('GET_LEGAL')
  const [publish, setPublish] = useState(false)
  const [setCurrent, setSetCurrent] = useState<LegalRow | null>(null)
  const [unpub, setUnpub] = useState<LegalRow | null>(null)
  const [form, setForm] = useState({ version: '', sha: '', title: '' })
  const current = data?.find((d) => d.is_current)

  return (
    <>
      <PageHeader title="Legal documents" description="Terms of Use and Privacy Policy versions. The text itself lives inside the program; the server tracks its version and SHA-256 and asks every user to accept the current one."
        actions={isSuper ? <Button onClick={() => { setForm({ version: '', sha: '', title: '' }); setPublish(true) }}><FilePlus2 /> Publish document</Button> : undefined} />
      {data && !current && <Alert tone="warning" title="No document is currently published" className="mb-4">Users are not asked to accept any terms right now.</Alert>}
      {!isSuper && <Alert tone="info" className="mb-4">Legal documents can be changed by a super admin only. History is never deleted.</Alert>}
      <ListCard>
        <DataTable<LegalRow>
          rows={data ?? undefined} loading={loading} error={error} onRetry={reload} rowKey={(d) => d.sha256} empty="No legal document has been registered yet."
          columns={[
            { header: 'Document', cell: (d) => <span className="bidi font-medium">{d.title ?? 'Terms of Use and Privacy Policy'}</span> },
            { header: 'Version', cell: (d) => <span className="tabular-nums">{d.version}</span> },
            { header: 'SHA-256', cell: (d) => <CopyText text={d.sha256} shown={d.sha256.slice(0, 14) + '…'} /> },
            { header: 'Published', cell: (d) => (d.is_current ? <Badge tone="success">current</Badge> : <Badge>not current</Badge>) },
            { header: 'Accepted by', className: 'tabular-nums', cell: (d) => d.acceptances.toLocaleString('en-GB') },
            { header: 'Created', cell: (d) => <span className="whitespace-nowrap">{fmtDateTime(d.published_at)}</span> },
            { header: 'Actions', cell: (d) => (isSuper ? (d.is_current
              ? <Button variant="destructive-outline" size="sm" onClick={() => setUnpub(d)}>Unpublish</Button>
              : <Button variant="outline" size="sm" onClick={() => setSetCurrent(d)}>Publish</Button>) : <span className="text-muted-foreground">—</span>) },
          ]}
        />
      </ListCard>

      <ActionDialog open={publish} onOpenChange={setPublish} title="Publish a legal document" confirmLabel="Publish" successMessage="Document published." onDone={reload} canSubmit={!!form.version.trim() && SHA.test(form.sha.trim())}
        description={<>Registers the document as <strong>current</strong>. <strong>Every user will be asked to accept it again</strong> at their next sign-in and cannot use the software until they do. Get the version and SHA-256 from <code>legal/build_legal.py</code> (<code>legal.json</code>).</>}
        onSubmit={() => callApi('PUBLISH_LEGAL', { version: form.version.trim(), sha256: form.sha.trim(), title: form.title.trim() || undefined })}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Version" htmlFor="l-version"><Input id="l-version" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} maxLength={20} placeholder="1.0" /></Field>
          <Field label="Title (optional)" htmlFor="l-title"><Input id="l-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={200} className="bidi" /></Field>
        </div>
        <Field label="SHA-256 of the exact text" htmlFor="l-sha"><Input id="l-sha" value={form.sha} onChange={(e) => setForm({ ...form, sha: e.target.value })} maxLength={64} className="font-mono" /></Field>
      </ActionDialog>

      <ActionDialog open={!!setCurrent} onOpenChange={(o) => { if (!o) setSetCurrent(null) }} title={`Publish version ${setCurrent?.version}`} confirmLabel="Publish" successMessage="Document published." onDone={reload}
        description={<>Makes version <strong>{setCurrent?.version}</strong> the current document. Users who have not accepted exactly this text will be asked to accept it.</>}
        onSubmit={() => callApi('PUBLISH_LEGAL', { version: setCurrent!.version, sha256: setCurrent!.sha256, title: setCurrent!.title ?? undefined })} />

      <ActionDialog open={!!unpub} onOpenChange={(o) => { if (!o) setUnpub(null) }} title="Unpublish the current document" confirmLabel="Unpublish" destructive typed="UNPUBLISH" successMessage="Document unpublished." onDone={reload}
        description={<>
          <p>Version <strong>{unpub?.version}</strong> stops being the current document. <strong>Until another document is published, no user is asked to accept any terms.</strong></p>
          <p className="mt-2">The document and all {unpub?.acceptances.toLocaleString('en-GB')} recorded acceptances are kept as evidence.</p>
        </>}
        onSubmit={() => callApi('UNPUBLISH_LEGAL', { sha256: unpub!.sha256, confirm: 'UNPUBLISH' })} />
    </>
  )
}
