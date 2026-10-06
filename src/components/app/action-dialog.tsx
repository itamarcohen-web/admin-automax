'use client'

import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/form'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { describeError } from '@/lib/api'

/**
 * Confirmation dialog for every state-changing action: a clear explanation, optional inputs (children), an optional typed phrase
 * for critical actions (e.g. DELETE), a pending state and an inline error. Nothing is sent until the confirm button is pressed.
 */
export function ActionDialog({
  open, onOpenChange, title, description, confirmLabel, destructive = false, typed, canSubmit = true, onSubmit, onDone, successMessage, children, wide,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  description: ReactNode
  confirmLabel: string
  destructive?: boolean
  /** the user must type this exact phrase before the button is enabled */
  typed?: string
  canSubmit?: boolean
  onSubmit: () => Promise<unknown>
  onDone?: () => void
  successMessage?: string
  children?: ReactNode
  wide?: boolean
}) {
  const [phrase, setPhrase] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = (o: boolean) => {
    if (pending) return
    if (!o) { setPhrase(''); setError(null) }
    onOpenChange(o)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      await onSubmit()
      if (successMessage) toast.success(successMessage)
      setPhrase('')
      onOpenChange(false)
      onDone?.()
    } catch (err) {
      setError(describeError(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent wide={wide}>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription asChild><div>{description}</div></DialogDescription>
          </DialogHeader>
          {children}
          {typed && (
            <div className="space-y-1.5">
              <label htmlFor="confirm-phrase" className="text-sm">Type <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold">{typed}</code> to confirm</label>
              <Input id="confirm-phrase" value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} aria-label={`Type ${typed} to confirm`} />
            </div>
          )}
          {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => close(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" variant={destructive ? 'destructive' : 'default'} loading={pending} disabled={!canSubmit || (typed !== undefined && phrase !== typed)}>{confirmLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
