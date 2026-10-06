'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'

export default function Home() {
  const { state } = useAuth()
  const router = useRouter()
  useEffect(() => {
    if (state.status === 'ready') router.replace('/dashboard/')
    else if (state.status === 'signedOut' || state.status === 'mfa') router.replace('/login/')
  }, [state.status, router])
  return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground" role="status">Loading…</div>
}
