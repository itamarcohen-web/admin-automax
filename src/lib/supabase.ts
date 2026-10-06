import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readEnv } from './env'

// "Remember session": the official Supabase session is stored in localStorage (stays after closing the browser) or, when the box is
// not ticked, in sessionStorage (gone with the tab). The choice itself is a harmless flag. Tokens are never copied anywhere else.
const REMEMBER_KEY = 'amx-admin-remember'

function area(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : localStorage.getItem(REMEMBER_KEY) === '0' ? sessionStorage : localStorage
  } catch {
    return null
  }
}

const storage = {
  getItem: (k: string): string | null => {
    try {
      return area()?.getItem(k) ?? (typeof window === 'undefined' ? null : (sessionStorage.getItem(k) ?? localStorage.getItem(k)))
    } catch {
      return null
    }
  },
  setItem: (k: string, v: string): void => {
    try { area()?.setItem(k, v) } catch { /* storage blocked: the session just will not persist */ }
  },
  removeItem: (k: string): void => {
    try { localStorage.removeItem(k); sessionStorage.removeItem(k) } catch { /* ignore */ }
  },
}

export function setRemember(remember: boolean): void {
  try { localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0') } catch { /* ignore */ }
}

let client: SupabaseClient | null = null

export function supabase(): SupabaseClient {
  if (client) return client
  const env = readEnv()
  if ('error' in env) throw new Error(env.error)
  client = createClient(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce', storage, storageKey: 'amx-admin-auth' },
  })
  return client
}
