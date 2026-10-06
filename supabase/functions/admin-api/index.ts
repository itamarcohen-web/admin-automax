// Supabase Edge Function entry point (Deno). Wires the real Supabase clients into the runtime-neutral handler in core.ts.
// Secrets (service role / secret key) exist ONLY here, as Edge Function environment variables. They are never returned,
// logged or sent to a browser.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { handle } from './core.ts'
import { AuthAdminError } from './types.ts'
import type { Deps, TokenInfo } from './types.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
// SUPABASE_SERVICE_ROLE_KEY is injected by Supabase. If you use the new secret keys, set ADMIN_SERVICE_KEY (an sb_secret_... key) instead.
const SERVICE_KEY = Deno.env.get('ADMIN_SERVICE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
if (!SUPABASE_URL || !SERVICE_KEY) console.error('admin-api: SUPABASE_URL / service key are not configured')

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })

const origins = (Deno.env.get('ADMIN_ALLOWED_ORIGINS') ?? 'https://admin.auto-max.co.il').split(',').map((s) => s.trim()).filter(Boolean)

function b64urlJson(part: string): Record<string, unknown> | null {
  try {
    const pad = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')
    return JSON.parse(atob(pad))
  } catch {
    return null
  }
}

const deps: Deps = {
  config: {
    allowedOrigins: origins,
    requireMfa: (Deno.env.get('ADMIN_REQUIRE_MFA') ?? 'false').toLowerCase() === 'true',
    supabaseUrl: SUPABASE_URL,
    passwordResetRedirect: Deno.env.get('PASSWORD_RESET_REDIRECT') || undefined,
    maxReleaseBytes: Number(Deno.env.get('RELEASE_MAX_BYTES') ?? 50 * 1024 * 1024),
  },

  async verifyToken(jwt: string): Promise<TokenInfo | null> {
    const { data, error } = await db.auth.getUser(jwt)   // validated by Supabase Auth (signature, expiry, session still alive)
    if (error || !data.user) return null
    const claims = b64urlJson(jwt.split('.')[1] ?? '')
    return { userId: data.user.id, email: data.user.email ?? null, aal: typeof claims?.aal === 'string' ? claims.aal : null }
  },

  async rpc(fn, args) {
    const { data, error } = await db.rpc(fn, args)
    return { data, error: error ? { code: error.code, message: error.message } : null }
  },

  async hasVerifiedFactor(userId) {
    const { data, error } = await db.auth.admin.mfa.listFactors({ userId })
    if (error) throw new AuthAdminError('unavailable')
    return (data?.factors ?? []).some((f) => f.factor_type === 'totp' && f.status === 'verified')
  },

  auth: {
    async createUser({ email, password, emailConfirm, fullName }) {
      const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: emailConfirm, user_metadata: fullName ? { full_name: fullName } : {} })
      if (error || !data.user) {
        const code = (error as { code?: string } | null)?.code ?? ''
        if (code === 'email_exists' || code === 'user_already_exists') throw new AuthAdminError('email_exists')
        if (code === 'weak_password') throw new AuthAdminError('weak_password')
        throw new AuthAdminError('rejected')
      }
      return { id: data.user.id }
    },
    async getEmail(userId) {
      const { data, error } = await db.auth.admin.getUserById(userId)
      if (error) throw new AuthAdminError('not_found')
      return data.user?.email ?? null
    },
    async updateEmail(userId, email) {
      const { error } = await db.auth.admin.updateUserById(userId, { email, email_confirm: true })
      if (error) throw new AuthAdminError((error as { code?: string }).code === 'email_exists' ? 'email_exists' : 'rejected')
    },
    async setBanned(userId, banned) {
      const { error } = await db.auth.admin.updateUserById(userId, { ban_duration: banned ? '876000h' : 'none' })
      if (error) throw new AuthAdminError('rejected')
    },
    async deleteUser(userId) {
      const { error } = await db.auth.admin.deleteUser(userId)   // hard delete; payments were archived by admin_prepare_user_deletion first
      if (error) throw new AuthAdminError('rejected')
    },
    async sendPasswordReset(email, redirectTo) {
      const { error } = await db.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined)
      if (error) throw new AuthAdminError('rejected')
    },
  },

  storage: {
    async createSignedUpload(path, upsert) {
      const { data, error } = await db.storage.from('releases').createSignedUploadUrl(path, { upsert })
      if (error || !data) throw new AuthAdminError('rejected')
      return { token: data.token, path: data.path }
    },
    async objectSize(path) {
      const { data, error } = await db.storage.from('releases').info(path)
      if (error || !data) return null
      return typeof data.size === 'number' ? data.size : null
    },
  },

  log(event, data) {
    // single JSON line; only the values the handler passes (action, status, code, user id) - never tokens or bodies
    console.log(JSON.stringify({ event, ...data }))
  },
}

Deno.serve((req) => handle(req, deps))
