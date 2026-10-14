'use client'

import React from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useTrackBackHistory } from '@/lib/back'
import { useEntitlements } from '@/lib/auth/use-entitlements'
import { useNotifications } from '@/lib/notifications/NotificationsProvider'
import { useAppBadge, useServiceWorkerRegistration } from '@/lib/service-worker'
import { phoneRedirectFor, phoneRouteFor, type PhoneRoute } from '@/lib/phone-routes'
import PhoneTabBar from './PhoneTabBar'
import PhoneScreen from './PhoneScreen'
import NotificationsScreen from './screens/NotificationsScreen'
import MoreScreen from './screens/MoreScreen'
import NotificationChoicesScreen from './screens/NotificationChoicesScreen'
import {
  ComingNextScreen,
  ComputerOnlyScreen,
  ModuleOffScreen,
  RecordComingNextScreen,
} from './screens/PlaceholderScreens'

/*
 * THE PHONE SHELL - FRONTEND_RULES_PHONE.md 41.3 and 41.4.
 *
 * MainLayout renders this INSTEAD of the desktop shell (TopNav, module
 * sidebars and the desktop page) whenever useLayout() says "phone". The phone
 * is a second layout of the same product, not a squeezed desktop: the screen
 * for the address comes from lib/phone-routes.ts, the one list of phone
 * screens, and every address not on it shows the computer-only page (41.11).
 * The desktop page components are never mounted on a phone, so nothing on
 * desktop changes because the phone exists.
 *
 *   - Same addresses on both layouts (41.2 rule 4). /dashboard on a phone
 *     opens My work (phoneRedirectFor).
 *   - The tab bar shows on top-level screens only (41.4 rule 11): a screen
 *     with a parent has the back arrow instead.
 *   - Light theme only, safe areas, dvh heights (41.13): the shell is a
 *     column at least the visible height, and the window scrolls.
 *   - Here it also keeps the record behind the back arrow (lib/back.ts),
 *     registers the service worker for the installed app (lib/service-worker.ts),
 *     and puts the unread count on the installed app's icon (Badging API).
 */
export default function PhoneShell() {
  const pathname = usePathname()
  const router = useRouter()
  const { unreadCount } = useNotifications()
  useTrackBackHistory()
  useServiceWorkerRegistration(true)
  useAppBadge(true, unreadCount)

  const redirect = phoneRedirectFor(pathname)
  React.useEffect(() => {
    if (redirect) router.replace(redirect)
  }, [redirect, router])

  const route = redirect ? null : phoneRouteFor(pathname)
  const showTabBar = !redirect && route !== null && route.parent === undefined

  return (
    <div data-slot="phone-shell" className="flex min-h-[100dvh] flex-col bg-phone-surface-sunken text-phone-text-body">
      {redirect ? (
        // A moment while /dashboard moves on to My work: the bar, no content.
        <PhoneScreen title="V2E">{null}</PhoneScreen>
      ) : route ? (
        <GuardedScreen route={route} />
      ) : (
        <ComputerOnlyScreen />
      )}
      {showTabBar ? <PhoneTabBar /> : null}
    </div>
  )
}

/** A phone screen, unless the organisation has its module switched off. */
function GuardedScreen({ route }: { route: PhoneRoute }) {
  const { state } = useEntitlements()
  if (route.entitlement && state(route.entitlement) === 'off') return <ModuleOffScreen route={route} />

  switch (route.key) {
    case 'my-work':
    case 'given':
    case 'meetings':
      return <ComingNextScreen route={{ ...route, key: route.key }} />
    case 'task-record':
    case 'meeting-record':
      return <RecordComingNextScreen route={route} />
    case 'notifications':
      return <NotificationsScreen title={route.title} />
    case 'more':
      return <MoreScreen route={route} />
    case 'notification-choices':
      return <NotificationChoicesScreen route={route} />
  }
}
