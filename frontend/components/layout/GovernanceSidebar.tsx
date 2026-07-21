'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  CalendarDays,
  Gavel,
  BarChart2,
  ClipboardList,
  FileText,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'

const NAV_ITEMS = [
  { label: 'Meetings', href: '/dashboard/governance/meetings', Icon: CalendarDays },
  { label: 'Decision Log', href: '/dashboard/governance/decisions', Icon: Gavel },
  { label: 'Reports', href: '/dashboard/governance/reports', Icon: BarChart2 },
  { label: 'Daily Update', href: '/dashboard/governance/daily-update', Icon: ClipboardList },
  { label: 'Work Log', href: '/dashboard/governance/work-log', Icon: FileText },
]

const COLLAPSE_KEY = 'governance-sidebar-collapsed'

export default function GovernanceSidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(COLLAPSE_KEY) === '1'
  })

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c
      try { window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }

  function isActive(href: string): boolean {
    return pathname === href || pathname.startsWith(`${href}/`)
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
          Governance
        </span>
        <button
          onClick={toggleCollapsed}
          className="w-8 h-8 rounded-[6px] flex items-center justify-center text-[#94A3B8] hover:text-white hover:bg-[#1E293B] transition-colors shrink-0"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      <nav className="sidebar-scroll flex-1 overflow-y-auto py-3 px-2 flex flex-col gap-0.5">
        {NAV_ITEMS.map(({ label, href, Icon }) => {
          const active = isActive(href)
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={[
                'flex items-center rounded-[8px] py-2.5 text-sm font-medium transition-colors duration-150 whitespace-nowrap',
                collapsed ? 'justify-center px-2' : 'justify-center px-2 md:justify-start md:gap-3 md:px-3',
                active
                  ? 'bg-[#2563EB] text-white'
                  : 'text-[#CBD5E1] hover:bg-[#1E293B] hover:text-[#F1F5F9]',
              ].join(' ')}
            >
              <Icon size={18} className="shrink-0" />
              {!collapsed && <span className="hidden md:inline">{label}</span>}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
