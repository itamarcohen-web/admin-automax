'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox, Field, Input } from '@/components/ui/form'
import { useAuth } from '@/lib/auth'

export default function LoginPage() {
  const { state, signIn, verifyMfa, signOut } = useAuth()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => { if (state.status === 'ready') router.replace('/dashboard/') }, [state.status, router])

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) { setError('Enter your e-mail and password.'); return }
    setPending(true); setError(null)
    const err = await signIn(email, password, remember)
    setPending(false)
    setPassword('')
    if (err) setError(err)
  }
  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setPending(true); setError(null)
    const err = await verifyMfa(code)
    setPending(false)
    setCode('')
    if (err) setError(err)
  }

  const notice = state.status === 'signedOut' ? state.notice : undefined

  return (
    <main className="grid min-h-screen place-items-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" width={44} height={44} className="rounded-xl dark:invert" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">AutoMax Admin</h1>
            <p className="text-sm text-muted-foreground">Authorized administrators only</p>
          </div>
        </div>
        <Card>
          <CardContent>
            {state.status === 'mfa' ? (
              <form onSubmit={submitCode} className="grid gap-4" noValidate>
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
                  <div><h2 className="text-sm font-semibold">Two-factor verification</h2><p className="text-sm text-muted-foreground">Enter the 6-digit code from your authenticator app.</p></div>
                </div>
                <Field label="Authentication code" htmlFor="code" error={error}>
                  <Input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} aria-invalid={!!error} autoFocus />
                </Field>
                <Button type="submit" loading={pending} disabled={code.replace(/\s/g, '').length < 6}>Verify</Button>
                <Button variant="ghost" onClick={() => void signOut()}>Use a different account</Button>
              </form>
            ) : (
              <form onSubmit={submitPassword} className="grid gap-4" noValidate>
                {notice && !error && <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm">{notice}</p>}
                <Field label="Email" htmlFor="email">
                  <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus maxLength={254} />
                </Field>
                <Field label="Password" htmlFor="password" error={error}>
                  <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!error} maxLength={128} />
                </Field>
                <Checkbox id="remember" checked={remember} onChange={setRemember} label="Remember session on this device" />
                <Button type="submit" loading={pending || state.status === 'loading'}>Sign in</Button>
              </form>
            )}
          </CardContent>
        </Card>
        <p className="mt-4 text-center text-xs text-muted-foreground">Every action in this console is logged.</p>
      </div>
    </main>
  )
}
