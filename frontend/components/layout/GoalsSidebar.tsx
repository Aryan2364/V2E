'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  LayoutGrid,
  Network,
  Target,
} from 'lucide-react'
import Tooltip from '@/components/ui/Tooltip'
import { useAuth } from '@/lib/auth/context'
import { goalsApi } from '@/lib/api/goals'

const NAV_ITEMS = [
  { key: 'list', label: 'Goals', href: '/goals/list', Icon: Target },
  { key: 'checkins', label: 'My check-ins', href: '/goals/my-check-ins', Icon: CheckCircle2 },
  { key: 'scorecard', label: 'Balance Scorecard', href: '/goals/scorecard', Icon: LayoutGrid },
  { key: 'strategy-map', label: 'Strategic Map', href: '/goals/strategy-map', Icon: Network },
  { key: 'dashboard', label: 'Dashboard', href: '/goals/dashboard', Icon: LayoutDashboard },
]

const COLLAPSE_KEY = 'goals-sidebar-collapsed'

/**
 * Dark "Goals" module sidebar — same shell as TaskModuleSidebar (the Work menu)
 * so the two modules feel identical. Collapse state persists in localStorage so
 * it survives navigating into a goal detail page and back.
 *
 * The count on "My check-ins" is what pulls the eye when something is owed —
 * the cheap, always-visible half of the reminder (the other half is the
 * nightly notification).
 */
export default function GoalsSidebar() {
  const pathname = usePathname()
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(COLLAPSE_KEY) === '1'
  })
  const [dueCount, setDueCount] = useState(0)

  const refreshCount = useCallback(() => {
    if (!orgId) return
    goalsApi
      .myCheckInCount(orgId)
      .then(setDueCount)
      .catch(() => setDueCount(0))
  }, [orgId])

  // Re-read on every navigation inside the module, so recording a check-in
  // updates the badge without a page reload.
  useEffect(() => {
    refreshCount()
  }, [refreshCount, pathname])

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }

  return (
    <aside
      className={[
        'sticky top-14 h-[calc(100vh-56px)] bg-[#0F172A] flex flex-col shrink-0 z-30',
        'transition-[width] duration-200 ease-in-out overflow-hidden',
        // Always an icon rail below md; respects the collapse toggle from md up.
        collapsed ? 'w-16' : 'w-16 md:w-[240px]',
      ].join(' ')}
    >
      {/* Header row with toggle — desktop only (mobile uses the icon rail) */}
      <div className="hidden md:flex h-12 items-center border-b border-white/10 shrink-0 px-2">
        <span
          className={[
            'flex-1 px-2 text-xs font-semibold text-[#94A3B8] uppercase tracking-widest whitespace-nowrap',
            collapsed ? 'hidden' : 'block',
          ].join(' ')}
        >
          Goals
        </span>
        <Tooltip label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <button
            onClick={toggleCollapsed}
            className="w-8 h-8 rounded-[6px] flex items-center justify-center text-[#94A3B8] hover:text-white hover:bg-[#1E293B] transition-colors shrink-0"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </Tooltip>
      </div>

      <nav className="sidebar-scroll flex-1 overflow-y-auto py-3 px-2 flex flex-col gap-0.5">
        {NAV_ITEMS.map(({ key, label, href, Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          const badge = key === 'checkins' ? dueCount : 0
          return (
            <Tooltip key={href} label={collapsed ? label : undefined}>
              <Link
                href={href}
                className={[
                  'relative flex items-center rounded-[8px] py-2.5 text-sm font-medium transition-colors duration-150 whitespace-nowrap',
                  collapsed ? 'justify-center px-2' : 'justify-center px-2 md:justify-start md:gap-3 md:px-3',
                  active
                    ? 'bg-[#2563EB] text-white'
                    : 'text-[#CBD5E1] hover:bg-[#1E293B] hover:text-[#F1F5F9]',
                ].join(' ')}
              >
                <Icon size={18} className="shrink-0" />
                {!collapsed && <span className="hidden md:inline">{label}</span>}
                {badge > 0 &&
                  (collapsed ? (
                    // On the icon rail there's no room for a pill — a dot still
                    // says "something is waiting".
                    <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#2563EB] ring-2 ring-[#0F172A]" />
                  ) : (
                    <>
                      <span className="md:hidden absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#2563EB] ring-2 ring-[#0F172A]" />
                      <span
                        className={[
                          'hidden md:inline-flex ml-auto items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-semibold',
                          active ? 'bg-white text-[#2563EB]' : 'bg-[#2563EB] text-white',
                        ].join(' ')}
                      >
                        {badge}
                      </span>
                    </>
                  ))}
              </Link>
            </Tooltip>
          )
        })}
      </nav>
    </aside>
  )
}
