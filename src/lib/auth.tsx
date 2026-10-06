'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiRequestError, callApi } from './api'
import { readEnv } from './env'
import { setRemember, supabase } from './supabase'
import type { Me } from './types'

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut'; notice?: string }
  | { status: 'mfa'; factorId: string }
  | { status: 'ready'; me: Me }

interface AuthContextValue {
  state: AuthState
  signIn(email: string, password: string, remember: boolean): Promise<string | null>
  verifyMfa(code: string): Promise<string | null>
  signOut(notice?: string): Promise<void>
  refreshMe(): Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const v = useContext(AuthContext)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}

const ACTIVITY = ['pointerdown', 'keydown', 'scroll', 'visibilitychange'] as const

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => {
    const env = readEnv()
    return 'error' in env ? { status: 'signedOut', notice: env.error } : { status: 'loading' }
  })
  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state }, [state])

  const goSignedOut = useCallback((notice?: string) => setState({ status: 'signedOut', notice }), [])

  const signOut = useCallback(async (notice?: string) => {
    try {
      if (stateRef.current.status === 'ready') await callApi('LOG_LOGOUT').catch(() => undefined)
    } finally {
      try { await supabase().auth.signOut({ scope: 'local' }) } catch { /* session already gone */ }
      goSignedOut(notice)
    }
  }, [goSignedOut])

  // After the password (and, if enrolled, the TOTP code) is accepted: ask the server who we are. The server decides - not this code.
  const loadMe = useCallback(async (recordLogin: boolean): Promise<string | null> => {
    try {
      const me = await callApi<Me>('GET_ME')
      if (recordLogin) await callApi('LOG_LOGIN').catch(() => undefined)
      setState({ status: 'ready', me })
      return null
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === 'mfa_required') {
        const { data } = await supabase().auth.mfa.listFactors()
        const factor = data?.totp?.[0]
        if (factor) { setState({ status: 'mfa', factorId: factor.id }); return null }
      }
      if (e instanceof ApiRequestError && (e.status === 403 || e.status === 401)) {
        try { await supabase().auth.signOut({ scope: 'local' }) } catch { /* ignore */ }
        goSignedOut('This account does not have administrator access.')
        return 'This account does not have administrator access.'
      }
      goSignedOut('The console could not be reached. Please try again.')
      return 'The console could not be reached. Please try again.'
    }
  }, [goSignedOut])

  const afterPassword = useCallback(async (recordLogin: boolean): Promise<string | null> => {
    try {
      const { data } = await supabase().auth.mfa.getAuthenticatorAssuranceLevel()
      if (data && data.nextLevel === 'aal2' && data.currentLevel !== 'aal2') {
        const { data: f } = await supabase().auth.mfa.listFactors()
        const factor = f?.totp?.[0]
        if (factor) { setState({ status: 'mfa', factorId: factor.id }); return null }
      }
      return await loadMe(recordLogin)
    } catch (e) {
      console.error('admin session check failed:', e instanceof Error ? e.name : 'unknown error')   // name only: never log tokens or messages
      // a session that cannot even be inspected is not a session: start over
      try { await supabase().auth.signOut({ scope: 'local' }) } catch { /* ignore */ }
      goSignedOut('The session could not be verified. Please sign in again.')
      return 'The session could not be verified. Please sign in again.'
    }
  }, [loadMe, goSignedOut])

  // restore a saved session on page load
  useEffect(() => {
    const env = readEnv()
    if ('error' in env) return   // the initial state already shows the configuration error
    let cancelled = false
    void (async () => {
      const { data } = await supabase().auth.getSession()
      if (cancelled) return
      if (!data.session) { goSignedOut(); return }
      await afterPassword(false)
    })()
    const { data: sub } = supabase().auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' && stateRef.current.status !== 'signedOut') goSignedOut('You have been signed out.')
    })
    const expired = () => { void signOut('Your session has ended. Please sign in again.') }
    window.addEventListener('amx-session-expired', expired)
    return () => { cancelled = true; sub.subscription.unsubscribe(); window.removeEventListener('amx-session-expired', expired) }
  }, [afterPassword, goSignedOut, signOut])

  // idle timeout (client side convenience; the real session limits are Supabase Auth settings)
  useEffect(() => {
    if (state.status !== 'ready') return
    const env = readEnv()
    if ('error' in env) return
    let last = Date.now()
    const bump = () => { last = Date.now() }
    ACTIVITY.forEach((ev) => window.addEventListener(ev, bump, { passive: true }))
    const timer = window.setInterval(() => {
      if (Date.now() - last > env.idleMinutes * 60_000) void signOut('You were signed out after a period of inactivity.')
    }, 15_000)
    return () => { ACTIVITY.forEach((ev) => window.removeEventListener(ev, bump)); window.clearInterval(timer) }
  }, [state.status, signOut])

  const signIn = useCallback(async (email: string, password: string, remember: boolean) => {
    setRemember(remember)
    const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password })
    if (error) return 'Invalid e-mail or password.'   // never say which one, never echo server text
    return afterPassword(true)
  }, [afterPassword])

  const verifyMfa = useCallback(async (code: string) => {
    const s = stateRef.current
    if (s.status !== 'mfa') return 'Start again.'
    const { error } = await supabase().auth.mfa.challengeAndVerify({ factorId: s.factorId, code: code.replace(/\s+/g, '') })
    if (error) return 'That code is not valid. Try the current code from your authenticator app.'
    return loadMe(true)
  }, [loadMe])

  const refreshMe = useCallback(async () => { await loadMe(false) }, [loadMe])

  const value = useMemo(() => ({ state, signIn, verifyMfa, signOut, refreshMe }), [state, signIn, verifyMfa, signOut, refreshMe])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
