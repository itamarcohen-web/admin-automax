'use client'

import { useState } from 'react'
import { ActionDialog } from '@/components/app/action-dialog'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form'
import { callApi } from '@/lib/api'
import type { Plan } from '@/lib/types'

export type Dlg = 'name' | 'plan' | 'extend' | 'lifetime' | 'cancel' | 'reactivate' | 'talent' | 'revoke' | 'disable' | 'enable' | 'reset' | 'email' | 'delete' | { device: string; name: string | null } | null

export function UserDialogs({ dlg, close, userId, email, initialName = '', currentPlan, plans, onDone }: {
  dlg: Dlg
  close: (o: boolean) => void
  userId: string
  email: string
  initialName?: string
  /** plan code of the current subscription (undefined = the user has none) */
  currentPlan: string | undefined
  plans: Plan[]
  onDone: () => void
}) {
  const sub = currentPlan ? { plan_code: currentPlan } : undefined
  const mutate = (action: string, params: Record<string, unknown>) => () => callApi(action, { user_id: userId, ...params })
  const active = plans.filter((p) => p.is_active)
  const [fullName, setFullName] = useState(initialName)
  const [plan, setPlan] = useState(sub?.plan_code ?? '')
  const [months, setMonths] = useState('1')
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [immediate, setImmediate] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [grantMonths, setGrantMonths] = useState('6')
  const [grantLifetime, setGrantLifetime] = useState(false)
  const valid = (v: string, max: number) => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= max
  const target = <span className="font-medium">{email}</span>
  const open = (k: Exclude<Dlg, null | { device: string; name: string | null }>) => dlg === k

  return (
    <>
      <ActionDialog open={open('name')} onOpenChange={close} title="Edit name" description={<>Display name stored on the profile of {target}.</>} confirmLabel="Save" successMessage="Name saved." onDone={onDone}
        onSubmit={mutate('UPDATE_USER', { full_name: fullName.trim() || undefined })}>
        <Field label="Full name" htmlFor="d-name"><Input id="d-name" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={120} className="bidi" /></Field>
      </ActionDialog>

      <ActionDialog open={open('plan')} onOpenChange={close} title="Change plan" confirmLabel="Change plan" successMessage="Plan changed." onDone={onDone} canSubmit={!!plan && plan !== sub?.plan_code}
        description={<>Moves the current subscription of {target} to another plan. The paid period does not change. If the new plan allows fewer computers, existing devices are kept but no new ones can be added until some are removed.</>}
        onSubmit={mutate('CHANGE_PLAN', { plan })}>
        <Field label="New plan" htmlFor="d-plan"><Select id="d-plan" value={plan} onChange={(e) => setPlan(e.target.value)}>{active.map((p) => <option key={p.code} value={p.code}>{p.name} · {p.max_devices} device(s)</option>)}</Select></Field>
      </ActionDialog>

      <ActionDialog open={open('extend')} onOpenChange={close} title="Extend subscription" confirmLabel="Extend" successMessage="Subscription extended." onDone={onDone} canSubmit={valid(months, 36) && (!!sub || !!plan)}
        description={<>Adds paid months to {target}, after the current period (no days are lost). A 0-amount “manual” entry is recorded in the payment history, like the existing manual grants.</>}
        onSubmit={mutate('EXTEND_SUBSCRIPTION', { plan: plan || undefined, months: Number(months), note: note.trim() || undefined })}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Plan" htmlFor="d-eplan"><Select id="d-eplan" value={plan} onChange={(e) => setPlan(e.target.value)}>{!sub && <option value="">Choose…</option>}{active.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</Select></Field>
          <Field label="Months (1–36)" htmlFor="d-months"><Input id="d-months" type="number" min={1} max={36} value={months} onChange={(e) => setMonths(e.target.value)} /></Field>
        </div>
        <Field label="Note (optional)" htmlFor="d-note"><Input id="d-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className="bidi" /></Field>
      </ActionDialog>

      <ActionDialog open={open('lifetime')} onOpenChange={close} title="Grant lifetime access" confirmLabel="Grant lifetime" typed="LIFETIME" successMessage="Lifetime access granted." onDone={onDone}
        description={<>{target} gets the Talent plan <strong>for life</strong> (no expiry, up to 2 computers). It replaces the current subscription. Use “Revoke Talent” to take it away.</>}
        onSubmit={mutate('GRANT_LIFETIME', { note: note.trim() || undefined })}>
        <Field label="Note (optional)" htmlFor="d-lnote"><Input id="d-lnote" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className="bidi" /></Field>
      </ActionDialog>

      <ActionDialog open={open('cancel')} onOpenChange={close} title="Cancel subscription" confirmLabel={immediate ? 'Cancel now' : 'Cancel at period end'} destructive successMessage="Subscription canceled." onDone={onDone}
        description={<>{immediate ? <>The licence of {target} stops <strong>immediately</strong>.</> : <>{target} keeps the licence until the paid period ends, then it is not renewed.</>}</>}
        onSubmit={mutate('CANCEL_SUBSCRIPTION', { immediate })}>
        <Checkbox id="d-imm" checked={immediate} onChange={setImmediate} label="Stop access immediately instead of at the end of the period" />
      </ActionDialog>

      <ActionDialog open={open('reactivate')} onOpenChange={close} title="Reactivate subscription" confirmLabel="Reactivate" successMessage="Subscription reactivated." onDone={onDone}
        description={<>Removes the pending cancellation, or revives a canceled subscription whose paid period has not ended yet, for {target}. If the period already ended use “Extend”.</>}
        onSubmit={mutate('REACTIVATE_SUBSCRIPTION', {})} />

      <ActionDialog open={open('talent')} onOpenChange={close} title="Grant Talent" confirmLabel="Grant" successMessage="Talent access granted." onDone={onDone} canSubmit={grantLifetime || valid(grantMonths, 120)}
        description={<>Free access for {target}: the Talent plan for a number of months, or for life. Months are added after any running period.</>}
        onSubmit={() => callApi('GRANT_TALENT', { email, months: grantLifetime ? undefined : Number(grantMonths), lifetime: grantLifetime, note: note.trim() || undefined })}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Months (1–120)" htmlFor="d-gm"><Input id="d-gm" type="number" min={1} max={120} value={grantMonths} onChange={(e) => setGrantMonths(e.target.value)} disabled={grantLifetime} /></Field>
          <div className="flex items-end pb-1.5"><Checkbox id="d-gl" checked={grantLifetime} onChange={setGrantLifetime} label="Lifetime" /></div>
        </div>
        <Field label="Note (optional)" htmlFor="d-gn"><Input id="d-gn" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className="bidi" /></Field>
      </ActionDialog>

      <ActionDialog open={open('revoke')} onOpenChange={close} title="Revoke Talent" confirmLabel="Revoke" destructive successMessage="Talent access revoked." onDone={onDone}
        description={<>Takes the free Talent access away from {target}: any subscription granted as Talent is canceled right away. Paid subscriptions of other providers are not touched.</>}
        onSubmit={() => callApi('REVOKE_TALENT', { email })} />

      <ActionDialog open={open('disable')} onOpenChange={close} title="Disable account" confirmLabel="Disable account" destructive successMessage="Account disabled." onDone={onDone}
        description={<>{target} will no longer be able to sign in or use the software. All data (subscription, payments, devices) is kept. You can enable the account again at any time. This is safer than deleting.</>}
        onSubmit={mutate('DISABLE_USER', { reason: reason.trim() || undefined })}>
        <Field label="Reason (optional, visible to admins)" htmlFor="d-reason"><Textarea id="d-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className="bidi" /></Field>
      </ActionDialog>

      <ActionDialog open={open('enable')} onOpenChange={close} title="Enable account" confirmLabel="Enable account" successMessage="Account enabled." onDone={onDone}
        description={<>{target} will be able to sign in and use the software again, according to the subscription.</>} onSubmit={mutate('ENABLE_USER', {})} />

      <ActionDialog open={open('reset')} onOpenChange={close} title="Reset password" confirmLabel="Send reset e-mail" successMessage="Reset e-mail sent." onDone={onDone}
        description={<>Sends a password-reset e-mail to {target}. You never see the link or a password.</>} onSubmit={mutate('RESET_PASSWORD', {})} />

      <ActionDialog open={open('email')} onOpenChange={close} title="Change email" confirmLabel="Change email" successMessage="E-mail changed." onDone={onDone} canSubmit={/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail.trim())}
        description={<>Changes the sign-in e-mail of {target} immediately (no confirmation mail). The same disposable/duplicate-mailbox checks as at sign-up apply. Talent grants made for the old address are not moved.</>}
        onSubmit={mutate('CHANGE_EMAIL', { email: newEmail.trim() })}>
        <Field label="New e-mail" htmlFor="d-email"><Input id="d-email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} maxLength={254} autoComplete="off" /></Field>
      </ActionDialog>

      <ActionDialog open={open('delete')} onOpenChange={close} title="Delete account permanently" confirmLabel="Delete account" destructive typed="DELETE" onDone={() => { window.location.assign('/users/') /* eslint-disable-line @next/next/no-location-assign-relative-destination */ }} successMessage="Account deleted."
        description={<>
          <p>This permanently deletes {target}: the login, profile, subscriptions and registered devices.</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Payment records are copied to the payments archive first (financial history is never lost).</li>
            <li>Accepted legal documents stay as evidence.</li>
            <li>This cannot be undone. Consider <strong>Disable account</strong> instead.</li>
          </ul>
        </>}
        onSubmit={mutate('DELETE_USER', { confirm: 'DELETE' })} />

      {dlg !== null && typeof dlg === 'object' && (
        <ActionDialog open onOpenChange={close} title="Remove device" confirmLabel="Remove device" destructive successMessage="Device removed." onDone={onDone}
          description={<>Removes <strong className="bidi">{dlg.name ?? 'this computer'}</strong> from {target}. It frees a slot; the app registers the computer again the next time it signs in there.</>}
          onSubmit={mutate('REMOVE_DEVICE', { device_id: dlg.device })} />
      )}
    </>
  )
}
