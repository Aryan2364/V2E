'use client'

import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import BootSplash from './BootSplash'

/**
 * Holds the branded boot splash over the app until the initial session
 * restore/refresh has resolved (AuthProvider.isLoading). Prevents the cold-load
 * flicker where a logged-in user briefly sees a blank page or the login form
 * before their session is confirmed.
 *
 * The phone app's offline screen (/offline) is let straight through: it is
 * prerendered at build time and shown with no connection, when the session
 * can never be restored, so it must never wait on it.
 */
export default function SplashGate({ children }: { children: React.ReactNode }) {
  const { isLoading } = useAuth()
  const pathname = usePathname()
  if (isLoading && pathname !== '/offline') return <BootSplash />
  return <>{children}</>
}
