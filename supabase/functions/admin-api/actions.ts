// The allow-list of admin actions. The client sends {action, params}; anything not in this table is refused (400).
// Each entry declares: the minimum role, the rate-limit class, a strict parser for its params, and the implementation.
// The implementation only calls allow-listed SQL functions (public.admin_*) - never arbitrary SQL or table access.
import { AuthAdminError, ApiError, ROLE_RANK } from './types.ts'
import type { AdminIdentity, Deps, RequestContext, Role } from './types.ts'
import { fromDbError } from './errors.ts'
import { checkPassword, ValidationError } from './validate.ts'
import type { Reader } from './validate.ts'

export type LimitClass = 'read' | 'write' | 'sensitive'

export interface ActionContext {
  admin: AdminIdentity
  deps: Deps
  req: RequestContext
  /** read RPC: adds p_admin */
  read(fn: string, args?: Record<string, unknown>): Promise<unknown>
  /** write RPC: adds p_admin and p_ctx (ip + user agent, for the audit row) */
  write(fn: string, args?: Record<string, unknown>): Promise<unknown>
  /** audit entry for something the Edge Function did itself (Auth API calls, signed upload URLs, login/logout) */
  audit(action: string, o?: { targetUser?: string; resourceType?: string; resourceId?: string; metadata?: Record<string, unknown>; targetEmail?: string }): Promise<void>
}

export interface ActionDef {
  minRole: Role
  limit: LimitClass
  /** may run for an admin that has no MFA yet although MFA is required (only GET_ME) */
  allowWithoutMfa?: boolean
  parse(r: Reader): Record<string, unknown>
  run(c: ActionContext, p: Record<string, unknown>): Promise<unknown>
}

const PLAN_CODE = /^[a-z0-9_-]{1,40}$/
const SEMVER = /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/
const SHA256 = /^[0-9a-fA-F]{64}$/
const FILE_NAME = /^[A-Za-z0-9._-]{1,120}$/
const SUB_STATUS = ['active', 'trialing', 'past_due', 'canceled', 'expired', 'valid'] as const
const REG_STATUS = ['new', 'contacted', 'approved', 'rejected', 'spam'] as const
const PAY_STATUS = ['paid', 'failed', 'refunded'] as const
const TALENT_STATUS = ['pending', 'applied', 'revoked'] as const
const ROLES = ['super_admin', 'admin', 'support'] as const
const USER_SORT = ['created_at', 'email', 'last_sign_in', 'devices', 'plan'] as const

const def = (d: ActionDef): ActionDef => d

function releasePath(version: string, fileName?: string): string {
  return fileName ?? `AutoMax-Setup-${version}.exe`
}

async function authCall<T>(fn: () => Promise<T>, map: Partial<Record<AuthAdminError['kind'], ApiError>> = {}): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof ApiError) throw e
    if (e instanceof AuthAdminError && map[e.kind]) throw map[e.kind]
    throw new ApiError(502, 'auth_service_error', 'The authentication service could not complete the request.')
  }
}

const EMAIL_REASON: Record<string, ApiError> = {
  duplicate: new ApiError(409, 'email_taken', 'This e-mail (or another address of the same mailbox) is already registered.'),
  disposable: new ApiError(422, 'email_disposable', 'Disposable e-mail domains are blocked.'),
  invalid: new ApiError(422, 'invalid_email', 'Invalid e-mail address.'),
}

async function assertEmailAllowed(c: ActionContext, email: string, userId: string | null): Promise<void> {
  const reason = await c.read('admin_check_email', { p_email: email, p_user: userId })
  if (typeof reason === 'string') throw EMAIL_REASON[reason] ?? EMAIL_REASON.invalid
}

export const ACTIONS: Record<string, ActionDef> = {
  // ---------------------------------------------------------------- session
  GET_ME: def({
    minRole: 'support', limit: 'read', allowWithoutMfa: true,
    parse: (r) => (r.done(), {}),
    run: async (c) => ({
      user_id: c.admin.userId, email: c.admin.email, role: c.admin.role,
      mfa_enrolled: await c.deps.hasVerifiedFactor(c.admin.userId), mfa_required: c.deps.config.requireMfa,
    }),
  }),
  LOG_LOGIN: def({
    minRole: 'support', limit: 'write', parse: (r) => (r.done(), {}),
    run: async (c) => (await c.audit('LOGIN'), { ok: true }),
  }),
  LOG_LOGOUT: def({
    minRole: 'support', limit: 'write', parse: (r) => (r.done(), {}),
    run: async (c) => (await c.audit('LOGOUT'), { ok: true }),
  }),

  // ---------------------------------------------------------------- dashboard
  GET_DASHBOARD: def({ minRole: 'support', limit: 'read', parse: (r) => (r.done(), {}), run: (c) => c.read('admin_dashboard') }),
  GET_PLANS: def({ minRole: 'support', limit: 'read', parse: (r) => (r.done(), {}), run: (c) => c.read('admin_list_plans') }),

  // ---------------------------------------------------------------- users
  GET_USERS: def({
    minRole: 'support', limit: 'read',
    parse: (r) => {
      const p = {
        p_search: r.search() ?? null,
        p_plan: r.optStr('plan', { max: 40, pattern: PLAN_CODE }) ?? null,
        p_status: r.optStr('status', { max: 20, pattern: /^(active|trialing|past_due|canceled|expired|valid|none|disabled)$/ }) ?? null,
        p_sort: r.optOneOf('sort', USER_SORT) ?? 'created_at',
        p_dir: r.optOneOf('dir', ['asc', 'desc'] as const) ?? 'desc',
        ...(() => { const g = r.page(); return { p_limit: g.limit, p_offset: g.offset } })(),
      }
      r.done()
      return p
    },
    run: (c, p) => c.read('admin_list_users', p),
  }),
  GET_USER: def({ minRole: 'support', limit: 'read', parse: (r) => { const p = { p_user: r.uuid('user_id') }; r.done(); return p }, run: (c, p) => c.read('admin_get_user', p) }),

  CREATE_USER: def({
    minRole: 'admin', limit: 'sensitive',
    parse: (r) => {
      const p = {
        email: r.email('email'),
        password: r.secret('password', { min: 10, max: 72 }),
        full_name: r.optStr('full_name', { max: 120 }),
        plan: r.optStr('plan', { max: 40, pattern: PLAN_CODE }),
        months: r.optInt('months', { min: 1, max: 36 }),
        email_confirmed: r.optBool('email_confirmed', true),
      }
      r.done()
      if (!checkPassword(p.password)) throw new ValidationError('password', 'weak_password')
      if (p.plan && !p.months) throw new ValidationError('months', 'required_with_plan')
      return p
    },
    run: async (c, p) => {
      const email = p.email as string
      await assertEmailAllowed(c, email, null)
      const created = await authCall(
        () => c.deps.auth.createUser({ email, password: p.password as string, emailConfirm: p.email_confirmed as boolean, fullName: p.full_name as string | undefined }),
        { email_exists: EMAIL_REASON.duplicate, weak_password: new ApiError(422, 'weak_password', 'The password is too weak.') },
      )
      const warnings: string[] = []
      if (p.plan) {
        try {
          if (p.plan === 'talent') await c.write('admin_grant_talent', { p_email: email, p_months: p.months, p_lifetime: false, p_note: null })
          else await c.write('admin_extend_subscription', { p_user: created.id, p_plan_code: p.plan, p_months: p.months, p_note: 'created with the account' })
        } catch {
          warnings.push('plan_not_applied')
        }
      }
      await c.audit('CREATE_USER', {
        targetUser: created.id, resourceType: 'user', resourceId: created.id, targetEmail: email,
        metadata: { email, plan: p.plan ?? null, months: p.months ?? null, email_confirmed: p.email_confirmed, warnings },
      })
      return { user_id: created.id, warnings }
    },
  }),

  UPDATE_USER: def({
    minRole: 'admin', limit: 'write',
    parse: (r) => { const p = { p_user: r.uuid('user_id'), p_full_name: r.optStr('full_name', { max: 120 }) ?? null }; r.done(); return p },
    run: (c, p) => c.write('admin_update_profile', p),
  }),

  DISABLE_USER: def({
    minRole: 'admin', limit: 'sensitive',
    parse: (r) => { const p = { user_id: r.uuid('user_id'), reason: r.optStr('reason', { max: 300 }) ?? null }; r.done(); return p },
    run: async (c, p) => {
      // 1) flag + audit (validates: not yourself, not an admin) 2) Auth ban (no new sign-ins / refreshes). The flag alone already blocks check_license.
      const res = await c.write('admin_set_user_disabled', { p_user: p.user_id, p_disabled: true, p_reason: p.reason })
      await authCall(() => c.deps.auth.setBanned(p.user_id as string, true), {
        not_found: new ApiError(404, 'not_found', 'Not found.'),
      }).catch(() => { throw new ApiError(502, 'ban_failed', 'The account is flagged as disabled (licence blocked), but the sign-in ban could not be set. Try again.') })
      return res
    },
  }),
  ENABLE_USER: def({
    minRole: 'admin', limit: 'sensitive',
    parse: (r) => { const p = { user_id: r.uuid('user_id') }; r.done(); return p },
    run: async (c, p) => {
      await authCall(() => c.deps.auth.setBanned(p.user_id as string, false))
      return c.write('admin_set_user_disabled', { p_user: p.user_id, p_disabled: false, p_reason: null })
    },
  }),

  DELETE_USER: def({
    minRole: 'super_admin', limit: 'sensitive',
    parse: (r) => { const p = { user_id: r.uuid('user_id') }; r.literal('confirm', 'DELETE'); r.done(); return p },
    run: async (c, p) => {
      const prep = (await c.write('admin_prepare_user_deletion', { p_user: p.user_id })) as { email?: string; payments_archived?: number }
      try {
        await c.deps.auth.deleteUser(p.user_id as string)
      } catch {
        await c.audit('DELETE_USER', { targetUser: p.user_id as string, resourceType: 'user', resourceId: p.user_id as string, targetEmail: prep.email, metadata: { result: 'failed' } })
        throw new ApiError(502, 'delete_failed', 'The account could not be deleted. Nothing was removed; payment history is archived and safe.')
      }
      await c.audit('DELETE_USER', {
        targetUser: p.user_id as string, resourceType: 'user', resourceId: p.user_id as string, targetEmail: prep.email,
        metadata: { result: 'ok', email: prep.email, payments_archived: prep.payments_archived ?? 0 },
      })
      return { deleted: true, payments_archived: prep.payments_archived ?? 0 }
    },
  }),

  CHANGE_EMAIL: def({
    minRole: 'admin', limit: 'sensitive',
    parse: (r) => { const p = { user_id: r.uuid('user_id'), email: r.email('email') }; r.done(); return p },
    run: async (c, p) => {
      const userId = p.user_id as string
      const email = p.email as string
      const old = await authCall(() => c.deps.auth.getEmail(userId))
      if (!old) throw new ApiError(404, 'not_found', 'Not found.')
      if (old.toLowerCase() === email) throw new ApiError(409, 'same_email', 'That is already the e-mail of this account.')
      await assertEmailAllowed(c, email, userId)
      await authCall(() => c.deps.auth.updateEmail(userId, email), { email_exists: EMAIL_REASON.duplicate })
      await c.write('admin_after_email_change', { p_user: userId, p_old_email: old, p_new_email: email })
      return { user_id: userId, email }
    },
  }),

  RESET_PASSWORD: def({
    minRole: 'admin', limit: 'sensitive',
    parse: (r) => { const p = { user_id: r.uuid('user_id') }; r.done(); return p },
    run: async (c, p) => {
      const email = await authCall(() => c.deps.auth.getEmail(p.user_id as string))
      if (!email) throw new ApiError(404, 'not_found', 'Not found.')
      // The customer receives the link by e-mail; the admin never sees it or a password.
      await authCall(() => c.deps.auth.sendPasswordReset(email, c.deps.config.passwordResetRedirect))
      await c.audit('RESET_PASSWORD', { targetUser: p.user_id as string, resourceType: 'user', resourceId: p.user_id as string, targetEmail: email, metadata: { method: 'email_link' } })
      return { sent: true }
    },
  }),

  // ---------------------------------------------------------------- subscriptions
  GET_SUBSCRIPTIONS: def({
    minRole: 'support', limit: 'read',
    parse: (r) => {
      const g = r.page()
      const p = { p_status: r.optOneOf('status', SUB_STATUS) ?? null, p_search: r.search() ?? null, p_limit: g.limit, p_offset: g.offset }
      r.done()
      return p
    },
    run: (c, p) => c.read('admin_list_subscriptions', p),
  }),
  CHANGE_PLAN: def({
    minRole: 'admin', limit: 'write',
    parse: (r) => { const p = { p_user: r.uuid('user_id'), p_plan_code: r.str('plan', { max: 40, pattern: PLAN_CODE }) }; r.done(); return p },
    run: (c, p) => c.write('admin_change_plan', p),
  }),
  EXTEND_SUBSCRIPTION: def({
    minRole: 'admin', limit: 'write',
    parse: (r) => {
      const p = { p_user: r.uuid('user_id'), p_plan_code: r.optStr('plan', { max: 40, pattern: PLAN_CODE }) ?? null, p_months: r.int('months', { min: 1, max: 36 }), p_note: r.optStr('note', { max: 300 }) ?? null }
      r.done()
      return p
    },
    run: (c, p) => c.write('admin_extend_subscription', p),
  }),
  GRANT_LIFETIME: def({
    minRole: 'admin', limit: 'sensitive',
    parse: (r) => { const p = { p_user: r.uuid('user_id'), p_note: r.optStr('note', { max: 300 }) ?? null }; r.done(); return p },
    run: (c, p) => c.write('admin_grant_lifetime', p),
  }),
  CANCEL_SUBSCRIPTION: def({
    minRole: 'admin', limit: 'sensitive',
    parse: (r) => { const p = { p_user: r.uuid('user_id'), p_immediate: r.optBool('immediate', false) }; r.done(); return p },
    run: (c, p) => c.write('admin_cancel_subscription', p),
  }),
  REACTIVATE_SUBSCRIPTION: def({
    minRole: 'admin', limit: 'write',
    parse: (r) => { const p = { p_user: r.uuid('user_id') }; r.done(); return p },
    run: (c, p) => c.write('admin_reactivate_subscription', p),
  }),

  // ---------------------------------------------------------------- devices
  GET_DEVICES: def({
    minRole: 'support', limit: 'read',
    parse: (r) => { const g = r.page(); const p = { p_search: r.search() ?? null, p_limit: g.limit, p_offset: g.offset }; r.done(); return p },
    run: (c, p) => c.read('admin_list_devices', p),
  }),
  REMOVE_DEVICE: def({
    minRole: 'support', limit: 'write',
    parse: (r) => { const p = { p_user: r.uuid('user_id'), p_device_id: r.str('device_id', { min: 8, max: 128 }) }; r.done(); return p },
    run: (c, p) => c.write('admin_remove_device', p),
  }),

  // ---------------------------------------------------------------- talent
  GET_TALENT: def({
    minRole: 'support', limit: 'read',
    parse: (r) => { const g = r.page(); const p = { p_status: r.optOneOf('status', TALENT_STATUS) ?? null, p_search: r.search() ?? null, p_limit: g.limit, p_offset: g.offset }; r.done(); return p },
    run: (c, p) => c.read('admin_list_talent', p),
  }),
  GRANT_TALENT: def({
    minRole: 'admin', limit: 'write',
    parse: (r) => {
      const lifetime = r.optBool('lifetime', false)
      const months = r.optInt('months', { min: 1, max: 120 })
      const p = { p_email: r.email('email'), p_months: lifetime ? null : months ?? null, p_lifetime: lifetime, p_note: r.optStr('note', { max: 300 }) ?? null }
      r.done()
      if (!lifetime && months === undefined) throw new ValidationError('months', 'required')
      if (lifetime && months !== undefined) throw new ValidationError('months', 'not_with_lifetime')
      return p
    },
    run: (c, p) => c.write('admin_grant_talent', p),
  }),
  REVOKE_TALENT: def({
    minRole: 'admin', limit: 'sensitive',
    parse: (r) => { const p = { p_email: r.email('email') }; r.done(); return p },
    run: (c, p) => c.write('admin_revoke_talent', p),
  }),

  // ---------------------------------------------------------------- payments (read only: they are the financial audit trail)
  GET_PAYMENTS: def({
    minRole: 'support', limit: 'read',
    parse: (r) => {
      const g = r.page()
      const p = {
        p_status: r.optOneOf('status', PAY_STATUS) ?? null, p_search: r.search() ?? null,
        p_provider: r.optStr('provider', { max: 40, pattern: /^[a-z0-9_-]+$/ }) ?? null,
        p_archived: r.optBool('archived', false), p_limit: g.limit, p_offset: g.offset,
      }
      r.done()
      return p
    },
    run: (c, p) => c.read('admin_list_payments', p),
  }),

  // ---------------------------------------------------------------- registrations
  GET_REGISTRATIONS: def({
    minRole: 'support', limit: 'read',
    parse: (r) => { const g = r.page(); const p = { p_status: r.optOneOf('status', REG_STATUS) ?? null, p_search: r.search() ?? null, p_limit: g.limit, p_offset: g.offset }; r.done(); return p },
    run: (c, p) => c.read('admin_list_registrations', p),
  }),
  SET_REGISTRATION_STATUS: def({
    minRole: 'support', limit: 'write',
    parse: (r) => { const p = { p_id: r.uuid('id'), p_status: r.oneOf('status', REG_STATUS), p_notes: r.optStr('notes', { max: 1000 }) ?? null }; r.done(); return p },
    run: (c, p) => c.write('admin_set_registration_status', p),
  }),

  // ---------------------------------------------------------------- releases (super_admin: ships code to every customer)
  GET_RELEASES: def({ minRole: 'support', limit: 'read', parse: (r) => (r.done(), {}), run: (c) => c.read('admin_list_releases') }),
  CREATE_RELEASE: def({
    minRole: 'super_admin', limit: 'sensitive',
    parse: (r) => {
      const p = { version: r.str('version', { max: 11, pattern: SEMVER }), size_bytes: r.int('size_bytes', { min: 1, max: 5_000_000_000 }), file_name: r.optStr('file_name', { max: 120, pattern: FILE_NAME }), replace: r.optBool('replace', false) }
      r.done()
      return p
    },
    run: async (c, p) => {
      const max = c.deps.config.maxReleaseBytes
      if ((p.size_bytes as number) > max) {
        throw new ApiError(422, 'file_too_large', `The file is larger than the upload limit (${Math.floor(max / 1_000_000)} MB). Upload it with tools/publish_release.ps1 or the Supabase dashboard, then use "Register uploaded file".`)
      }
      const path = releasePath(p.version as string, p.file_name as string | undefined)
      const up = await authCall(() => c.deps.storage.createSignedUpload(path, p.replace as boolean), { rejected: new ApiError(409, 'file_exists', 'A file with that name already exists. Tick "replace" to overwrite it.') })
      await c.audit('CREATE_RELEASE', { resourceType: 'release', resourceId: p.version as string, metadata: { version: p.version, path, size_bytes: p.size_bytes, replace: p.replace } })
      return { path: up.path, token: up.token, bucket: 'releases' }
    },
  }),
  PUBLISH_RELEASE: def({
    minRole: 'super_admin', limit: 'sensitive',
    parse: (r) => {
      const p = {
        version: r.str('version', { max: 11, pattern: SEMVER }), file_name: r.optStr('file_name', { max: 120, pattern: FILE_NAME }),
        sha256: r.str('sha256', { max: 64, min: 64, pattern: SHA256 }).toLowerCase(), size_bytes: r.int('size_bytes', { min: 1, max: 5_000_000_000 }),
        notes: r.optStr('notes', { max: 4000 }) ?? null, mandatory: r.optBool('mandatory', false),
      }
      r.done()
      return p
    },
    run: async (c, p) => {
      const path = releasePath(p.version as string, p.file_name as string | undefined)
      const actual = await authCall(() => c.deps.storage.objectSize(path))
      if (actual === null) throw new ApiError(422, 'file_not_uploaded', 'The installer is not in the releases bucket yet.')
      if (actual !== p.size_bytes) throw new ApiError(422, 'size_mismatch', 'The uploaded file size does not match the size you entered.')
      const url = `${c.deps.config.supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/releases/${path}`
      return c.write('admin_publish_release', { p_version: p.version, p_download_url: url, p_sha256: p.sha256, p_size_bytes: p.size_bytes, p_notes: p.notes, p_mandatory: p.mandatory })
    },
  }),
  UNPUBLISH_RELEASE: def({
    minRole: 'super_admin', limit: 'sensitive',
    parse: (r) => { const p = { p_version: r.str('version', { max: 11, pattern: SEMVER }) }; r.done(); return p },
    run: (c, p) => c.write('admin_unpublish_release', p),
  }),

  // ---------------------------------------------------------------- legal
  GET_LEGAL: def({ minRole: 'support', limit: 'read', parse: (r) => (r.done(), {}), run: (c) => c.read('admin_list_legal') }),
  PUBLISH_LEGAL: def({
    minRole: 'super_admin', limit: 'sensitive',
    parse: (r) => { const p = { p_version: r.str('version', { max: 20 }), p_sha256: r.str('sha256', { min: 64, max: 64, pattern: SHA256 }).toLowerCase(), p_title: r.optStr('title', { max: 200 }) ?? null }; r.done(); return p },
    run: (c, p) => c.write('admin_publish_legal', p),
  }),
  UNPUBLISH_LEGAL: def({
    minRole: 'super_admin', limit: 'sensitive',
    parse: (r) => { const p = { p_sha256: r.str('sha256', { min: 64, max: 64, pattern: SHA256 }).toLowerCase() }; r.literal('confirm', 'UNPUBLISH'); r.done(); return p },
    run: (c, p) => c.write('admin_unpublish_legal', p),
  }),

  // ---------------------------------------------------------------- audit log (read only)
  GET_AUDIT_LOG: def({
    minRole: 'admin', limit: 'read',
    parse: (r) => {
      const g = r.page()
      const p = {
        p_action: r.optStr('action', { max: 48, pattern: /^[A-Z][A-Z0-9_]{2,47}$/ }) ?? null, p_search: r.search() ?? null,
        p_target_user: r.optUuid('target_user_id') ?? null, p_admin_user: r.optUuid('admin_user_id') ?? null, p_limit: g.limit, p_offset: g.offset,
      }
      r.done()
      return p
    },
    run: (c, p) => c.read('admin_list_audit', p),
  }),

  // ---------------------------------------------------------------- admin management (super_admin)
  GET_ADMINS: def({
    minRole: 'super_admin', limit: 'read', parse: (r) => (r.done(), {}),
    run: async (c) => {
      const rows = (await c.read('admin_list_admins')) as Array<Record<string, unknown>>
      return Promise.all(rows.map(async (a) => ({ ...a, mfa_enrolled: await c.deps.hasVerifiedFactor(String(a.user_id)).catch(() => null) })))
    },
  }),
  ADD_ADMIN: def({
    minRole: 'super_admin', limit: 'sensitive',
    parse: (r) => { const p = { p_email: r.email('email'), p_role: r.oneOf('role', ROLES) }; r.done(); return p },
    run: (c, p) => c.write('admin_add_admin', p),
  }),
  SET_ADMIN: def({
    minRole: 'super_admin', limit: 'sensitive',
    parse: (r) => { const p = { p_user: r.uuid('user_id'), p_role: r.oneOf('role', ROLES), p_active: r.bool('active') }; r.done(); return p },
    run: (c, p) => c.write('admin_set_admin', p),
  }),
}

export function roleAllows(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min]
}

export function buildContext(admin: AdminIdentity, deps: Deps, req: RequestContext): ActionContext {
  const ctx = { ip: req.ip, user_agent: req.userAgent }
  const call = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await deps.rpc(fn, args)
    if (error) throw fromDbError(error)
    return data
  }
  return {
    admin, deps, req,
    read: (fn, args = {}) => call(fn, { p_admin: admin.userId, ...args }),
    write: (fn, args = {}) => call(fn, { p_admin: admin.userId, p_ctx: ctx, ...args }),
    audit: async (action, o = {}) => {
      await call('admin_audit_record', {
        p_admin: admin.userId, p_ctx: ctx, p_action: action, p_target_user: o.targetUser ?? null, p_resource_type: o.resourceType ?? null,
        p_resource_id: o.resourceId ?? null, p_metadata: o.metadata ?? {}, p_target_email: o.targetEmail ?? null,
      })
    },
  }
}
