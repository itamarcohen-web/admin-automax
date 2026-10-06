'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { PageHeader } from '@/components/app/page'
import { Button } from '@/components/ui/button'
import { Alert, Card, CardContent } from '@/components/ui/card'
import { Checkbox, Field, Input, Select } from '@/components/ui/form'
import { ApiRequestError, callApi, describeError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { can, type Plan } from '@/lib/types'
import { useApi } from '@/lib/use-api'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function strong(p: string): boolean {
  return p.length >= 10 && p.length <= 72 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p)
}

export default function NewUserPage() {
  const { state } = useAuth()
  const role = state.status === 'ready' ? state.me.role : undefined
  const { data: plans } = useApi<Plan[]>('GET_PLANS')
  const [form, setForm] = useState({ email: '', full_name: '', password: '', plan: '', months: '1', confirmed: true })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }))

  if (!can(role, 'admin')) return <Alert tone="warning" title="Not available">Your role cannot create users.</Alert>

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (!EMAIL_RE.test(form.email.trim())) errs.email = 'Enter a valid e-mail address.'
    if (!strong(form.password)) errs.password = '10–72 characters, with an upper-case letter, a lower-case letter and a digit.'
    const months = Number(form.months)
    if (form.plan && (!Number.isInteger(months) || months < 1 || months > 36)) errs.months = 'Choose 1 to 36 months.'
    setErrors(errs); setFormError(null)
    if (Object.keys(errs).length) return
    setPending(true)
    try {
      const res = await callApi<{ user_id: string; warnings: string[] }>('CREATE_USER', {
        email: form.email.trim(), password: form.password, full_name: form.full_name.trim() || undefined,
        plan: form.plan || undefined, months: form.plan ? months : undefined, email_confirmed: form.confirmed,
      })
      toast.success(res.warnings.length ? 'User created, but the plan could not be applied. Set it on the user page.' : 'User created.')
      set({ password: '' })
      // a full page load on purpose: /users/<id>/ is served by the static shell page (see _redirects), not by client-side routing
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/users/${res.user_id}/`)
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'email_taken') setErrors({ email: describeError(err) })
      else if (err instanceof ApiRequestError && err.code === 'email_disposable') setErrors({ email: describeError(err) })
      else if (err instanceof ApiRequestError && err.code === 'weak_password') setErrors({ password: describeError(err) })
      else setFormError(describeError(err))
      setPending(false)
    }
  }

  return (
    <>
      <PageHeader title="New user" description="Creates the account on the server. The customer then signs in to the AutoMax app with these details." />
      <Card className="max-w-2xl">
        <CardContent>
          <form onSubmit={submit} className="grid gap-5" noValidate autoComplete="off">
            {formError && <Alert tone="danger">{formError}</Alert>}
            <Field label="Email" htmlFor="n-email" error={errors.email}>
              <Input id="n-email" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} aria-invalid={!!errors.email} maxLength={254} autoComplete="off" />
            </Field>
            <Field label="Full name" htmlFor="n-name" hint="Optional.">
              <Input id="n-name" value={form.full_name} onChange={(e) => set({ full_name: e.target.value })} maxLength={120} className="bidi" />
            </Field>
            <Field label="Password" htmlFor="n-pass" error={errors.password} hint="Shown only here. The customer can change it with “Forgot password”.">
              <Input id="n-pass" type="password" value={form.password} onChange={(e) => set({ password: e.target.value })} aria-invalid={!!errors.password} maxLength={72} autoComplete="new-password" />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Plan" htmlFor="n-plan" hint="Leave empty to create the account without a subscription.">
                <Select id="n-plan" value={form.plan} onChange={(e) => set({ plan: e.target.value })}>
                  <option value="">No plan</option>
                  {plans?.filter((p) => p.is_active).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
                </Select>
              </Field>
              <Field label="Months" htmlFor="n-months" error={errors.months}>
                <Input id="n-months" type="number" min={1} max={36} value={form.months} onChange={(e) => set({ months: e.target.value })} disabled={!form.plan} />
              </Field>
            </div>
            <Checkbox id="n-confirmed" checked={form.confirmed} onChange={(v) => set({ confirmed: v })} label="Email confirmed (the customer does not need to click a link)" />
            <div className="flex gap-3">
              <Button type="submit" loading={pending}>Create user</Button>
              <Button variant="outline" asChild><Link href="/users/">Cancel</Link></Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  )
}
