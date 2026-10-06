// Contract test: every SQL function the Edge Function calls exists in the migrations and is called with exactly its parameter names
// (a typo here would only show up in production otherwise).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { handle } from '../../supabase/functions/admin-api/core.ts'
import { ACTIONS } from '../../supabase/functions/admin-api/actions.ts'
import { call, IDS, makeHarness } from './harness.ts'

const MIG = join(process.cwd(), 'supabase', 'migrations')
const sql = readdirSync(MIG).sort().map((f) => readFileSync(join(MIG, f), 'utf8')).join('\n')

interface Sig { all: string[]; required: string[] }
const sigs = new Map<string, Sig>()
for (const m of sql.matchAll(/create or replace function public\.(admin_[a-z_]+)\(([^)]*)\)/gi)) {
  const parts = m[2].split(',').map((s) => s.trim()).filter(Boolean)
  sigs.set(m[1], { all: parts.map((p) => p.split(/\s+/)[0]), required: parts.filter((p) => !/\sdefault\s/i.test(p)).map((p) => p.split(/\s+/)[0]) })
}

const U = IDS.target
const SHA = 'ab'.repeat(32)
const SAMPLE: Record<string, unknown> = {
  GET_ME: {}, LOG_LOGIN: {}, LOG_LOGOUT: {}, GET_DASHBOARD: {}, GET_PLANS: {},
  GET_USERS: { search: 'a', plan: 'pro', status: 'valid', sort: 'email', dir: 'asc', limit: 5, offset: 0 }, GET_USER: { user_id: U },
  CREATE_USER: { email: 'a@b.co', password: 'Str0ngPassw0rd!', plan: 'basic', months: 1 }, UPDATE_USER: { user_id: U, full_name: 'X' },
  DISABLE_USER: { user_id: U, reason: 'r' }, ENABLE_USER: { user_id: U }, DELETE_USER: { user_id: U, confirm: 'DELETE' },
  CHANGE_EMAIL: { user_id: U, email: 'new@b.co' }, RESET_PASSWORD: { user_id: U },
  GET_SUBSCRIPTIONS: { status: 'active', search: 'x', limit: 5 }, CHANGE_PLAN: { user_id: U, plan: 'pro' }, EXTEND_SUBSCRIPTION: { user_id: U, months: 1, plan: 'basic', note: 'n' },
  GRANT_LIFETIME: { user_id: U, note: 'n' }, CANCEL_SUBSCRIPTION: { user_id: U, immediate: true }, REACTIVATE_SUBSCRIPTION: { user_id: U },
  GET_DEVICES: { search: 'x' }, REMOVE_DEVICE: { user_id: U, device_id: 'd'.repeat(40) },
  GET_TALENT: { status: 'pending', search: 'x' }, GRANT_TALENT: { email: 'a@b.co', months: 3, note: 'n' }, REVOKE_TALENT: { email: 'a@b.co' },
  GET_PAYMENTS: { status: 'paid', search: 'x', provider: 'stripe', archived: true }, GET_REGISTRATIONS: { status: 'new', search: 'x' },
  SET_REGISTRATION_STATUS: { id: U, status: 'approved', notes: 'n' }, GET_RELEASES: {}, CREATE_RELEASE: { version: '1.2.3', size_bytes: 10 },
  PUBLISH_RELEASE: { version: '1.2.3', sha256: SHA, size_bytes: 1234, notes: 'n', mandatory: true }, UNPUBLISH_RELEASE: { version: '1.2.3' },
  GET_LEGAL: {}, PUBLISH_LEGAL: { version: '1.0', sha256: SHA, title: 't' }, UNPUBLISH_LEGAL: { sha256: SHA, confirm: 'UNPUBLISH' },
  GET_AUDIT_LOG: { action: 'LOGIN', search: 'x', target_user_id: U, admin_user_id: U }, GET_ADMINS: {}, ADD_ADMIN: { email: 'a@b.co', role: 'admin' },
  SET_ADMIN: { user_id: U, role: 'admin', active: true },
}

describe('Edge Function <-> SQL contract', () => {
  it('has a sample for every action (so a new action cannot skip this test)', () => {
    expect(Object.keys(SAMPLE).sort()).toEqual(Object.keys(ACTIONS).sort())
  })

  it.each(Object.keys(SAMPLE))('%s calls only existing SQL functions with matching argument names', async (action) => {
    const h = makeHarness()
    h.state.rpcHandlers.admin_check_email = () => ({ data: null, error: null })
    h.state.rpcHandlers.admin_prepare_user_deletion = () => ({ data: { email: 'a@b.co', payments_archived: 0 }, error: null })
    h.state.rpcHandlers.admin_list_admins = () => ({ data: [], error: null })
    const { req } = call(h, 'owner', action, SAMPLE[action])
    const res = await handle(req, h.deps)
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200)
    const used = h.calls.filter((c) => !['admin_whoami', 'admin_rate_hit'].includes(c.fn))
    for (const c of used) {
      const sig = sigs.get(c.fn)
      expect(sig, `SQL function ${c.fn} is not defined in the migrations`).toBeDefined()
      for (const k of Object.keys(c.args)) expect(sig!.all, `${c.fn}: unknown argument ${k}`).toContain(k)
      for (const k of sig!.required) expect(Object.keys(c.args), `${c.fn}: missing required argument ${k}`).toContain(k)
    }
    // the two auth probes also exist
    expect(sigs.has('admin_whoami') && sigs.has('admin_rate_hit') && sigs.has('admin_audit_denied')).toBe(true)
  })

  it('every public admin_ function is locked to service_role by the migration loop', () => {
    for (const f of readdirSync(MIG)) {
      const t = readFileSync(join(MIG, f), 'utf8')
      if (!/create or replace function public\.admin_/i.test(t)) continue   // the index migration defines no functions
      expect(t, f).toContain("revoke all on function %s from public, anon, authenticated")
      expect(t, f).toContain('grant execute on function %s to service_role')
    }
  })
})
