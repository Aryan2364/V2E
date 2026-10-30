'use client'

import React from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useTrackBackHistory } from '@/lib/back'
import { useAuth } from '@/lib/auth/context'
import { useEntitlements } from '@/lib/auth/use-entitlements'
import { useServiceWorkerRegistration } from '@/lib/service-worker'
import { TaskBadgeProvider } from '@/lib/task-badge'
import { phoneRedirectFor, phoneRouteFor, type PhoneRoute } from '@/lib/phone-routes'
import PhoneTabBar from './PhoneTabBar'
import PhoneScreen from './PhoneScreen'
import NotificationsScreen from './screens/NotificationsScreen'
import MoreScreen from './screens/MoreScreen'
import NotificationChoicesScreen from './screens/NotificationChoicesScreen'
import MyWorkScreen from './screens/MyWorkScreen'
import TaskDetailScreen from './screens/TaskDetailScreen'
import GiveTaskScreen from './screens/GiveTaskScreen'
import EditTaskScreen from './screens/EditTaskScreen'
import GivenScreen from './screens/GivenScreen'
import RecurringTemplatesScreen from './screens/RecurringTemplatesScreen'
import RecurringInstancesScreen from './screens/RecurringInstancesScreen'
import MeetingsScreen from './screens/MeetingsScreen'
import MeetingDetailScreen from './screens/MeetingDetailScreen'
import MeetingCreateScreen from './screens/MeetingCreateScreen'
import { UndoToastProvider } from './UndoToast'
import { ComputerOnlyScreen, ModuleOffScreen } from './screens/PlaceholderScreens'

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
  const { user } = useAuth()
  useTrackBackHistory()
  useServiceWorkerRegistration(true)

  const redirect = phoneRedirectFor(pathname)
  React.useEffect(() => {
    if (redirect) router.replace(redirect)
  }, [redirect, router])

  const route = redirect ? null : phoneRouteFor(pathname)
  const showTabBar = !redirect && route !== null && route.parent === undefined

  return (
    <TaskBadgeProvider orgId={user?.organizationId ?? ''}>
      <UndoToastProvider>
        <div data-slot="phone-shell" className="flex min-h-dvh flex-col bg-surface-sunken text-text-primary">
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
      </UndoToastProvider>
    </TaskBadgeProvider>
  )
}

/** A phone screen, unless the organisation has its module switched off. */
function GuardedScreen({ route }: { route: PhoneRoute }) {
  const { state } = useEntitlements()
  if (route.entitlement && state(route.entitlement) === 'off') return <ModuleOffScreen route={route} />

  switch (route.key) {
    case 'my-work':
      return <MyWorkScreen route={route} />
    case 'given':
      return <GivenScreen route={route} />
    case 'recurring-templates':
      return <RecurringTemplatesScreen route={route} />
    case 'recurring-instances':
      return <RecurringInstancesScreen route={route} />
    case 'meetings':
      return <MeetingsScreen route={route} />
    case 'task-record':
      return <TaskDetailScreen route={route} />
    case 'task-edit':
      return <EditTaskScreen route={route} />
    case 'give-task':
      return <GiveTaskScreen route={route} />
    case 'meeting-record':
      return <MeetingDetailScreen route={route} />
    case 'meeting-create':
      return <MeetingCreateScreen route={route} />
    case 'notifications':
      return <NotificationsScreen title={route.title} />
    case 'more':
      return <MoreScreen route={route} />
    case 'notification-choices':
      return <NotificationChoicesScreen route={route} />
  }
}
