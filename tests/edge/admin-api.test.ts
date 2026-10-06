import { describe, expect, it } from 'vitest'
import { handle } from '../../supabase/functions/admin-api/core.ts'
import { ACTIONS } from '../../supabase/functions/admin-api/actions.ts'
import { call, IDS, jwtFor, makeHarness, ORIGIN } from './harness.ts'
import type { Harness } from './harness.ts'

async function run(h: Harness, who: keyof typeof IDS | null, action: string, params?: unknown, o?: Parameters<typeof call>[4]) {
  const { req } = call(h, who, action, params, o)
  const res = await handle(req, h.deps)
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null, text, headers: res.headers }
}
const writes = (h: Harness) => h.calls.filter((c) => c.fn.startsWith('admin_') && !['admin_whoami', 'admin_rate_hit', 'admin_audit_denied'].includes(c.fn))

describe('authentication', () => {
  it('rejects a request without a token (401) and touches nothing', async () => {
    const h = makeHarness()
    const r = await run(h, null, 'GET_DASHBOARD')
    expect(r.status).toBe(401)
    expect(h.calls).toHaveLength(0)
  })
  it('rejects a token Supabase Auth does not know', async () => {
    const h = makeHarness()
    const { req } = call(h, null, 'GET_DASHBOARD', {}, { headers: { authorization: 'Bearer ' + 'z'.repeat(40) } })
    expect((await handle(req, h.deps)).status).toBe(401)
    expect(h.calls).toHaveLength(0)
  })
  it('rejects a malformed Authorization header', async () => {
    const h = makeHarness()
    const { req } = call(h, null, 'GET_DASHBOARD', {}, { headers: { authorization: 'Basic abc' } })
    expect((await handle(req, h.deps)).status).toBe(401)
  })
})

describe('non-admin rejection', () => {
  it('a signed-in customer gets 403 and nothing sensitive', async () => {
    const h = makeHarness()
    const r = await run(h, 'customer', 'GET_USERS', {})
    expect(r.status).toBe(403)
    expect(r.body).toEqual({ ok: false, error: { code: 'forbidden', message: 'You do not have permission for this action.' } })
    expect(writes(h)).toHaveLength(0)
  })
  it('records the suspicious attempt', async () => {
    const h = makeHarness()
    await run(h, 'customer', 'DELETE_USER', { user_id: IDS.target, confirm: 'DELETE' })
    const d = h.calls.find((c) => c.fn === 'admin_audit_denied')
    expect(d?.args).toMatchObject({ p_user: IDS.customer, p_action: 'DELETE_USER', p_reason: 'not_admin' })
  })
  it('a deactivated admin is refused', async () => {
    const h = makeHarness()
    expect((await run(h, 'inactive', 'GET_USERS', {})).status).toBe(403)
  })
  it('does not reveal which action names exist to a non-admin', async () => {
    const h = makeHarness()
    expect((await run(h, 'customer', 'NO_SUCH_THING')).status).toBe(403)
    expect((await run(h, 'customer', 'GET_USERS')).status).toBe(403)
  })
})

describe('allow-list and request shape', () => {
  it('an unknown action is refused for admins (400)', async () => {
    const h = makeHarness()
    const r = await run(h, 'owner', 'DROP_TABLE')
    expect(r.status).toBe(400)
    expect(r.body.error.code).toBe('unknown_action')
  })
  it('prototype keys are not actions', async () => {
    const h = makeHarness()
    for (const a of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) expect((await run(h, 'owner', a)).status).toBe(400)
  })
  it('refuses non-POST, wrong content type, invalid JSON, extra top-level keys and oversized bodies', async () => {
    const h = makeHarness()
    expect((await run(h, 'owner', 'GET_PLANS', undefined, { method: 'GET' })).status).toBe(405)
    expect((await run(h, 'owner', 'GET_PLANS', undefined, { headers: { 'content-type': 'text/plain' } })).status).toBe(415)
    expect((await run(h, 'owner', 'GET_PLANS', undefined, { raw: '{nope' })).status).toBe(400)
    expect((await run(h, 'owner', 'GET_PLANS', undefined, { raw: JSON.stringify({ action: 'GET_PLANS', sql: 'select 1' }) })).status).toBe(400)
    expect((await run(h, 'owner', 'GET_PLANS', undefined, { raw: JSON.stringify({ action: 'GET_PLANS', params: { a: 'x'.repeat(40_000) } }) })).status).toBe(413)
  })
  it('every action declares a role, a limit class and a parser', () => {
    for (const [name, d] of Object.entries(ACTIONS)) {
      expect(name).toMatch(/^[A-Z_]+$/)
      expect(['support', 'admin', 'super_admin']).toContain(d.minRole)
      expect(['read', 'write', 'sensitive']).toContain(d.limit)
    }
    // destructive / fleet-wide actions are never available below their level
    expect(ACTIONS.DELETE_USER.minRole).toBe('super_admin')
    expect(ACTIONS.PUBLISH_RELEASE.minRole).toBe('super_admin')
    expect(ACTIONS.UNPUBLISH_LEGAL.minRole).toBe('super_admin')
    expect(ACTIONS.ADD_ADMIN.minRole).toBe('super_admin')
    expect(ACTIONS.GET_AUDIT_LOG.minRole).toBe('admin')
  })
})

describe('CORS / origin', () => {
  it('answers the preflight for the admin origin only', async () => {
    const h = makeHarness()
    const ok = await handle(new Request('https://x/f', { method: 'OPTIONS', headers: { origin: ORIGIN } }), h.deps)
    expect(ok.status).toBe(204)
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    const bad = await handle(new Request('https://x/f', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), h.deps)
    expect(bad.status).toBe(403)
    expect(bad.headers.get('access-control-allow-origin')).toBeNull()
  })
  it('a browser request from another site is refused even with a valid admin token', async () => {
    const h = makeHarness()
    const r = await run(h, 'owner', 'GET_PLANS', {}, { origin: 'https://evil.example' })
    expect(r.status).toBe(403)
    expect(h.calls).toHaveLength(0)
  })
  it('responses are never cached and not sniffable', async () => {
    const h = makeHarness()
    const r = await run(h, 'owner', 'GET_PLANS', {})
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
  })
})

describe('roles', () => {
  it('support: reads yes, admin actions no', async () => {
    const h = makeHarness()
    expect((await run(h, 'support', 'GET_USERS', {})).status).toBe(200)
    for (const [a, p] of [['CHANGE_PLAN', { user_id: IDS.target, plan: 'pro' }], ['GET_AUDIT_LOG', {}], ['DISABLE_USER', { user_id: IDS.target }], ['CREATE_USER', {}]] as const) {
      expect((await run(h, 'support', a, p)).status, a).toBe(403)
    }
    expect((await run(h, 'support', 'REMOVE_DEVICE', { user_id: IDS.target, device_id: 'a'.repeat(40) })).status).toBe(200)
  })
  it('admin cannot delete users, publish releases, change legal documents or manage admins', async () => {
    const h = makeHarness()
    const denied: [string, unknown][] = [
      ['DELETE_USER', { user_id: IDS.target, confirm: 'DELETE' }], ['PUBLISH_RELEASE', { version: '1.0.0', sha256: 'a'.repeat(64), size_bytes: 1 }],
      ['UNPUBLISH_RELEASE', { version: '1.0.0' }], ['PUBLISH_LEGAL', { version: '1', sha256: 'a'.repeat(64) }], ['GET_ADMINS', {}],
      ['ADD_ADMIN', { email: 'a@b.co', role: 'admin' }], ['SET_ADMIN', { user_id: IDS.target, role: 'admin', active: true }],
    ]
    for (const [a, p] of denied) expect((await run(h, 'admin', a, p)).status, a).toBe(403)
    expect(writes(h)).toHaveLength(0)
    expect((await run(h, 'admin', 'GET_AUDIT_LOG', {})).status).toBe(200)
  })
  it('p_admin always comes from the verified token, never from the request', async () => {
    const h = makeHarness()
    expect((await run(h, 'admin', 'GET_USERS', { p_admin: IDS.owner })).status).toBe(422)
    await run(h, 'admin', 'GET_USERS', {})
    expect(h.calls.find((c) => c.fn === 'admin_list_users')?.args.p_admin).toBe(IDS.admin)
  })
})

describe('MFA', () => {
  it('an enrolled admin with an aal1 session is refused', async () => {
    const h = makeHarness()
    h.state.factors.add(IDS.owner)
    const r = await run(h, 'owner', 'GET_USERS', {})
    expect(r.status).toBe(403)
    expect(r.body.error.code).toBe('mfa_required')
  })
  it('the same admin with an aal2 session is accepted', async () => {
    const h = makeHarness()
    h.state.factors.add(IDS.owner)
    h.state.aal[IDS.owner] = 'aal2'
    expect((await run(h, 'owner', 'GET_USERS', {})).status).toBe(200)
  })
  it('when MFA is required and not enrolled only GET_ME works', async () => {
    const h = makeHarness()
    h.state.requireMfa = true
    expect((await run(h, 'owner', 'GET_USERS', {})).body.error.code).toBe('mfa_enrollment_required')
    const me = await run(h, 'owner', 'GET_ME', {})
    expect(me.status).toBe(200)
    expect(me.body.data).toMatchObject({ role: 'super_admin', mfa_enrolled: false, mfa_required: true })
  })
})

describe('rate limiting and safe errors', () => {
  it('returns 429 when the database counter says so', async () => {
    const h = makeHarness()
    h.state.rateOk = false
    const r = await run(h, 'owner', 'GET_USERS', {})
    expect(r.status).toBe(429)
    expect(writes(h)).toHaveLength(0)
  })
  it('buckets are per admin and per class', async () => {
    const h = makeHarness()
    await run(h, 'owner', 'GET_USERS', {})
    await run(h, 'owner', 'DISABLE_USER', { user_id: IDS.target })
    const buckets = h.calls.filter((c) => c.fn === 'admin_rate_hit').map((c) => c.args.p_bucket)
    expect(buckets).toEqual([`api:${IDS.owner}:read`, `api:${IDS.owner}:sensitive`])
  })
  it('database errors never leak SQL, table names or stack traces', async () => {
    const h = makeHarness()
    h.state.rpcHandlers.admin_list_users = () => ({ data: null, error: { code: '42P01', message: 'relation "public.secret_table" does not exist at character 14 /var/lib/postgres' } })
    const r = await run(h, 'owner', 'GET_USERS', {})
    expect(r.status).toBe(500)
    expect(r.text).not.toMatch(/relation|secret_table|postgres|character|42P01/)
    expect(r.body.error.code).toBe('operation_failed')
  })
  it('unexpected exceptions are generic too', async () => {
    const h = makeHarness()
    h.state.rpcHandlers.admin_list_users = () => { throw new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2') }
    const r = await run(h, 'owner', 'GET_USERS', {})
    expect(r.status).toBe(500)
    expect(r.text).not.toMatch(/ECONNREFUSED|hunter2|10\.0\.0\.5/)
    expect(h.logs.join('\n')).not.toMatch(/hunter2|ECONNREFUSED/)
  })
  it('known domain errors map to clear, safe messages', async () => {
    const h = makeHarness()
    h.state.rpcHandlers.admin_extend_subscription = () => ({ data: null, error: { code: 'P0001', message: 'admin:lifetime_account' } })
    const r = await run(h, 'admin', 'EXTEND_SUBSCRIPTION', { user_id: IDS.target, months: 1 })
    expect(r.status).toBe(409)
    expect(r.body.error.code).toBe('lifetime_account')
    h.state.rpcHandlers.admin_extend_subscription = () => ({ data: null, error: { code: 'P0001', message: 'this account has a lifetime grant; no payment is needed' } })
    expect((await run(h, 'admin', 'EXTEND_SUBSCRIPTION', { user_id: IDS.target, months: 1 })).body.error.code).toBe('lifetime_account')
  })
})

describe('input validation', () => {
  it('rejects bad ids, unknown fields, injection-looking sort and out-of-range numbers', async () => {
    const h = makeHarness()
    const bad: [string, unknown][] = [
      ['GET_USER', { user_id: 'not-a-uuid' }], ['GET_USER', { user_id: IDS.target, extra: 1 }], ['GET_USER', {}],
      ['GET_USERS', { sort: 'email; drop table users' }], ['GET_USERS', { limit: 100000 }], ['GET_USERS', { limit: 0 }], ['GET_USERS', { offset: -1 }],
      ['GET_USERS', { search: 'x'.repeat(101) }], ['GET_USERS', { plan: "pro' or 1=1" }], ['GET_USERS', { status: 'DROP' }],
      ['EXTEND_SUBSCRIPTION', { user_id: IDS.target, months: 0 }], ['EXTEND_SUBSCRIPTION', { user_id: IDS.target, months: 37 }], ['EXTEND_SUBSCRIPTION', { user_id: IDS.target, months: 1.5 }],
      ['GET_USERS', 'a string'], ['GET_USERS', [1]], ['SET_REGISTRATION_STATUS', { id: IDS.target, status: 'pending' }],
      ['GRANT_TALENT', { email: 'x@y.co' }], ['GRANT_TALENT', { email: 'x@y.co', months: 3, lifetime: true }], ['GRANT_TALENT', { email: 'bad', months: 3 }],
      ['PUBLISH_RELEASE', { version: '1.0', sha256: 'a'.repeat(64), size_bytes: 1 }], ['CREATE_RELEASE', { version: '1.0.0', size_bytes: 1, file_name: '../../etc/passwd' }],
    ]
    for (const [a, p] of bad) expect((await run(h, 'owner', a, p)).status, `${a} ${JSON.stringify(p)}`).toBe(422)
    expect(writes(h)).toHaveLength(0)
  })
  it('passes clean parameters to the allow-listed SQL function only', async () => {
    const h = makeHarness()
    await run(h, 'admin', 'GET_USERS', { search: ' %_x ', plan: 'pro', status: 'valid', sort: 'email', dir: 'asc', limit: 10, offset: 20 })
    expect(h.calls.find((c) => c.fn === 'admin_list_users')?.args).toEqual({ p_admin: IDS.admin, p_search: '%_x', p_plan: 'pro', p_status: 'valid', p_sort: 'email', p_dir: 'asc', p_limit: 10, p_offset: 20 })
    const called = new Set(h.calls.map((c) => c.fn))
    for (const fn of called) expect(fn).toMatch(/^admin_[a-z_]+$/)
  })
})

describe('user lifecycle', () => {
  const create = { email: 'New.User@Example.com', password: 'Str0ngPassw0rd!', full_name: 'דנה', plan: 'basic', months: 1, email_confirmed: true }

  it('creates a user, applies the plan, audits without the password', async () => {
    const h = makeHarness()
    h.state.rpcHandlers.admin_check_email = () => ({ data: null, error: null })
    const r = await run(h, 'admin', 'CREATE_USER', create)
    expect(r.status).toBe(200)
    expect(r.body.data).toEqual({ user_id: IDS.target, warnings: [] })
    expect(h.authCalls).toContain('createUser')
    expect(h.calls.some((c) => c.fn === 'admin_extend_subscription' && c.args.p_plan_code === 'basic')).toBe(true)
    const audit = h.calls.find((c) => c.fn === 'admin_audit_record')!
    expect(audit.args.p_action).toBe('CREATE_USER')
    expect(JSON.stringify(h.calls)).not.toContain('Str0ngPassw0rd!')
    expect(h.logs.join('\n')).not.toContain('Str0ngPassw0rd!')
    expect(r.text).not.toContain('Str0ngPassw0rd!')
    expect(audit.args.p_target_email).toBe('new.user@example.com')
  })
  it('rejects weak passwords and a plan without months', async () => {
    const h = makeHarness()
    expect((await run(h, 'admin', 'CREATE_USER', { ...create, password: 'short' })).status).toBe(422)
    expect((await run(h, 'admin', 'CREATE_USER', { ...create, password: 'alllowercase1234' })).status).toBe(422)
    expect((await run(h, 'admin', 'CREATE_USER', { ...create, months: undefined })).status).toBe(422)
    expect(h.authCalls).toHaveLength(0)
  })
  it('duplicate and disposable e-mails give clear errors before anything is created', async () => {
    const h = makeHarness()
    h.state.rpcHandlers.admin_check_email = () => ({ data: 'duplicate', error: null })
    expect((await run(h, 'admin', 'CREATE_USER', create)).body.error.code).toBe('email_taken')
    h.state.rpcHandlers.admin_check_email = () => ({ data: 'disposable', error: null })
    expect((await run(h, 'admin', 'CREATE_USER', create)).body.error.code).toBe('email_disposable')
    expect(h.authCalls).not.toContain('createUser')
  })
  it('a race on the Auth side (email_exists) is also a 409', async () => {
    const h = makeHarness()
    h.state.rpcHandlers.admin_check_email = () => ({ data: null, error: null })
    const r = await run(h, 'admin', 'CREATE_USER', { ...create, email: 'dup@example.com' })
    expect(r.status).toBe(409)
  })
  it('a failing plan assignment still reports the created user with a warning', async () => {
    const h = makeHarness()
    h.state.rpcHandlers.admin_check_email = () => ({ data: null, error: null })
    h.state.rpcHandlers.admin_extend_subscription = () => ({ data: null, error: { message: 'admin:unknown_plan' } })
    const r = await run(h, 'admin', 'CREATE_USER', create)
    expect(r.status).toBe(200)
    expect(r.body.data.warnings).toEqual(['plan_not_applied'])
  })

  it('disable: database flag first, then the Auth ban', async () => {
    const h = makeHarness()
    const r = await run(h, 'admin', 'DISABLE_USER', { user_id: IDS.target, reason: 'chargeback' })
    expect(r.status).toBe(200)
    expect(h.calls.find((c) => c.fn === 'admin_set_user_disabled')?.args).toMatchObject({ p_user: IDS.target, p_disabled: true, p_reason: 'chargeback' })
    expect(h.authCalls).toEqual(['ban'])
  })
  it('disable: a failed ban is reported clearly (the licence block is already in place)', async () => {
    const h = makeHarness()
    h.state.failBan = true
    const r = await run(h, 'admin', 'DISABLE_USER', { user_id: IDS.target })
    expect(r.status).toBe(502)
    expect(r.body.error.code).toBe('ban_failed')
  })
  it('enable: Auth unban, then the flag', async () => {
    const h = makeHarness()
    await run(h, 'admin', 'ENABLE_USER', { user_id: IDS.target })
    expect(h.authCalls).toEqual(['unban'])
    expect(h.calls.at(-1)?.fn).toBe('admin_set_user_disabled')
  })

  it('delete needs super_admin AND the typed confirmation, archives payments first, audits the result', async () => {
    const h = makeHarness()
    h.state.rpcHandlers.admin_prepare_user_deletion = () => ({ data: { email: 'target@example.com', payments_archived: 3 }, error: null })
    expect((await run(h, 'owner', 'DELETE_USER', { user_id: IDS.target })).status).toBe(422)
    expect((await run(h, 'owner', 'DELETE_USER', { user_id: IDS.target, confirm: 'delete' })).status).toBe(422)
    expect(h.authCalls).toHaveLength(0)
    const r = await run(h, 'owner', 'DELETE_USER', { user_id: IDS.target, confirm: 'DELETE' })
    expect(r.status).toBe(200)
    expect(r.body.data).toEqual({ deleted: true, payments_archived: 3 })
    const order = h.calls.map((c) => c.fn).filter((f) => ['admin_prepare_user_deletion', 'admin_audit_record'].includes(f))
    expect(order).toEqual(['admin_prepare_user_deletion', 'admin_audit_record'])
    expect(h.authCalls).toEqual(['deleteUser'])
    expect(h.calls.find((c) => c.fn === 'admin_audit_record')?.args.p_metadata).toMatchObject({ result: 'ok', payments_archived: 3 })
  })
  it('a failed deletion is audited as failed and reported without details', async () => {
    const h = makeHarness()
    h.state.failDelete = true
    h.state.rpcHandlers.admin_prepare_user_deletion = () => ({ data: { email: 'target@example.com', payments_archived: 1 }, error: null })
    const r = await run(h, 'owner', 'DELETE_USER', { user_id: IDS.target, confirm: 'DELETE' })
    expect(r.status).toBe(502)
    expect(r.body.error.code).toBe('delete_failed')
    expect(h.calls.find((c) => c.fn === 'admin_audit_record')?.args.p_metadata).toMatchObject({ result: 'failed' })
  })

  it('change e-mail: guard check, Auth update, bookkeeping + audit in SQL', async () => {
    const h = makeHarness()
    h.state.rpcHandlers.admin_check_email = () => ({ data: null, error: null })
    const r = await run(h, 'admin', 'CHANGE_EMAIL', { user_id: IDS.target, email: 'Fresh@Example.com' })
    expect(r.status).toBe(200)
    expect(h.authCalls).toEqual(['getEmail', 'updateEmail'])
    expect(h.calls.find((c) => c.fn === 'admin_after_email_change')?.args).toMatchObject({ p_old_email: 'target@example.com', p_new_email: 'fresh@example.com' })
    expect((await run(h, 'admin', 'CHANGE_EMAIL', { user_id: IDS.target, email: 'target@example.com' })).status).toBe(409)
  })
  it('reset password sends the e-mail and never returns a link', async () => {
    const h = makeHarness()
    const r = await run(h, 'admin', 'RESET_PASSWORD', { user_id: IDS.target })
    expect(r.body.data).toEqual({ sent: true })
    expect(h.authCalls).toEqual(['getEmail', 'sendPasswordReset'])
    expect(h.calls.find((c) => c.fn === 'admin_audit_record')?.args.p_action).toBe('RESET_PASSWORD')
  })
})

describe('subscriptions, devices, talent, registrations', () => {
  it('forwards plan/extend/cancel/reactivate/lifetime/device/talent calls with p_ctx for the audit row', async () => {
    const h = makeHarness()
    await run(h, 'admin', 'CHANGE_PLAN', { user_id: IDS.target, plan: 'pro' })
    await run(h, 'admin', 'EXTEND_SUBSCRIPTION', { user_id: IDS.target, months: 3, note: 'phone sale' })
    await run(h, 'admin', 'CANCEL_SUBSCRIPTION', { user_id: IDS.target, immediate: true })
    await run(h, 'admin', 'REACTIVATE_SUBSCRIPTION', { user_id: IDS.target })
    await run(h, 'admin', 'GRANT_LIFETIME', { user_id: IDS.target })
    await run(h, 'admin', 'REMOVE_DEVICE', { user_id: IDS.target, device_id: 'd'.repeat(40) })
    await run(h, 'admin', 'GRANT_TALENT', { email: 'Artist@Example.com', months: 6 })
    await run(h, 'admin', 'REVOKE_TALENT', { email: 'artist@example.com' })
    await run(h, 'support', 'SET_REGISTRATION_STATUS', { id: IDS.target, status: 'approved', notes: 'called' })
    const fns = writes(h).map((c) => c.fn)
    expect(fns).toEqual(['admin_change_plan', 'admin_extend_subscription', 'admin_cancel_subscription', 'admin_reactivate_subscription', 'admin_grant_lifetime',
      'admin_remove_device', 'admin_grant_talent', 'admin_revoke_talent', 'admin_set_registration_status'])
    for (const c of writes(h)) expect(c.args.p_ctx).toEqual({ ip: '198.51.100.7', user_agent: 'vitest' })
    expect(h.calls.find((c) => c.fn === 'admin_grant_talent')?.args).toMatchObject({ p_email: 'artist@example.com', p_months: 6, p_lifetime: false })
  })
})

describe('releases', () => {
  const pub = { version: '0.4.0', sha256: 'AB'.repeat(32), size_bytes: 1234, notes: 'fixes', mandatory: true }
  it('create returns a signed upload for the releases bucket only; oversize is refused', async () => {
    const h = makeHarness()
    const r = await run(h, 'owner', 'CREATE_RELEASE', { version: '0.4.0', size_bytes: 1_000_000 })
    expect(r.body.data).toEqual({ path: 'AutoMax-Setup-0.4.0.exe', token: 'tok', bucket: 'releases' })
    expect(h.calls.find((c) => c.fn === 'admin_audit_record')?.args.p_action).toBe('CREATE_RELEASE')
    const big = await run(h, 'owner', 'CREATE_RELEASE', { version: '0.4.0', size_bytes: 200 * 1024 * 1024 })
    expect(big.body.error.code).toBe('file_too_large')
  })
  it('publish verifies the uploaded object, lower-cases the hash and builds the project URL itself', async () => {
    const h = makeHarness()
    const r = await run(h, 'owner', 'PUBLISH_RELEASE', pub)
    expect(r.status).toBe(200)
    expect(h.calls.find((c) => c.fn === 'admin_publish_release')?.args).toMatchObject({
      p_download_url: 'https://abcdefghij.supabase.co/storage/v1/object/public/releases/AutoMax-Setup-0.4.0.exe', p_sha256: 'ab'.repeat(32), p_mandatory: true, p_size_bytes: 1234,
    })
  })
  it('publish refuses a missing file or a size mismatch, and a client-supplied URL is not even accepted', async () => {
    const h = makeHarness()
    h.state.objectSize = null
    expect((await run(h, 'owner', 'PUBLISH_RELEASE', pub)).body.error.code).toBe('file_not_uploaded')
    h.state.objectSize = 999
    expect((await run(h, 'owner', 'PUBLISH_RELEASE', pub)).body.error.code).toBe('size_mismatch')
    expect((await run(h, 'owner', 'PUBLISH_RELEASE', { ...pub, download_url: 'https://evil.example/x.exe' })).status).toBe(422)
  })
  it('unpublish calls the existing function through its audited wrapper', async () => {
    const h = makeHarness()
    await run(h, 'owner', 'UNPUBLISH_RELEASE', { version: '0.4.0' })
    expect(h.calls.at(-1)?.fn).toBe('admin_unpublish_release')
  })
  it('legal: unpublish needs the typed word', async () => {
    const h = makeHarness()
    expect((await run(h, 'owner', 'UNPUBLISH_LEGAL', { sha256: 'a'.repeat(64) })).status).toBe(422)
    expect((await run(h, 'owner', 'UNPUBLISH_LEGAL', { sha256: 'a'.repeat(64), confirm: 'UNPUBLISH' })).status).toBe(200)
  })
})

describe('session audit and admin management', () => {
  it('login/logout are recorded through the audit RPC', async () => {
    const h = makeHarness()
    await run(h, 'support', 'LOG_LOGIN', {})
    await run(h, 'support', 'LOG_LOGOUT', {})
    expect(h.calls.filter((c) => c.fn === 'admin_audit_record').map((c) => c.args.p_action)).toEqual(['LOGIN', 'LOGOUT'])
  })
  it('secrets never appear in logs', async () => {
    const h = makeHarness()
    await run(h, 'customer', 'GET_USERS', {})
    await run(h, 'owner', 'NOPE')
    expect(h.logs.join('\n')).not.toContain(jwtFor('owner'))
    expect(h.logs.join('\n')).not.toContain(jwtFor('customer'))
  })
  it('GET_ADMINS adds the MFA status', async () => {
    const h = makeHarness()
    h.state.rpcHandlers.admin_list_admins = () => ({ data: [{ user_id: IDS.owner, email: 'o@x.co', role: 'super_admin', is_active: true }], error: null })
    h.state.factors.add(IDS.owner)
    h.state.aal[IDS.owner] = 'aal2'
    const r = await run(h, 'owner', 'GET_ADMINS', {})
    expect(r.body.data[0].mfa_enrolled).toBe(true)
  })
})
