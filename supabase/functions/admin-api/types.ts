// Shared types of the admin-api Edge Function. Pure TypeScript: no Deno- or Node-specific imports.

export type Role = 'support' | 'admin' | 'super_admin'
export const ROLE_RANK: Record<Role, number> = { support: 1, admin: 2, super_admin: 3 }

export interface AdminIdentity {
  userId: string
  email: string | null
  role: Role
}

export interface RpcResult {
  data: unknown
  error: { code?: string; message?: string } | null
}

export interface TokenInfo {
  userId: string
  email: string | null
  /** authenticator assurance level claim of the (already verified) access token: 'aal1' | 'aal2' */
  aal: string | null
}

export class AuthAdminError extends Error {
  constructor(public kind: 'email_exists' | 'weak_password' | 'not_found' | 'rejected' | 'unavailable') {
    super(kind)
  }
}

/** Everything the handler needs from the outside world. index.ts wires the real Supabase clients; tests pass fakes. */
export interface Deps {
  config: {
    allowedOrigins: string[]
    /** when true, every admin must have a verified TOTP factor; without one only GET_ME works (so the UI can lead to enrolment) */
    requireMfa: boolean
    supabaseUrl: string
    passwordResetRedirect?: string
    maxReleaseBytes: number
  }
  /** validates the JWT with Supabase Auth; null = invalid/expired */
  verifyToken(jwt: string): Promise<TokenInfo | null>
  /** service_role RPC (PostgREST). Only ever called with allow-listed function names. */
  rpc(fn: string, args: Record<string, unknown>): Promise<RpcResult>
  hasVerifiedFactor(userId: string): Promise<boolean>
  auth: {
    createUser(a: { email: string; password: string; emailConfirm: boolean; fullName?: string }): Promise<{ id: string }>
    getEmail(userId: string): Promise<string | null>
    updateEmail(userId: string, email: string): Promise<void>
    setBanned(userId: string, banned: boolean): Promise<void>
    deleteUser(userId: string): Promise<void>
    sendPasswordReset(email: string, redirectTo?: string): Promise<void>
  }
  storage: {
    createSignedUpload(path: string, upsert: boolean): Promise<{ token: string; path: string }>
    /** size in bytes of an object in the releases bucket, or null when it does not exist */
    objectSize(path: string): Promise<number | null>
  }
  /** sanitized structured log line (never pass tokens, passwords or request bodies) */
  log(event: string, data?: Record<string, string | number | boolean | null>): void
}

export interface RequestContext {
  ip: string | null
  userAgent: string | null
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string, public details?: Record<string, unknown>) {
    super(message ?? code)
  }
}
