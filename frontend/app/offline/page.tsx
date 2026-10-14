import type { Metadata } from 'next'
import OfflineScreen from '@/components/phone/OfflineScreen'

/**
 * /offline - the installed phone app's offline screen
 * (FRONTEND_RULES_PHONE.md 41.14 rule 9). public/sw.js caches it and answers
 * a navigation that finds no connection with it.
 *
 * STATIC ON PURPOSE (force-static): it is prerendered once at build time so
 * it can be cached and served with no server. The root layout's headers()
 * read as empty here, so nothing about the person is in it. Outside
 * MainLayout, so no sign-in check wraps it, and SplashGate lets it straight
 * through (it never waits for a session that cannot be restored offline).
 */
export const dynamic = 'force-static'

export const metadata: Metadata = { title: 'You are offline' }

export default function OfflinePage() {
  return <OfflineScreen />
}
