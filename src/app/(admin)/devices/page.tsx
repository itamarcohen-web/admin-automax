'use client'

import { useState } from 'react'
import { UserX } from 'lucide-react'
import { ActionDialog } from '@/components/app/action-dialog'
import { DataTable, ListCard, Pagination, SearchBox } from '@/components/app/data-table'
import { CopyText, PageHeader, usePaged } from '@/components/app/page'
import { Button } from '@/components/ui/button'
import { callApi } from '@/lib/api'
import { fmtDateTime, fmtRelative } from '@/lib/format'
import type { DeviceRow, Page } from '@/lib/types'
import { useApi } from '@/lib/use-api'

export default function DevicesPage() {
  const { params, filters, set, offset, setOffset, limit } = usePaged({ search: '' })
  const { data, error, loading, reload } = useApi<Page<DeviceRow>>('GET_DEVICES', params)
  const [target, setTarget] = useState<DeviceRow | null>(null)

  return (
    <>
      <PageHeader title="Devices" description="Computers registered to a licence. Removing one frees a slot for the customer." />
      <ListCard toolbar={<SearchBox value={filters.search} onChange={(v) => set({ search: v })} placeholder="E-mail, device name or hash" label="Search devices" />}>
        <DataTable<DeviceRow>
          rows={data?.rows} loading={loading} error={error} onRetry={reload} rowKey={(d) => d.id} empty="No devices match this search."
          columns={[
            { header: 'User', cell: (d) => <a href={`/users/${d.user_id}/`} className="block max-w-56 truncate font-medium hover:underline">{d.email ?? d.user_id}</a> },
            { header: 'Device name', cell: (d) => <span className="bidi block max-w-48 truncate">{d.device_name ?? '—'}</span> },
            { header: 'Device hash', cell: (d) => <CopyText text={d.device_id} shown={d.device_id.slice(0, 14) + '…'} /> },
            { header: 'First seen', cell: (d) => <span className="whitespace-nowrap">{fmtDateTime(d.first_seen)}</span> },
            { header: 'Last seen', cell: (d) => <span className="whitespace-nowrap" title={fmtDateTime(d.last_seen)}>{fmtRelative(d.last_seen)}</span> },
            { header: 'Actions', cell: (d) => <Button variant="destructive-outline" size="sm" onClick={() => setTarget(d)} aria-label={`Remove ${d.device_name ?? 'device'} of ${d.email ?? d.user_id}`}><UserX /> Remove</Button> },
          ]}
        />
        <Pagination total={data?.total ?? 0} limit={limit} offset={offset} onChange={setOffset} loading={loading} />
      </ListCard>
      <ActionDialog open={!!target} onOpenChange={(o) => { if (!o) setTarget(null) }} title="Remove device" confirmLabel="Remove device" destructive successMessage="Device removed." onDone={reload}
        description={<>Removes <strong className="bidi">{target?.device_name ?? 'this computer'}</strong> from <strong>{target?.email}</strong>. The app registers it again the next time the customer signs in there (if a slot is free).</>}
        onSubmit={() => callApi('REMOVE_DEVICE', { user_id: target!.user_id, device_id: target!.device_id })} />
    </>
  )
}
