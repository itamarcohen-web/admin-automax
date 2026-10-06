import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { Toaster } from 'sonner'
import { AuthProvider } from '@/lib/auth'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'AutoMax Admin', template: '%s · AutoMax Admin' },
  description: 'AutoMax administration console',
  robots: { index: false, follow: false },
  icons: { icon: '/icon.svg' },
  referrer: 'no-referrer',
}
export const viewport: Viewport = { width: 'device-width', initialScale: 1 }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/* external (not inline) so the Content-Security-Policy can forbid inline scripts */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme-init.js" />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
        <Toaster position="bottom-right" richColors closeButton theme="system" />
      </body>
    </html>
  )
}
