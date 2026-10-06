// admin-api request pipeline (runtime neutral: only Web-standard Request/Response):
//   CORS/origin -> POST+JSON -> body size -> action allow-list -> JWT -> admin_users (active, role) -> MFA -> rate limit
//   -> role vs action -> strict param validation -> implementation (SQL admin_* functions) -> sanitized response.
import { ACTIONS, buildContext, roleAllows } from './actions.ts'
import { fromDbError } from './errors.ts'
import { ApiError } from './types.ts'
import type { AdminIdentity, Deps, RequestContext, Role } from './types.ts'
import { reader, ValidationError } from './validate.ts'

const MAX_BODY_BYTES = 32 * 1024
const LIMITS: Record<string, { max: number; windowSeconds: number }> = {
  read: { max: 300, windowSeconds: 60 },
  write: { max: 60, windowSeconds: 60 },
  sensitive: { max: 15, windowSeconds: 600 },
}

function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
  if (origin && allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin
  return h
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra },
  })
}

function fail(e: ApiError, extra: Record<string, string>): Response {
  return json(e.status, { ok: false, error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } }, extra)
}

export function requestContext(req: Request): RequestContext {
  const ip = (req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null
  return { ip: ip ? ip.slice(0, 64) : null, userAgent: (req.headers.get('user-agent') ?? '').slice(0, 300) || null }
}

function bearer(req: Request): string | null {
  const h = req.headers.get('authorization') ?? ''
  const m = /^Bearer\s+([A-Za-z0-9._~+/=-]{20,4096})$/.exec(h)
  return m ? m[1] : null
}

async function readBody(req: Request): Promise<unknown> {
  const len = Number(req.headers.get('content-length') ?? '0')
  if (len > MAX_BODY_BYTES) throw new ApiError(413, 'too_large', 'Request too large.')
  const text = await req.text()
  if (text.length > MAX_BODY_BYTES) throw new ApiError(413, 'too_large', 'Request too large.')
  try {
    return JSON.parse(text)
  } catch {
    throw new ApiError(400, 'bad_json', 'The request body must be JSON.')
  }
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const origin = req.headers.get('origin')
  const cors = corsHeaders(origin, deps.config.allowedOrigins)

  // Browsers only: a foreign website must not be able to drive the API with a stolen token. (Non-browser clients send no Origin.)
  if (origin && !deps.config.allowedOrigins.includes(origin)) return fail(new ApiError(403, 'forbidden', 'Origin not allowed.'), {})
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return fail(new ApiError(405, 'method_not_allowed', 'Use POST.'), cors)

  const rc = requestContext(req)
  let actionName = 'unknown'
  let userId: string | null = null
  try {
    if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) throw new ApiError(415, 'unsupported_media_type', 'Use application/json.')
    const body = await readBody(req)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'bad_request', 'Invalid request.')
    const { action, params, ...rest } = body as Record<string, unknown>
    if (Object.keys(rest).length) throw new ApiError(400, 'bad_request', 'Invalid request.')
    if (typeof action !== 'string' || action.length > 64) throw new ApiError(400, 'bad_request', 'Invalid request.')
    actionName = action

    // 1. authentication: the JWT belongs to a real, current session
    const jwt = bearer(req)
    if (!jwt) throw new ApiError(401, 'unauthenticated', 'Sign in required.')
    const token = await deps.verifyToken(jwt)
    if (!token) throw new ApiError(401, 'unauthenticated', 'Sign in required.')
    userId = token.userId

    // 2. admin authorization from the database (never from the e-mail, a header or anything the client controls)
    const who = await deps.rpc('admin_whoami', { p_user: token.userId })
    const row = who.error ? null : (who.data as { role?: Role; is_active?: boolean; email?: string } | null)
    if (who.error) throw new ApiError(503, 'unavailable', 'Service temporarily unavailable.')
    if (!row || row.is_active !== true || !row.role) {
      await deny(deps, token.userId, rc, action, 'not_admin')
      throw new ApiError(403, 'forbidden', 'You do not have permission for this action.')
    }
    const admin: AdminIdentity = { userId: token.userId, email: row.email ?? token.email, role: row.role }

    // the action must be on the allow-list (only an authenticated admin learns whether a name exists)
    if (!Object.hasOwn(ACTIONS, action)) throw new ApiError(400, 'unknown_action', 'Unknown action.')
    const def = ACTIONS[action]

    // 3. MFA: an admin who has a verified TOTP factor must present an aal2 session; and if the project requires MFA, one must exist
    const enrolled = await deps.hasVerifiedFactor(admin.userId)
    if (enrolled && token.aal !== 'aal2') {
      await deny(deps, admin.userId, rc, action, 'mfa_required')
      throw new ApiError(403, 'mfa_required', 'Two-factor verification is required.')
    }
    if (!enrolled && deps.config.requireMfa && !def.allowWithoutMfa) {
      throw new ApiError(403, 'mfa_enrollment_required', 'Enable two-factor authentication in Settings first.')
    }

    // 4. server-side rate limit per admin and class
    const lim = LIMITS[def.limit]
    const allowed = await deps.rpc('admin_rate_hit', { p_bucket: `api:${admin.userId}:${def.limit}`, p_limit: lim.max, p_window_seconds: lim.windowSeconds })
    if (allowed.error) throw new ApiError(503, 'unavailable', 'Service temporarily unavailable.')
    if (allowed.data !== true) throw new ApiError(429, 'rate_limited', 'Too many requests. Try again in a moment.')

    // 5. role vs action
    if (!roleAllows(admin.role, def.minRole)) {
      await deny(deps, admin.userId, rc, action, 'role_too_low')
      throw new ApiError(403, 'forbidden', 'You do not have permission for this action.')
    }

    // 6. strict validation, 7. execution
    let parsed: Record<string, unknown>
    try {
      parsed = def.parse(reader(params))
    } catch (e) {
      if (e instanceof ValidationError) throw new ApiError(422, 'invalid_input', 'Invalid input.', { field: e.field, reason: e.reason })
      throw e
    }
    const data = await def.run(buildContext(admin, deps, rc), parsed)
    return json(200, { ok: true, data }, cors)
  } catch (e) {
    const api = e instanceof ApiError ? e : fromDbError(null)
    deps.log('request_failed', { action: actionName, status: api.status, code: api.code, user: userId })
    return fail(api, cors)
  }
}

async function deny(deps: Deps, userId: string, rc: RequestContext, action: string, reason: string): Promise<void> {
  try {
    await deps.rpc('admin_audit_denied', { p_user: userId, p_ctx: { ip: rc.ip, user_agent: rc.userAgent }, p_action: action, p_reason: reason })
  } catch {
    // logging a refusal must never turn into an error that leaks information
  }
}
