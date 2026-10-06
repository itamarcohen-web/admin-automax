// @vitest-environment jsdom
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { ApiRequestError } from '@/lib/api'
import { AuthProvider, useAuth } from '@/lib/auth'

const h = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  getSession: vi.fn(),
  getAal: vi.fn(),
  listFactors: vi.fn(),
  challengeAndVerify: vi.fn(),
  callApi: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({
  setRemember: vi.fn(),
  supabase: () => ({
    auth: {
      signInWithPassword: h.signInWithPassword,
      signOut: h.signOut,
      getSession: h.getSession,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      mfa: { getAuthenticatorAssuranceLevel: h.getAal, listFactors: h.listFactors, challengeAndVerify: h.challengeAndVerify },
    },
  }),
}))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), callApi: h.callApi }))
vi.mock('@/lib/env', () => ({ readEnv: () => ({ supabaseUrl: 'https://x.supabase.co', anonKey: 'sb_publishable_x', idleMinutes: 30 }) }))

const holder: { ctx: ReturnType<typeof useAuth> } = { ctx: undefined as unknown as ReturnType<typeof useAuth> }
const ctx = new Proxy({} as ReturnType<typeof useAuth>, { get: (_t, k) => (holder.ctx as never)[k] })
function Probe() {
  const auth = useAuth()
  useEffect(() => { holder.ctx = auth })
  return <p data-testid="s">{auth.state.status}{auth.state.status === 'signedOut' ? `:${auth.state.notice ?? ''}` : ''}</p>
}
const mount = () => render(<AuthProvider><Probe /></AuthProvider>)
const ME = { user_id: 'u1', email: 'owner@auto-max.co.il', role: 'super_admin', mfa_enrolled: false, mfa_required: false }
const status = () => screen.getByTestId('s')

beforeEach(() => {
  vi.clearAllMocks()
  h.signOut.mockResolvedValue({})
  h.getSession.mockResolvedValue({ data: { session: null } })
  h.getAal.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal1' } })
  h.listFactors.mockResolvedValue({ data: { totp: [] } })
})

describe('admin sign-in', () => {
  it('starts signed out when there is no session', async () => {
    mount()
    await waitFor(() => expect(status()).toHaveTextContent('signedOut'))
    expect(h.callApi).not.toHaveBeenCalled()
  })
  it('wrong password: generic message, no server text', async () => {
    h.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials: user not found in table auth.users' } })
    mount()
    await waitFor(() => expect(status()).toHaveTextContent('signedOut'))
    let msg: string | null = null
    await act(async () => { msg = await ctx.signIn('a@b.co', 'x', false) })
    expect(msg).toBe('Invalid e-mail or password.')
    expect(h.callApi).not.toHaveBeenCalled()
  })
  it('a valid account that is NOT an admin is refused and its session is dropped', async () => {
    h.signInWithPassword.mockResolvedValue({ error: null })
    h.callApi.mockRejectedValue(new ApiRequestError(403, 'forbidden', 'x'))
    mount()
    await waitFor(() => expect(status()).toHaveTextContent('signedOut'))
    let msg: string | null = null
    await act(async () => { msg = await ctx.signIn('customer@example.com', 'pw', false) })
    expect(msg).toBe('This account does not have administrator access.')
    expect(h.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(status()).toHaveTextContent('signedOut')
    expect(h.callApi).not.toHaveBeenCalledWith('LOG_LOGIN')
  })
  it('an admin gets in; the role comes from the server and the login is recorded', async () => {
    h.signInWithPassword.mockResolvedValue({ error: null })
    h.callApi.mockImplementation(async (a: string) => (a === 'GET_ME' ? ME : { ok: true }))
    mount()
    await waitFor(() => expect(status()).toHaveTextContent('signedOut'))
    await act(async () => { await ctx.signIn('owner@auto-max.co.il', 'pw', true) })
    expect(status()).toHaveTextContent('ready')
    expect(h.callApi).toHaveBeenCalledWith('GET_ME')
    expect(h.callApi).toHaveBeenCalledWith('LOG_LOGIN')
  })
  it('an enrolled admin must pass the TOTP step before the console loads', async () => {
    h.signInWithPassword.mockResolvedValue({ error: null })
    h.getAal.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal2' } })
    h.listFactors.mockResolvedValue({ data: { totp: [{ id: 'f1' }] } })
    h.challengeAndVerify.mockResolvedValue({ error: null })
    h.callApi.mockImplementation(async (a: string) => (a === 'GET_ME' ? ME : { ok: true }))
    mount()
    await waitFor(() => expect(status()).toHaveTextContent('signedOut'))
    await act(async () => { await ctx.signIn('owner@auto-max.co.il', 'pw', false) })
    expect(status()).toHaveTextContent('mfa')
    expect(h.callApi).not.toHaveBeenCalled()
    h.challengeAndVerify.mockResolvedValueOnce({ error: { message: 'bad' } })
    let msg: string | null = null
    await act(async () => { msg = await ctx.verifyMfa('000000') })
    expect(msg).toMatch(/not valid/)
    await act(async () => { await ctx.verifyMfa('123 456') })
    expect(h.challengeAndVerify).toHaveBeenLastCalledWith({ factorId: 'f1', code: '123456' })
    expect(status()).toHaveTextContent('ready')
  })
  it('logout clears the session and records the logout', async () => {
    h.signInWithPassword.mockResolvedValue({ error: null })
    h.callApi.mockImplementation(async (a: string) => (a === 'GET_ME' ? ME : { ok: true }))
    mount()
    await waitFor(() => expect(status()).toHaveTextContent('signedOut'))
    await act(async () => { await ctx.signIn('owner@auto-max.co.il', 'pw', false) })
    await act(async () => { await ctx.signOut() })
    expect(h.callApi).toHaveBeenCalledWith('LOG_LOGOUT')
    expect(h.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(status()).toHaveTextContent('signedOut')
  })
  it('a stored session that the server no longer accepts sends the user back to the login', async () => {
    h.getSession.mockResolvedValue({ data: { session: { access_token: 'x' } } })
    h.callApi.mockRejectedValue(new ApiRequestError(401, 'unauthenticated', 'x'))
    mount()
    await waitFor(() => expect(status()).toHaveTextContent('signedOut'))
  })
})
