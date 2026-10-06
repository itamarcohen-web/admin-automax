'use client'

import { ActionBadge } from '@/components/app/badges'
import { DataTable, ListCard, Pagination, SearchBox } from '@/components/app/data-table'
import { PageHeader, usePaged } from '@/components/app/page'
import { Alert } from '@/components/ui/card'
import { Select } from '@/components/ui/form'
import { useAuth } from '@/lib/auth'
import { fmtDateTime } from '@/lib/format'
import { can, type AuditRow, type Page } from '@/lib/types'
import { useApi } from '@/lib/use-api'

const AUDIT_ACTIONS = [
  'LOGIN', 'LOGOUT', 'CREATE_USER', 'UPDATE_USER', 'DELETE_USER', 'DISABLE_USER', 'ENABLE_USER', 'CHANGE_EMAIL', 'RESET_PASSWORD', 'CHANGE_PLAN',
  'EXTEND_SUBSCRIPTION', 'GRANT_LIFETIME', 'CANCEL_SUBSCRIPTION', 'REACTIVATE_SUBSCRIPTION', 'REMOVE_DEVICE', 'GRANT_TALENT', 'REVOKE_TALENT',
  'CREATE_RELEASE', 'PUBLISH_RELEASE', 'UNPUBLISH_RELEASE', 'CHANGE_REGISTRATION_STATUS', 'PUBLISH_LEGAL', 'UNPUBLISH_LEGAL', 'ADMIN_PERMISSION_CHANGE', 'ACCESS_DENIED',
]

export default function AuditLogPage() {
  const { state } = useAuth()
  const role = state.status === 'ready' ? state.me.role : undefined
  const { params, filters, set, offset, setOffset, limit } = usePaged({ search: '', action: '' }, 30)
  const allowed = can(role, 'admin')
  const { data, error, loading, reload } = useApi<Page<AuditRow>>(allowed ? 'GET_AUDIT_LOG' : null, params)

  if (!allowed) return <Alert tone="warning" title="Not available">The audit log is visible to admins and super admins.</Alert>
  return (
    <>
      <PageHeader title="Audit Log" description="Every administrative action, newest first. This log is read-only: it cannot be edited or deleted, not even by the database owner through this console." />
      <ListCard toolbar={
        <>
          <SearchBox value={filters.search} onChange={(v) => set({ search: v })} placeholder="Admin or target e-mail, resource ID" label="Search the audit log" />
          <Select aria-label="Action" className="w-64" value={filters.action} onChange={(e) => set({ action: e.target.value })}>
            <option value="">All actions</option>
            {AUDIT_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </Select>
        </>
      }>
        <DataTable<AuditRow>
          rows={data?.rows} loading={loading} error={error} onRetry={reload} rowKey={(r) => r.id} empty="No log entries match these filters." skeletonRows={8}
          columns={[
            { header: 'When', cell: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.created_at)}</span> },
            { header: 'Admin', cell: (r) => <span className="block max-w-48 truncate">{r.admin_email ?? 'system'}</span> },
            { header: 'Action', cell: (r) => <ActionBadge action={r.action} /> },
            { header: 'Target', cell: (r) => (r.target_user_id ? <a href={`/users/${r.target_user_id}/`} className="block max-w-56 truncate hover:underline">{r.target_email ?? r.target_user_id}</a> : <span className="block max-w-56 truncate text-muted-foreground">{r.target_email ?? (r.target_resource_id ? `${r.target_resource_type}: ${r.target_resource_id.slice(0, 16)}` : '—')}</span>) },
            { header: 'IP', cell: (r) => <span className="font-mono text-xs">{r.ip_address ?? '—'}</span> },
            { header: 'Details', cell: (r) => (
              <details className="max-w-md">
                <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">View</summary>
                <pre className="mt-2 max-h-56 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify({ resource: [r.target_resource_type, r.target_resource_id], metadata: r.metadata, user_agent: r.user_agent }, null, 2)}</pre>
              </details>
            ) },
          ]}
        />
        <Pagination total={data?.total ?? 0} limit={limit} offset={offset} onChange={setOffset} loading={loading} />
      </ListCard>
    </>
  )
}
