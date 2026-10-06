'use client'

import { useState } from 'react'
import { Upload } from 'lucide-react'
import { ActionDialog } from '@/components/app/action-dialog'
import { DataTable, ListCard } from '@/components/app/data-table'
import { CopyText, PageHeader } from '@/components/app/page'
import { Button } from '@/components/ui/button'
import { Alert, Badge } from '@/components/ui/card'
import { Checkbox, Field, Input, Textarea } from '@/components/ui/form'
import { callApi, UiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { fmtBytes, fmtDateTime, sha256Hex } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { can, type ReleaseRow } from '@/lib/types'
import { useApi } from '@/lib/use-api'

const SEMVER = /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/
const SHA = /^[0-9a-fA-F]{64}$/
const fileOf = (url: string) => decodeURIComponent(url.split('/').pop() ?? '')

export default function ReleasesPage() {
  const { state } = useAuth()
  const role = state.status === 'ready' ? state.me.role : undefined
  const isSuper = can(role, 'super_admin')
  const { data, error, loading, reload } = useApi<ReleaseRow[]>('GET_RELEASES')
  const [create, setCreate] = useState<'upload' | 'register' | null>(null)
  const [unpub, setUnpub] = useState<ReleaseRow | null>(null)
  const [repub, setRepub] = useState<ReleaseRow | null>(null)
  const [form, setForm] = useState({ version: '', notes: '', mandatory: false, sha: '', size: '', replace: false })
  const [file, setFile] = useState<File | null>(null)
  const [step, setStep] = useState('')
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }))
  const reset = (mode: 'upload' | 'register') => { setForm({ version: '', notes: '', mandatory: false, sha: '', size: '', replace: false }); setFile(null); setStep(''); setCreate(mode) }

  const submit = async () => {
    const notes = form.notes.trim() || undefined
    if (create === 'upload') {
      if (!file) throw new UiError('Choose the installer file.')
      setStep('Calculating SHA-256…')
      const sha256 = await sha256Hex(file)
      setStep('Requesting a secure upload…')
      const up = await callApi<{ path: string; token: string }>('CREATE_RELEASE', { version: form.version, size_bytes: file.size, replace: form.replace })
      setStep('Uploading…')
      const { error: upErr } = await supabase().storage.from('releases').uploadToSignedUrl(up.path, up.token, file)
      if (upErr) throw new UiError('The upload failed. Try again.')
      setStep('Publishing…')
      await callApi('PUBLISH_RELEASE', { version: form.version, file_name: up.path, sha256, size_bytes: file.size, notes, mandatory: form.mandatory })
    } else {
      await callApi('PUBLISH_RELEASE', { version: form.version, sha256: form.sha.trim(), size_bytes: Number(form.size), notes, mandatory: form.mandatory })
    }
  }
  const canSubmit = SEMVER.test(form.version) && (create === 'upload' ? !!file : SHA.test(form.sha.trim()) && Number(form.size) > 0)

  return (
    <>
      <PageHeader title="Releases" description="Software updates shipped to every installed copy of AutoMax Models. A mandatory release blocks older versions until they update."
        actions={isSuper ? <><Button variant="outline" onClick={() => reset('register')}>Register uploaded file</Button><Button onClick={() => reset('upload')}><Upload /> Create release</Button></> : undefined} />
      {!isSuper && <Alert tone="info" className="mb-4">Releases can be published or withdrawn by a super admin only.</Alert>}
      <ListCard>
        <DataTable<ReleaseRow>
          rows={data ?? undefined} loading={loading} error={error} onRetry={reload} rowKey={(r) => r.id} empty="No releases yet."
          columns={[
            { header: 'Version', cell: (r) => <span className="font-medium tabular-nums">{r.version}</span> },
            { header: 'Platform', cell: () => 'Windows' },
            { header: 'Published', cell: (r) => (r.is_published ? <Badge tone="success">published</Badge> : <Badge>unpublished</Badge>) },
            { header: 'Release date', cell: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.published_at)}</span> },
            { header: 'File', cell: (r) => <div><a href={r.download_url} className="block max-w-56 truncate text-sm hover:underline" rel="noreferrer noopener">{fileOf(r.download_url)}</a><span className="text-xs text-muted-foreground">{fmtBytes(r.size_bytes)} · </span><CopyText text={r.sha256} shown={r.sha256.slice(0, 10) + '…'} /></div> },
            { header: 'Notes', cell: (r) => <span className="bidi block max-w-64 truncate" title={r.notes ?? ''}>{r.notes ?? '—'}{r.mandatory && <Badge tone="danger" className="ml-1.5">mandatory</Badge>}</span> },
            { header: 'Actions', cell: (r) => (isSuper ? (r.is_published
              ? <Button variant="destructive-outline" size="sm" onClick={() => setUnpub(r)}>Unpublish</Button>
              : <Button variant="outline" size="sm" onClick={() => setRepub(r)}>Publish</Button>) : <span className="text-muted-foreground">—</span>) },
          ]}
        />
      </ListCard>

      <ActionDialog open={create !== null} onOpenChange={(o) => { if (!o) setCreate(null) }} wide
        title={create === 'upload' ? 'Create release' : 'Register uploaded file'} confirmLabel="Publish release" successMessage="Release published." onDone={reload} canSubmit={canSubmit}
        description={create === 'upload'
          ? <>Uploads the installer to the secure <code>releases</code> bucket and publishes it. The SHA-256 is calculated here in your browser; the app refuses a download whose hash does not match. The installer must be signed. The free Supabase plan allows files up to 50 MB.</>
          : <>For an installer you already uploaded (for example with <code>tools\publish_release.ps1</code> or the Supabase dashboard) as <code>AutoMax-Setup-&lt;version&gt;.exe</code>. The server checks the file exists and its size matches.</>}
        onSubmit={submit}>
        <Field label="Version" htmlFor="r-version" hint="Format 1.2.3 (must be higher than the one customers have)."><Input id="r-version" value={form.version} onChange={(e) => set({ version: e.target.value.trim() })} placeholder="0.3.0" maxLength={11} /></Field>
        {create === 'upload' ? (
          <>
            <Field label="Installer file" htmlFor="r-file" hint={file ? `${file.name} · ${fmtBytes(file.size)}` : undefined}>
              <Input id="r-file" type="file" accept=".exe,.msi" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="h-auto py-1.5" />
            </Field>
            <Checkbox id="r-replace" checked={form.replace} onChange={(v) => set({ replace: v })} label="Replace the file if this version was uploaded before" />
          </>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="SHA-256" htmlFor="r-sha"><Input id="r-sha" value={form.sha} onChange={(e) => set({ sha: e.target.value })} maxLength={64} className="font-mono" /></Field>
            <Field label="Size in bytes" htmlFor="r-size"><Input id="r-size" type="number" min={1} value={form.size} onChange={(e) => set({ size: e.target.value })} /></Field>
          </div>
        )}
        <Field label="Release notes" htmlFor="r-notes"><Textarea id="r-notes" value={form.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={4000} className="bidi" /></Field>
        <Checkbox id="r-mand" checked={form.mandatory} onChange={(v) => set({ mandatory: v })} label="Mandatory update (older versions cannot start new work until updated)" />
        {step && <p className="text-sm text-muted-foreground" role="status">{step}</p>}
      </ActionDialog>

      <ActionDialog open={!!repub} onOpenChange={(o) => { if (!o) setRepub(null) }} title={`Publish ${repub?.version}`} confirmLabel="Publish" successMessage="Release published." onDone={reload}
        description={<>Makes version <strong>{repub?.version}</strong> available again to every installed copy.{repub?.mandatory && <> It is marked <strong>mandatory</strong>.</>}</>}
        onSubmit={() => callApi('PUBLISH_RELEASE', { version: repub!.version, file_name: fileOf(repub!.download_url), sha256: repub!.sha256, size_bytes: repub!.size_bytes, notes: repub!.notes ?? undefined, mandatory: repub!.mandatory })} />

      <ActionDialog open={!!unpub} onOpenChange={(o) => { if (!o) setUnpub(null) }} title={`Unpublish ${unpub?.version}`} confirmLabel="Unpublish" destructive typed={unpub?.version} successMessage="Release unpublished." onDone={reload}
        description={<>Withdraws version <strong>{unpub?.version}</strong>: installed copies stop being offered it. The file and record are kept, so you can publish it again. Customers who already installed it are not affected.</>}
        onSubmit={() => callApi('UNPUBLISH_RELEASE', { version: unpub!.version })} />
    </>
  )
}
