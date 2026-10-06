import { ApiError } from './types.ts'

// Public codes + messages. Nothing from the database (SQL text, table names, stack traces) is ever returned.
const KNOWN: Record<string, { status: number; message: string }> = {
  forbidden: { status: 403, message: 'You do not have permission for this action.' },
  not_found: { status: 404, message: 'Not found.' },
  user_not_found: { status: 404, message: 'No confirmed account with that e-mail.' },
  invalid_input: { status: 422, message: 'Invalid input.' },
  invalid_email: { status: 422, message: 'Invalid e-mail address.' },
  invalid_version: { status: 422, message: 'Version must look like 1.2.3.' },
  invalid_download_url: { status: 422, message: 'Invalid download address.' },
  unknown_plan: { status: 422, message: 'Unknown or inactive plan.' },
  plan_required: { status: 422, message: 'Choose a plan: this user has no subscription yet.' },
  no_subscription: { status: 409, message: 'This user has no subscription. Use Extend to start one.' },
  nothing_to_cancel: { status: 409, message: 'There is no running subscription to cancel.' },
  period_ended: { status: 409, message: 'The paid period has ended. Use Extend instead.' },
  lifetime_account: { status: 409, message: 'This account has a lifetime grant. Revoke it from the Talent page first.' },
  cannot_target_self: { status: 409, message: 'You cannot do this to your own account.' },
  target_is_admin: { status: 409, message: 'This account is an admin. Deactivate the admin role first.' },
  last_super_admin: { status: 409, message: 'There must always be one active super admin.' },
}

/** Maps a PostgREST/Postgres error to a safe ApiError. Unknown errors become a generic 500. */
export function fromDbError(err: { code?: string; message?: string } | null | undefined): ApiError {
  const msg = String(err?.message ?? '')
  const m = /^admin:([a-z_]+)/.exec(msg)
  if (m) {
    const k = KNOWN[m[1]]
    if (k) return new ApiError(k.status, m[1], k.message)
  }
  if (err?.code === '42501') return new ApiError(403, 'forbidden', KNOWN.forbidden.message)
  // messages raised by the EXISTING business functions (apply_payment, grant_talent, ...)
  if (/lifetime grant/i.test(msg)) return new ApiError(409, 'lifetime_account', KNOWN.lifetime_account.message)
  if (/unknown plan/i.test(msg)) return new ApiError(422, 'unknown_plan', KNOWN.unknown_plan.message)
  if (/no user with e-mail/i.test(msg)) return new ApiError(404, 'user_not_found', KNOWN.user_not_found.message)
  if (/invalid e-mail/i.test(msg)) return new ApiError(422, 'invalid_email', KNOWN.invalid_email.message)
  if (/months must be/i.test(msg)) return new ApiError(422, 'invalid_input', KNOWN.invalid_input.message)
  return new ApiError(500, 'operation_failed', 'The operation could not be completed.')
}
