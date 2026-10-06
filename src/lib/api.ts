import { readEnv } from './env'
import { supabase } from './supabase'

export class ApiRequestError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: Record<string, unknown>) {
    super(message)
  }
}

// Messages for the codes the Edge Function can return. Anything unknown becomes a neutral text: no raw server text is shown.
const FRIENDLY: Record<string, string> = {
  unauthenticated: 'Your session has ended. Please sign in again.',
  forbidden: 'You do not have permission for this action.',
  mfa_required: 'Two-factor verification is required. Sign in again and enter your code.',
  mfa_enrollment_required: 'Two-factor authentication is required: enable it in Settings first.',
  rate_limited: 'Too many requests. Please wait a moment and try again.',
  invalid_input: 'Some of the values are not valid.',
  email_taken: 'This e-mail (or another address of the same mailbox) is already registered.',
  email_disposable: 'Disposable e-mail domains are not allowed.',
  weak_password: 'The password must be 10–72 characters with upper-case, lower-case and a digit.',
  network: 'Cannot reach the server. Check your connection.',
}

/** an error whose message was written by this app (safe to show as is) */
export class UiError extends Error {}

export function describeError(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (e instanceof UiError) return e.message
  if (e instanceof ApiRequestError) {
    if (e.code === 'invalid_input') {
      const field = typeof e.details?.field === 'string' ? e.details.field : ''
      return field ? `Invalid value for “${field.replace(/_/g, ' ')}”.` : 'Some of the values are not valid.'
    }
    return FRIENDLY[e.code] ?? (e.message || fallback)
  }
  return fallback
}

/** One call into the admin-api Edge Function with the signed-in user's session token. */
export async function callApi<T>(action: string, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  const env = readEnv()
  if ('error' in env) throw new ApiRequestError(0, 'config', env.error)
  const { data } = await supabase().auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new ApiRequestError(401, 'unauthenticated', FRIENDLY.unauthenticated)

  let res: Response
  try {
    res = await fetch(`${env.supabaseUrl}/functions/v1/admin-api`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: env.anonKey },
      body: JSON.stringify({ action, params }),
      signal,
      cache: 'no-store',
      credentials: 'omit',
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new ApiRequestError(0, 'network', FRIENDLY.network)
  }

  let body: { ok?: boolean; data?: T; error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null = null
  try { body = await res.json() } catch { body = null }
  if (res.ok && body?.ok) return body.data as T

  const code = body?.error?.code ?? (res.status === 401 ? 'unauthenticated' : 'error')
  if (res.status === 401) window.dispatchEvent(new CustomEvent('amx-session-expired'))
  throw new ApiRequestError(res.status, code, body?.error?.message ?? FRIENDLY[code] ?? 'The request failed.', body?.error?.details)
}
