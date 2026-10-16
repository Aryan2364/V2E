'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEntitlements } from '@/lib/auth/use-entitlements'
import { GOVERNANCE_NAV } from '@/lib/governance-nav'
import Tooltip from '@/components/ui/tooltip'

const COLLAPSE_KEY = 'governance-sidebar-collapsed'

export default function GovernanceSidebar() {
  const pathname = usePathname()
  const { entitlements } = useEntitlements()
  // Fail closed: render no line items until the org's entitlement ceiling loads,
  // then show only the ones it's entitled to. Prevents a first-login / first-
  // switch flash of items the org didn't buy. Mirrors the Work sidebar.
  const navItems = entitlements
    ? GOVERNANCE_NAV.filter((item) => entitlements[item.entitlement] !== 'off')
    : []
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
            'flex-1 px-2 text-xs font-semibold text-text-muted uppercase tracking-widest whitespace-nowrap',
            collapsed ? 'hidden' : 'block',
          ].join(' ')}
        >
          Governance
        </span>
        <Tooltip label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <button
            onClick={toggleCollapsed}
            className="w-8 h-8 rounded-[6px] flex items-center justify-center text-text-muted hover:text-white hover:bg-[#1E293B] transition-colors shrink-0"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </Tooltip>
      </div>

      <nav className="sidebar-scroll flex-1 overflow-y-auto py-3 px-2 flex flex-col gap-0.5">
        {navItems.map(({ label, href, Icon }) => {
          const active = isActive(href)
          return (
            <Tooltip key={href} label={collapsed ? label : undefined}>
            <Link
              href={href}
              className={[
                'flex items-center rounded-[8px] py-2.5 text-sm font-medium transition-colors duration-150 whitespace-nowrap',
                collapsed ? 'justify-center px-2' : 'justify-center px-2 md:justify-start md:gap-3 md:px-3',
                active
                  ? 'bg-primary text-white'
                  : 'text-[#CBD5E1] hover:bg-[#1E293B] hover:text-[#F1F5F9]',
              ].join(' ')}
            >
              <Icon size={18} className="shrink-0" />
              {!collapsed && <span className="hidden md:inline">{label}</span>}
            </Link>
            </Tooltip>
          )
        })}
      </nav>
    </aside>
  )
}
