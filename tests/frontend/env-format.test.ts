import { afterEach, describe, expect, it, vi } from 'vitest'
import { isSecretKey, readEnv } from '@/lib/env'
import { fmtBytes, fmtMoney, fullName, isUuid } from '@/lib/format'
import { can } from '@/lib/types'

const jwt = (payload: object) => `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.c2ln`

describe('public environment', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('refuses a service_role JWT and an sb_secret key as the browser key', () => {
    expect(isSecretKey(jwt({ role: 'service_role' }))).toBe(true)
    expect(isSecretKey('sb_secret_abcdefghijklmnopqrstuvwxyz')).toBe(true)
    expect(isSecretKey(jwt({ role: 'anon' }))).toBe(false)
    expect(isSecretKey('sb_publishable_abcdefghijklmnop')).toBe(false)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abc.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', jwt({ role: 'service_role' }))
    expect(readEnv()).toHaveProperty('error')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'sb_secret_abcdefghijklmnopqrstuvwxyz')
    expect(readEnv()).toHaveProperty('error')
  })
  it('accepts a publishable key and clamps the idle timeout', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abc.supabase.co/')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'sb_publishable_abcdefghijklmnop')
    vi.stubEnv('NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES', '99999')
    expect(readEnv()).toEqual({ supabaseUrl: 'https://abc.supabase.co', anonKey: 'sb_publishable_abcdefghijklmnop', idleMinutes: 480 })
  })
  it('reports a missing configuration instead of crashing', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
    expect(readEnv()).toHaveProperty('error')
  })
})

describe('formatting helpers', () => {
  it('formats money from the smallest unit', () => {
    expect(fmtMoney(4900, 'ILS')).toMatch(/49\.00/)
    expect(fmtMoney(null)).toBe('—')
  })
  it('formats sizes and names', () => {
    expect(fmtBytes(48_000_000)).toBe('45.8 MB')
    expect(fullName('Dana', 'Cohen', 'Studio')).toBe('Studio (Dana Cohen)')
    expect(fullName(null, null, null)).toBe('—')
  })
  it('recognises uuids only', () => {
    expect(isUuid('00000000-0000-4000-8000-000000000100')).toBe(true)
    expect(isUuid('../../etc/passwd')).toBe(false)
    expect(isUuid('_')).toBe(false)
  })
  it('role helper', () => {
    expect(can('support', 'admin')).toBe(false)
    expect(can('super_admin', 'admin')).toBe(true)
    expect(can(undefined, 'support')).toBe(false)
  })
})
