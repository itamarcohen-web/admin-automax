// Public configuration only. The two NEXT_PUBLIC_ values end up in the browser bundle by design; a service_role / secret key must
// never be placed in them (readEnv refuses to run with one, and scripts/scan-secrets.mjs fails the build).

export interface PublicEnv {
  supabaseUrl: string
  anonKey: string
  idleMinutes: number
}

function decodeJwtRole(key: string): string | null {
  const parts = key.split('.')
  if (parts.length !== 3) return null
  try {
    const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
    return (JSON.parse(json) as { role?: string }).role ?? null
  } catch {
    return null
  }
}

/** true when the key is something that must never be in a browser */
export function isSecretKey(key: string): boolean {
  return key.startsWith('sb_secret_') || decodeJwtRole(key) === 'service_role'
}

export function readEnv(): PublicEnv | { error: string } {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/+$/, '')
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim()
  if (!supabaseUrl || !anonKey) return { error: 'The console is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example).' }
  if (!/^https?:\/\//.test(supabaseUrl)) return { error: 'NEXT_PUBLIC_SUPABASE_URL is not a valid URL.' }
  if (isSecretKey(anonKey)) return { error: 'SECURITY: a secret/service_role key was supplied as the public key. Remove it and rotate that key in Supabase.' }
  const idle = Number(process.env.NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES ?? '30')
  return { supabaseUrl, anonKey, idleMinutes: Number.isFinite(idle) && idle >= 1 ? Math.min(idle, 480) : 30 }
}
