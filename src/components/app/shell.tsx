'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Activity, CreditCard, FileText, Gauge, HardDrive, LogOut, Menu, Moon, Rocket, ScrollText, Settings, Sparkles, Sun, UserPlus, Users, Wallet, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/card'
import { RoleBadge } from './badges'
import { useAuth } from '@/lib/auth'
import { can, type Role } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useRouter } from 'next/navigation'

const NAV: { href: string; label: string; icon: typeof Gauge; min?: Role }[] = [
  { href: '/dashboard', label: 'Dashboard', icon: Gauge },
  { href: '/users', label: 'Users', icon: Users },
  { href: '/subscriptions', label: 'Subscriptions', icon: CreditCard },
  { href: '/payments', label: 'Payments', icon: Wallet },
  { href: '/devices', label: 'Devices', icon: HardDrive },
  { href: '/registrations', label: 'Registrations', icon: UserPlus },
  { href: '/talent', label: 'Talent', icon: Sparkles },
  { href: '/releases', label: 'Releases', icon: Rocket },
  { href: '/legal', label: 'Legal', icon: FileText },
  { href: '/audit-log', label: 'Audit Log', icon: ScrollText, min: 'admin' },
  { href: '/settings', label: 'Settings', icon: Settings },
]

function subscribeTheme(cb: () => void) {
  const obs = new MutationObserver(cb)
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => obs.disconnect()
}

function ThemeToggle() {
  const dark = useSyncExternalStore(subscribeTheme, () => document.documentElement.classList.contains('dark'), () => true)
  const toggle = () => {
    const next = !dark
    document.documentElement.classList.toggle('dark', next)
    document.documentElement.style.colorScheme = next ? 'dark' : 'light'
    try { localStorage.setItem('amx-admin-theme', next ? 'dark' : 'light') } catch { /* ignore */ }
  }
  return <Button variant="ghost" size="icon" onClick={toggle} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}>{dark ? <Sun /> : <Moon />}</Button>
}

/** Guards every admin page: no session -> /login; not an admin -> sign-out; MFA required but missing -> Settings only. */
export function AdminShell({ children }: { children: ReactNode }) {
  const { state, signOut } = useAuth()
  const router = useRouter()
  const pathname = usePathname() ?? ''
  const [open, setOpen] = useState(false)

  useEffect(() => { if (state.status === 'signedOut' || state.status === 'mfa') router.replace('/login/') }, [state.status, router])

  if (state.status !== 'ready') {
    return (
      <div className="grid min-h-screen place-items-center p-8" role="status" aria-label="Loading">
        <div className="w-64 space-y-3"><Skeleton className="h-6 w-40" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-3/4" /></div>
      </div>
    )
  }
  const me = state.me
  const needsMfa = me.mfa_required && !me.mfa_enrolled
  if (needsMfa && !pathname.startsWith('/settings')) {
    router.replace('/settings/')
  }

  const items = NAV.filter((n) => !n.min || can(me.role, n.min))
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/')

  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-0.5 p-3">
      {items.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href + '/'} prefetch={false} onClick={() => setOpen(false)} aria-current={isActive(href) ? 'page' : undefined}
          className={cn('flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring', isActive(href) ? 'bg-accent text-foreground' : 'text-muted-foreground')}>
          <Icon className="size-4" aria-hidden />{label}
        </Link>
      ))}
    </nav>
  )

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      <a href="#main" className="sr-only z-[60] rounded bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-2 focus:top-2">Skip to content</a>
      <aside className="hidden border-r bg-card lg:block">
        <div className="sticky top-0 flex h-screen flex-col">
          <div className="flex h-16 items-center gap-2.5 border-b px-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="" className="size-7 rounded-md dark:invert" width={28} height={28} />
            <span className="text-sm font-semibold tracking-wide">AutoMax Admin</span>
          </div>
          <div className="flex-1 overflow-y-auto">{nav}</div>
          <div className="border-t p-4 text-xs text-muted-foreground"><Activity className="mr-1 inline size-3" aria-hidden />admin.auto-max.co.il</div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open}><Menu /></Button>
          <span className="text-sm font-semibold lg:hidden">AutoMax Admin</span>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <div className="hidden min-w-0 text-right sm:block">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Current Admin</p>
              <p className="max-w-56 truncate text-sm font-medium" title={me.email ?? ''}>{me.email}</p>
            </div>
            <RoleBadge role={me.role} />
            <ThemeToggle />
            <Button variant="outline" size="sm" onClick={() => void signOut()}><LogOut /> Logout</Button>
          </div>
        </header>

        {open && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
            <button className="absolute inset-0 bg-black/60" aria-label="Close menu" onClick={() => setOpen(false)} />
            <div className="relative h-full w-64 max-w-[80vw] overflow-y-auto border-r bg-card">
              <div className="flex h-16 items-center justify-between border-b px-4"><span className="text-sm font-semibold">AutoMax Admin</span><Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close menu"><X /></Button></div>
              {nav}
            </div>
          </div>
        )}

        <main id="main" className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">
          {needsMfa && (
            <div role="alert" className="mb-6 rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-sm">
              Two-factor authentication is required for administrators. Enable it below to unlock the rest of the console.
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  )
}
