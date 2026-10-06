// A tiny stand-in for Supabase Auth + the admin-api Edge Function, used ONLY to exercise the UI locally (no real project, no real data).
//   node tests/e2e/mock-supabase.mjs            -> http://127.0.0.1:54321
// Accounts (password for all: Mock-Passw0rd):  owner@auto-max.co.il (super_admin) | ops@auto-max.co.il (admin) | help@auto-max.co.il (support)
//   customer@example.com (valid account but NOT an admin: must be refused) | mfa@auto-max.co.il (super_admin with TOTP; code 123456)
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

const PORT = Number(process.env.MOCK_PORT ?? 54321)
const ORIGINS = new Set(['http://localhost:3000', 'http://127.0.0.1:3000'])
const PASSWORD = 'Mock-Passw0rd'
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ACCOUNTS = {
  'owner@auto-max.co.il': { id: id(1), role: 'super_admin' },
  'ops@auto-max.co.il': { id: id(2), role: 'admin' },
  'help@auto-max.co.il': { id: id(3), role: 'support' },
  'customer@example.com': { id: id(4), role: null },
  'mfa@auto-max.co.il': { id: id(5), role: 'super_admin', mfa: true },
}
const now = Date.now()
const iso = (daysAgo) => new Date(now - daysAgo * 86400000).toISOString()
const future = (days) => new Date(now + days * 86400000).toISOString()

const PLANS = [
  { code: 'basic', name: 'AutoMax Basic', price_cents: 4900, currency: 'ILS', max_devices: 1, is_active: true },
  { code: 'pro', name: 'AutoMax Pro', price_cents: 9900, currency: 'ILS', max_devices: 3, is_active: true },
  { code: 'talent', name: 'AutoMax Talent', price_cents: 0, currency: 'ILS', max_devices: 2, is_active: true },
]
const NAMES = ['דנה כהן', 'Noam Levi', 'יוסי ישראלי', 'Maya Ben-David', 'Omer Shapira', 'רונית אברהם', 'Eli Katz', 'Tal Mizrahi', 'Shira Peretz', 'אמיר דהן']
const USERS = NAMES.concat(Array.from({ length: 40 }, (_, i) => `Customer ${i + 11}`)).map((name, i) => {
  const plan = PLANS[i % 3]
  const status = i % 7 === 0 ? 'expired' : i % 5 === 0 ? 'canceled' : 'active'
  return {
    id: id(100 + i), email: `${name.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '') || 'user'}${i}@example.com`, full_name: name, created_at: iso(200 - i * 3),
    last_sign_in_at: i % 4 === 0 ? null : iso(i), email_confirmed_at: iso(200 - i * 3), is_disabled: i === 6, sub_status: status, is_lifetime: plan.code === 'talent' && i % 2 === 0,
    current_period_end: status === 'active' ? future(10 + i) : iso(5), cancel_at_period_end: i % 9 === 0, plan_code: plan.code, plan_name: plan.name,
    license_valid: status === 'active', device_count: i % 3, is_admin: false,
  }
})
const AUDIT = [
  { id: randomUUID(), created_at: iso(0.2), admin_user_id: id(1), admin_email: 'owner@auto-max.co.il', action: 'EXTEND_SUBSCRIPTION', target_user_id: USERS[0].id, target_email: USERS[0].email, target_resource_type: 'subscription', target_resource_id: id(900), metadata: { before: { period_end: iso(3) }, after: { period_end: future(27) }, months: 1 }, ip_address: '203.0.113.9', user_agent: 'Mozilla/5.0' },
  { id: randomUUID(), created_at: iso(1), admin_user_id: id(2), admin_email: 'ops@auto-max.co.il', action: 'GRANT_TALENT', target_user_id: null, target_email: 'artist@example.com', target_resource_type: 'talent_grant', target_resource_id: id(901), metadata: { months: 6 }, ip_address: '203.0.113.10', user_agent: 'Mozilla/5.0' },
  { id: randomUUID(), created_at: iso(2), admin_user_id: null, admin_email: 'x@y.co', action: 'ACCESS_DENIED', target_user_id: null, target_email: null, target_resource_type: 'admin_api', target_resource_id: null, metadata: { attempted_action: 'DELETE_USER', reason: 'not_admin' }, ip_address: '198.51.100.4', user_agent: 'curl/8' },
]

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const fakeJwt = (email, aal) => `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ sub: ACCOUNTS[email].id, email, role: 'authenticated', aal, amr: [{ method: aal === 'aal2' ? 'totp' : 'password', timestamp: Math.floor(Date.now() / 1000) }], session_id: id(77), exp: Math.floor(Date.now() / 1000) + 3600 })}.bW9ja3NpZ25hdHVyZQ`
const tokens = new Map()   // access token -> { email, aal }
function session(email, aal) {
  const access = fakeJwt(email, aal)
  tokens.set(access, { email, aal })
  const a = ACCOUNTS[email]
  const factors = a.mfa ? [{ id: id(555), factor_type: 'totp', status: 'verified', friendly_name: 'AutoMax Admin', created_at: iso(5), updated_at: iso(5) }] : []
  return {
    access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: `refresh-${email}`,
    user: { id: a.id, aud: 'authenticated', role: 'authenticated', email, email_confirmed_at: iso(30), created_at: iso(30), app_metadata: {}, user_metadata: {}, factors, identities: [] },
  }
}

const send = (res, status, body, origin) => {
  res.writeHead(status, {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    ...(origin && ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', Vary: 'Origin' } : {}),
  })
  res.end(body === undefined ? '' : JSON.stringify(body))
}
const body = (req) => new Promise((resolve) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}) } catch { resolve({}) } }) })
const page = (rows, p) => ({ total: rows.length, rows: rows.slice(p.offset ?? 0, (p.offset ?? 0) + (p.limit ?? 25)) })
const has = (v, q) => !q || String(v ?? '').toLowerCase().includes(String(q).toLowerCase())

const MIN = { support: 1, admin: 2, super_admin: 3 }
const NEED = { GET_AUDIT_LOG: 'admin', GET_ADMINS: 'super_admin', ADD_ADMIN: 'super_admin', SET_ADMIN: 'super_admin', DELETE_USER: 'super_admin', PUBLISH_RELEASE: 'super_admin', CREATE_RELEASE: 'super_admin', UNPUBLISH_RELEASE: 'super_admin', PUBLISH_LEGAL: 'super_admin', UNPUBLISH_LEGAL: 'super_admin',
  CHANGE_PLAN: 'admin', EXTEND_SUBSCRIPTION: 'admin', GRANT_LIFETIME: 'admin', CANCEL_SUBSCRIPTION: 'admin', REACTIVATE_SUBSCRIPTION: 'admin', GRANT_TALENT: 'admin', REVOKE_TALENT: 'admin', DISABLE_USER: 'admin', ENABLE_USER: 'admin', CREATE_USER: 'admin', UPDATE_USER: 'admin', CHANGE_EMAIL: 'admin', RESET_PASSWORD: 'admin' }

function api(action, p, who) {
  const role = ACCOUNTS[who.email].role
  const bad = (status, code, message) => ({ status, body: { ok: false, error: { code, message } } })
  if (!role) return bad(403, 'forbidden', 'You do not have permission for this action.')
  if (MIN[role] < MIN[NEED[action] ?? 'support']) return bad(403, 'forbidden', 'You do not have permission for this action.')
  const audit = (a, target = {}, metadata = {}) => AUDIT.unshift({ id: randomUUID(), created_at: new Date().toISOString(), admin_user_id: ACCOUNTS[who.email].id, admin_email: who.email, action: a, target_user_id: target.id ?? null, target_email: target.email ?? null, target_resource_type: null, target_resource_id: null, metadata, ip_address: '127.0.0.1', user_agent: 'mock' })
  const ok = (data) => ({ status: 200, body: { ok: true, data } })
  switch (action) {
    case 'GET_ME': return ok({ user_id: ACCOUNTS[who.email].id, email: who.email, role, mfa_enrolled: !!ACCOUNTS[who.email].mfa, mfa_required: false })
    case 'LOG_LOGIN': audit('LOGIN'); return ok({ ok: true })
    case 'LOG_LOGOUT': audit('LOGOUT'); return ok({ ok: true })
    case 'GET_PLANS': return ok(PLANS)
    case 'GET_DASHBOARD': return ok({
      total_users: USERS.length + 3, active_users_30d: 31, active_subscriptions: 28, lifetime_users: 4, talent_users: 7, registered_devices: 52, payments_count: 96, payments_total_cents: 4_512_300, pending_registrations: 3, disabled_users: 1,
      recent_registrations: [{ id: id(300), created_at: iso(0.1), customer_type: 'business', first_name: 'מיכל', last_name: 'לוי', business_name: 'סטודיו אדריכלים בע״מ', email: 'michal@studio.example', status: 'new' }, { id: id(301), created_at: iso(1), customer_type: 'private', first_name: 'Ben', last_name: 'Carter', business_name: null, email: 'ben@example.com', status: 'approved' }],
      recent_payments: [{ id: id(400), user_id: USERS[0].id, email: USERS[0].email, amount_cents: 4900, currency: 'ILS', status: 'paid', provider: 'stripe', paid_at: iso(0.3) }, { id: id(401), user_id: USERS[1].id, email: USERS[1].email, amount_cents: 9900, currency: 'ILS', status: 'failed', provider: 'stripe', paid_at: iso(1) }],
      recent_users: USERS.slice(0, 5).map((u) => ({ id: u.id, email: u.email, full_name: u.full_name, created_at: u.created_at })),
      recent_admin_actions: role === 'support' ? null : AUDIT.slice(0, 5).map((a) => ({ id: a.id, created_at: a.created_at, action: a.action, admin_email: a.admin_email, target_email: a.target_email })),
    })
    case 'GET_USERS': {
      let rows = USERS.filter((u) => (!p.search || has(u.email, p.search) || has(u.full_name, p.search) || u.id === p.search) && (!p.plan || u.plan_code === p.plan) && (!p.status || (p.status === 'disabled' ? u.is_disabled : p.status === 'valid' ? u.license_valid : u.sub_status === p.status)))
      if (p.sort === 'email') rows = [...rows].sort((a, b) => a.email.localeCompare(b.email))
      return ok(page(rows, p))
    }
    case 'GET_USER': {
      const u = USERS.find((x) => x.id === p.user_id)
      if (!u) return bad(404, 'not_found', 'Not found.')
      return ok({
        account: { id: u.id, email: u.email, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at, email_confirmed_at: u.email_confirmed_at, banned_until: null },
        profile: { full_name: u.full_name, email: u.email, created_at: u.created_at, updated_at: iso(3), is_disabled: u.is_disabled, disabled_at: u.is_disabled ? iso(2) : null, disabled_reason: u.is_disabled ? 'chargeback dispute' : null }, is_admin: false,
        subscriptions: [{ id: id(800), plan_code: u.plan_code, plan_name: u.plan_name, max_devices: PLANS.find((x) => x.code === u.plan_code).max_devices, status: u.sub_status, current_period_start: iso(20), current_period_end: u.current_period_end, cancel_at_period_end: u.cancel_at_period_end, provider: 'stripe', is_lifetime: !!u.is_lifetime, created_at: iso(120), is_valid: u.license_valid }],
        payments: [{ id: id(810), amount_cents: 4900, currency: 'ILS', status: 'paid', provider: 'stripe', provider_payment_id: 'pi_3Q9mockPAYMENT0001', paid_at: iso(20), created_at: iso(20) }, { id: id(811), amount_cents: 0, currency: 'ILS', status: 'paid', provider: 'manual', provider_payment_id: null, paid_at: iso(60), created_at: iso(60) }],
        devices: [{ id: id(820), device_id: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2', device_name: 'STUDIO-PC-01', first_seen: iso(100), last_seen: iso(0.5) }],
        talent_grants: u.is_lifetime ? [{ id: id(830), email: u.email, months: null, is_lifetime: true, note: 'שותף', created_at: iso(90), applied_at: iso(90), revoked_at: null, status: 'applied', granted_by: 'owner@auto-max.co.il' }] : [],
        legal_acceptances: [{ version: '1.0', sha256: 'e6e155c6054366938c31292074bfc2842ebe23a3e4f1432a6f6d77179f7958cc', context: 'signup', app_version: '0.2.0', accepted_at: iso(100) }],
        audit: role === 'support' ? [] : AUDIT.filter((a) => a.target_user_id === u.id).map((a) => ({ id: a.id, created_at: a.created_at, action: a.action, admin_email: a.admin_email, metadata: a.metadata })), registration: null,
      })
    }
    case 'GET_SUBSCRIPTIONS': return ok(page(USERS.filter((u) => (!p.status || u.sub_status === p.status || (p.status === 'valid' && u.license_valid)) && (!p.search || has(u.email, p.search))).map((u) => ({ id: u.id, user_id: u.id, email: u.email, plan_code: u.plan_code, plan_name: u.plan_name, status: u.sub_status, current_period_start: iso(20), current_period_end: u.current_period_end, cancel_at_period_end: u.cancel_at_period_end, provider: 'stripe', is_lifetime: !!u.is_lifetime, created_at: u.created_at, is_valid: u.license_valid })), p))
    case 'GET_PAYMENTS': return ok({ ...page(USERS.slice(0, 30).map((u, i) => ({ id: id(1000 + i), user_id: u.id, email: u.email, amount_cents: 4900 + (i % 2) * 5000, currency: 'ILS', status: i % 8 === 0 ? 'failed' : 'paid', provider: 'stripe', provider_payment_id: `pi_mock_${i}_abcdefghijklmnop`, paid_at: iso(i), created_at: iso(i), archived: false })).filter((x) => (!p.status || x.status === p.status) && (!p.search || has(x.email, p.search))), p), paid_total_cents: 123_400 })
    case 'GET_DEVICES': return ok(page(USERS.slice(0, 20).map((u, i) => ({ id: id(1200 + i), user_id: u.id, email: u.email, device_id: (String(i + 1).padStart(2, '0') + 'ab').repeat(16), device_name: i % 2 ? 'LAPTOP-' + i : 'מחשב-' + i, first_seen: iso(50 + i), last_seen: iso(i / 3) })).filter((d) => !p.search || has(d.email, p.search) || has(d.device_name, p.search)), p))
    case 'GET_TALENT': return ok(page([{ id: id(830), email: 'artist@example.com', user_id: null, months: 6, is_lifetime: false, note: 'מתנה', created_at: iso(1), applied_at: null, revoked_at: null, status: 'pending', expires_at: null, granted_by: 'ops@auto-max.co.il' }, { id: id(831), email: USERS[2].email, user_id: USERS[2].id, months: null, is_lifetime: true, note: null, created_at: iso(40), applied_at: iso(40), revoked_at: null, status: 'applied', expires_at: null, granted_by: 'owner@auto-max.co.il' }, { id: id(832), email: USERS[3].email, user_id: USERS[3].id, months: 3, is_lifetime: false, note: null, created_at: iso(120), applied_at: iso(120), revoked_at: iso(30), status: 'revoked', expires_at: iso(30), granted_by: 'owner@auto-max.co.il' }].filter((g) => !p.status || g.status === p.status), p))
    case 'GET_REGISTRATIONS': return ok(page([
      { id: id(300), created_at: iso(0.1), status: 'new', customer_type: 'business', first_name: 'מיכל', last_name: 'לוי', business_name: 'סטודיו אדריכלים בע״מ', company_number: '515123456', email: 'michal@studio.example', phone_e164: '+972501234567', country_name: 'Israel', country_code: 'IL', city: 'תל אביב', street: 'הרצל', house_number: '12', apartment: '4', postal_code: '6100000', language: 'he', app_version: '0.2.0', admin_notes: null, mail_sent: true, has_account: false },
      { id: id(301), created_at: iso(1), status: 'approved', customer_type: 'private', first_name: 'Ben', last_name: 'Carter', business_name: null, company_number: null, email: 'ben@example.com', phone_e164: '+14155550123', country_name: 'United States', country_code: 'US', city: 'Austin', street: 'Main St', house_number: '7', apartment: null, postal_code: '73301', language: 'en', app_version: '0.2.0', admin_notes: 'called on Monday', mail_sent: true, has_account: true }].filter((r) => (!p.status || r.status === p.status) && (!p.search || has(r.email, p.search))), p))
    case 'GET_RELEASES': return ok([{ id: id(500), version: '0.3.0', version_num: 3000, download_url: 'https://abcdefghij.supabase.co/storage/v1/object/public/releases/AutoMax-Setup-0.3.0.exe', sha256: 'ab'.repeat(32), size_bytes: 48_000_000, notes: 'תיקון אבטחה\nשיפורי ביצועים', mandatory: true, is_published: true, published_at: iso(2) }, { id: id(501), version: '0.2.0', version_num: 2000, download_url: 'https://abcdefghij.supabase.co/storage/v1/object/public/releases/AutoMax-Setup-0.2.0.exe', sha256: 'cd'.repeat(32), size_bytes: 46_500_000, notes: 'First public beta', mandatory: false, is_published: false, published_at: iso(40) }])
    case 'GET_LEGAL': return ok([{ version: '1.0', sha256: 'e6e155c6054366938c31292074bfc2842ebe23a3e4f1432a6f6d77179f7958cc', title: 'תנאי שימוש ומדיניות פרטיות', published_at: iso(5), is_current: true, acceptances: 38 }])
    case 'GET_AUDIT_LOG': return ok(page(AUDIT.filter((a) => (!p.action || a.action === p.action) && (!p.search || has(a.admin_email, p.search) || has(a.target_email, p.search))), p))
    case 'GET_ADMINS': return ok(Object.entries(ACCOUNTS).filter(([, a]) => a.role).map(([email, a]) => ({ user_id: a.id, email, role: a.role, is_active: true, created_at: iso(30), last_sign_in_at: iso(0), mfa_enrolled: !!a.mfa })))
    case 'CREATE_USER': return ok({ user_id: USERS[0].id, warnings: [] })
    default: audit(action, USERS[0], { mock: true }); return ok({ ok: true })
  }
}

createServer(async (req, res) => {
  const origin = req.headers.origin
  const url = new URL(req.url, 'http://x')
  if (req.method === 'OPTIONS') return send(res, 204, undefined, origin)
  const p = url.pathname
  const b = await body(req)
  const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '')
  const who = tokens.get(bearer)

  if (p === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
    const a = ACCOUNTS[String(b.email ?? '').toLowerCase()]
    if (!a || b.password !== PASSWORD) return send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, origin)
    return send(res, 200, session(String(b.email).toLowerCase(), 'aal1'), origin)
  }
  if (p === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
    const email = String(b.refresh_token ?? '').replace('refresh-', '')
    return ACCOUNTS[email] ? send(res, 200, session(email, tokens.get(bearer)?.aal ?? 'aal1'), origin) : send(res, 400, { error_code: 'refresh_token_not_found' }, origin)
  }
  if (p === '/auth/v1/user') return who ? send(res, 200, session(who.email, who.aal).user, origin) : send(res, 401, { msg: 'invalid JWT' }, origin)
  if (p === '/auth/v1/logout') return send(res, 204, undefined, origin)
  const m = /^\/auth\/v1\/factors\/([^/]+)\/(challenge|verify)$/.exec(p)
  if (m && who) {
    if (m[2] === 'challenge') return send(res, 200, { id: id(556), type: 'totp', expires_at: Math.floor(Date.now() / 1000) + 300 }, origin)
    if (b.code === '123456') return send(res, 200, session(who.email, 'aal2'), origin)
    return send(res, 400, { code: 400, error_code: 'mfa_verification_failed', msg: 'Invalid TOTP code entered' }, origin)
  }
  if (p === '/auth/v1/factors' && req.method === 'POST' && who) return send(res, 200, { id: id(600), type: 'totp', friendly_name: 'AutoMax Admin', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="176" height="176"><rect width="176" height="176" fill="white"/><path d="M8 8h40v40H8zM128 8h40v40h-40zM8 128h40v40H8z" fill="black"/></svg>', secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', uri: 'otpauth://totp/x' } }, origin)
  if (p.startsWith('/auth/v1/factors/') && req.method === 'DELETE') return send(res, 200, { id: id(600) }, origin)

  if (p === '/functions/v1/admin-api' && req.method === 'POST') {
    if (!who) return send(res, 401, { ok: false, error: { code: 'unauthenticated', message: 'Sign in required.' } }, origin)
    await new Promise((r) => setTimeout(r, 120))
    const out = api(b.action, b.params ?? {}, who)
    return send(res, out.status, out.body, origin)
  }
  send(res, 404, { error: 'not found' }, origin)
}).listen(PORT, '127.0.0.1', () => console.log(`mock supabase on http://127.0.0.1:${PORT}  (password for every account: ${PASSWORD})`))
