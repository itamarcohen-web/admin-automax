import * as React from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'
import { cn } from '@/lib/utils'

const field = 'w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, type = 'text', ...props }, ref) => (
  <input ref={ref} type={type} className={cn(field, 'h-9', className)} {...props} />
))
Input.displayName = 'Input'

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(field, 'min-h-20 py-2', className)} {...props} />
))
Textarea.displayName = 'Textarea'

/** Native <select>: fully keyboard/screen-reader accessible and works on every device. */
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <select ref={ref} className={cn(field, 'h-9 appearance-none bg-[length:1rem] bg-[right_0.6rem_center] bg-no-repeat pr-8', className)} {...props}>{children}</select>
))
Select.displayName = 'Select'

export const Label = React.forwardRef<React.ElementRef<typeof LabelPrimitive.Root>, React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root ref={ref} className={cn('text-sm font-medium leading-none', className)} {...props} />
))
Label.displayName = 'Label'

export function Field({ label, htmlFor, hint, error, children, className }: { label: string; htmlFor: string; hint?: string; error?: string | null; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  )
}

export function Checkbox({ id, checked, onChange, label, disabled }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-2 text-sm">
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[var(--primary)]" />
      {label}
    </label>
  )
}
