// A fake Deps for the admin-api handler: an in-memory "Supabase" that records every call.
import type { Deps, RpcResult, Role, TokenInfo } from '../../supabase/functions/admin-api/types.ts'
import { AuthAdminError } from '../../supabase/functions/admin-api/types.ts'

export const ORIGIN = 'https://admin.auto-max.co.il'
export const IDS = {
  owner: '11111111-1111-4111-8111-111111111111',
  admin: '22222222-2222-4222-8222-222222222222',
  support: '33333333-3333-4333-8333-333333333333',
  inactive: '44444444-4444-4444-8444-444444444444',
  customer: '55555555-5555-4555-8555-555555555555',
  target: '66666666-6666-4666-8666-666666666666',
}
export const jwtFor = (who: keyof typeof IDS) => `jwt-${who}-` + 'x'.repeat(30)

export interface Harness {
  deps: Deps
  calls: { fn: string; args: Record<string, unknown> }[]
  logs: string[]
  authCalls: string[]
  state: {
    admins: Record<string, { role: Role; is_active: boolean; email: string }>
    factors: Set<string>
    aal: Record<string, string>
    rpcHandlers: Record<string, (args: Record<string, unknown>) => RpcResult>
    rateOk: boolean
    objectSize: number | null
    requireMfa: boolean
    emails: Record<string, string>
    failDelete: boolean
    failBan: boolean
  }
}

export function makeHarness(): Harness {
  const calls: Harness['calls'] = []
  const logs: string[] = []
  const authCalls: string[] = []
  const state: Harness['state'] = {
    admins: {
      [IDS.owner]: { role: 'super_admin', is_active: true, email: 'owner@auto-max.co.il' },
      [IDS.admin]: { role: 'admin', is_active: true, email: 'ops@auto-max.co.il' },
      [IDS.support]: { role: 'support', is_active: true, email: 'help@auto-max.co.il' },
      [IDS.inactive]: { role: 'admin', is_active: false, email: 'gone@auto-max.co.il' },
    },
    factors: new Set(), aal: {}, rpcHandlers: {}, rateOk: true, objectSize: 1234, requireMfa: false,
    emails: { [IDS.target]: 'target@example.com' }, failDelete: false, failBan: false,
  }
  const tokens: Record<string, TokenInfo> = {}
  for (const k of Object.keys(IDS) as (keyof typeof IDS)[]) tokens[jwtFor(k)] = { userId: IDS[k], email: `${k}@x.test`, aal: null }

  const deps: Deps = {
    config: { allowedOrigins: [ORIGIN], get requireMfa() { return state.requireMfa }, supabaseUrl: 'https://abcdefghij.supabase.co', maxReleaseBytes: 50 * 1024 * 1024 },
    async verifyToken(jwt) {
      const t = tokens[jwt]
      return t ? { ...t, aal: state.aal[t.userId] ?? 'aal1' } : null
    },
    async rpc(fn, args) {
      calls.push({ fn, args })
      if (fn === 'admin_whoami') {
        const a = state.admins[String(args.p_user)]
        return { data: a ? { user_id: args.p_user, ...a } : null, error: null }
      }
      if (fn === 'admin_rate_hit') return { data: state.rateOk, error: null }
      if (state.rpcHandlers[fn]) return state.rpcHandlers[fn](args)
      return { data: { ok: true }, error: null }
    },
    async hasVerifiedFactor(userId) { return state.factors.has(userId) },
    auth: {
      async createUser(a) { authCalls.push('createUser'); if (a.email === 'dup@example.com') throw new AuthAdminError('email_exists'); return { id: IDS.target } },
      async getEmail(id) { authCalls.push('getEmail'); return state.emails[id] ?? null },
      async updateEmail() { authCalls.push('updateEmail') },
      async setBanned(_id, banned) { authCalls.push(banned ? 'ban' : 'unban'); if (state.failBan) throw new AuthAdminError('rejected') },
      async deleteUser() { authCalls.push('deleteUser'); if (state.failDelete) throw new AuthAdminError('rejected') },
      async sendPasswordReset() { authCalls.push('sendPasswordReset') },
    },
    storage: {
      async createSignedUpload(path) { authCalls.push('signedUpload:' + path); return { token: 'tok', path } },
      async objectSize() { return state.objectSize },
    },
    log(event, data) { logs.push(JSON.stringify({ event, ...data })) },
  }
  return { deps, calls, logs, authCalls, state }
}

export function call(h: Harness, who: keyof typeof IDS | null, action: string, params?: unknown, o: { origin?: string | null; headers?: Record<string, string>; raw?: string; method?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'user-agent': 'vitest', 'cf-connecting-ip': '198.51.100.7', ...o.headers }
  if (o.origin !== null) headers.origin = o.origin ?? ORIGIN
  if (who) headers.authorization = `Bearer ${jwtFor(who)}`
  const req = new Request('https://x.supabase.co/functions/v1/admin-api', {
    method: o.method ?? 'POST', headers, body: (o.method ?? 'POST') === 'POST' ? (o.raw ?? JSON.stringify({ action, params })) : undefined,
  })
  return { req }
}
