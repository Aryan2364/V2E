'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bell, CalendarDays, CheckSquare, Menu, UserCheck } from 'lucide-react'
import { useKeyboard } from '@/lib/keyboard'
import { useEntitlements } from '@/lib/auth/use-entitlements'
import { useNotifications } from '@/lib/notifications/NotificationsProvider'
import { MORE_HREF, PHONE_HOME } from '@/lib/phone-routes'
import { cx } from './primitives'

/*
 * The phone's tab bar - FRONTEND_RULES_PHONE.md 41.4 rules 11 to 19.
 *
 *   - Exactly V2E's five: My work (first, 41.15), Given, Meetings,
 *     Notifications, More (last). Equal widths; a 22px icon over a 12px label
 *     at weight 500; every tab labelled (rule 13).
 *   - Active: icon and label in primary-text. Resting: text-secondary.
 *     Pressed: surface-control. No hover (rule 14).
 *   - Notifications carries the unread count at the top right of its icon,
 *     "99+" over 99 (rule 16).
 *   - Tabs carry the organisation's module switches like the desktop nav
 *     (rule 17): My work and Given need Tasks, Meetings needs the Meetings
 *     line item. A module switched off drops its tab. While the switches are
 *     still loading, the tabs show (the usual answer is "on"); each screen
 *     also guards itself, so a tab that turns out to be off never opens a
 *     working screen.
 *   - 56px plus the bottom safe area, surface, a 1px border-light line on
 *     top, no shadow; fixed and full width even sideways (rule 12, 41.13
 *     rule 10). It marks itself data-fixed-bottom="tab-bar", from which
 *     globals.css works out --bottom-bar for the content's bottom padding
 *     and the toasts.
 *   - Hidden while the keyboard is open (rule 19). Tapping the active tab on
 *     its own screen scrolls back to the top (rule 18).
 */

type Tab = {
  label: string
  href: string
  icon: React.ReactNode
  entitlement?: string
}

export const PHONE_TABS: Tab[] = [
  { label: 'My work', href: PHONE_HOME, icon: <CheckSquare aria-hidden />, entitlement: 'tasks' },
  { label: 'Given', href: '/dashboard/tasks/assigned', icon: <UserCheck aria-hidden />, entitlement: 'tasks' },
  {
    label: 'Meetings',
    href: '/dashboard/governance/meetings',
    icon: <CalendarDays aria-hidden />,
    entitlement: 'governance.meetings',
  },
  // Tab label only ("Alerts"); the screen's own title stays "Notifications" (route title in lib/phone-routes.ts).
  { label: 'Alerts', href: '/dashboard/notifications', icon: <Bell aria-hidden /> },
  { label: 'More', href: MORE_HREF, icon: <Menu aria-hidden /> },
]

/** The tabs this organisation can use (41.4 rule 17). The one place that decides. */
export function useVisibleTabs(): Tab[] {
  const { state } = useEntitlements()
  return PHONE_TABS.filter((tab) => !tab.entitlement || state(tab.entitlement) !== 'off')
}

function activeHref(pathname: string, tabs: Tab[]): string | null {
  const match = tabs
    .filter((t) => pathname === t.href || pathname.startsWith(`${t.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]
  return match?.href ?? null
}

export default function PhoneTabBar() {
  const pathname = usePathname()
  const keyboard = useKeyboard()
  const tabs = useVisibleTabs()
  const { unreadCount } = useNotifications()
  const active = activeHref(pathname, tabs)

  if (keyboard.open) return null

  return (
    <nav
      aria-label="Main"
      data-slot="phone-tab-bar"
      data-fixed-bottom="tab-bar"
      className={cx(
        'fixed inset-x-0 bottom-0 z-40 flex border-t border-border-light bg-surface',
        'h-[calc(var(--h-tab-bar)+var(--safe-bottom))] pb-(--safe-bottom) pl-(--safe-left) pr-(--safe-right)',
      )}
    >
      {tabs.map((tab) => {
        const isActive = tab.href === active
        const count = tab.href === '/dashboard/notifications' && unreadCount > 0 ? unreadCount : null
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? 'page' : undefined}
            onClick={(event) => {
              if (!isActive || pathname !== tab.href) return
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
              event.preventDefault()
              window.scrollTo({ top: 0, left: 0 })
            }}
            className={cx(
              'flex min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-[4px] px-[4px]',
              '[&_svg]:size-[22px] [&_svg]:shrink-0',
              'transition-[background-color] duration-(--duration-fast) active:bg-surface-control',
              'outline-hidden focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-ring',
              isActive ? 'text-primary-text' : 'text-text-secondary',
            )}
          >
            <span className="relative flex">
              {tab.icon}
              {count !== null ? (
                <span
                  aria-hidden
                  className="absolute top-[-8px] left-[12px] flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-[5px] text-[11px] font-semibold leading-none text-primary-foreground"
                >
                  {count > 99 ? '99+' : count}
                </span>
              ) : null}
            </span>
            <span className="max-w-full truncate text-bar-label font-medium">{tab.label}</span>
            {count !== null ? <span className="sr-only">, {count} unread</span> : null}
          </Link>
        )
      })}
    </nav>
  )
}
