'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import Tooltip from '@/components/ui/tooltip'
import { Count } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

/**
 * The single sidebar implementation shared by every module sidebar
 * (Sidebar, TaskModuleSidebar, GovernanceSidebar, GoalsSidebar,
 * SettingsSidebar) — FRONTEND_RULES.md §4 rule 2. Each caller stays a thin
 * wrapper that computes its own item list (permissions, entitlements,
 * counts) and feeds it in here; this component owns only rendering,
 * collapse state and kit tokens.
 *
 * Kept per decision D4: this is the MODULE sub-menu sidebar, sitting below
 * v2e's top nav bar — not the kit's single top-level sidebar. Restyled to
 * kit §12.1 treatment (primary fill, on-brand text, surface+primary-text
 * active item) while keeping v2e's collapse-to-icon-rail behaviour.
 */
export interface ModuleSidebarItem {
  key?: string
  label: string
  href: string
  Icon: React.ElementType
  active?: boolean
  badge?: number
  disabled?: boolean
  disabledLabel?: string
}

export interface ModuleSidebarGroup {
  label?: string
  note?: string
  items: ModuleSidebarItem[]
}

export interface ModuleSidebarProps {
  /** Label shown in the header row when expanded (e.g. "Work", "Settings"). */
  title: string
  groups: ModuleSidebarGroup[]
  /** localStorage key for the collapse toggle. Omit to disable persistence. */
  collapseKey?: string
  /** Controlled collapse state, for sidebars whose parent owns the toggle (Settings). */
  collapsed?: boolean
  onToggle?: () => void
  /** 'sticky' (module sidebars, sit below the top nav) or 'fixed' (Sidebar, SettingsSidebar). */
  position?: 'sticky' | 'fixed'
}

export default function ModuleSidebar({
  title,
  groups,
  collapseKey,
  collapsed: collapsedProp,
  onToggle,
  position = 'sticky',
}: ModuleSidebarProps) {
  const [collapsedState, setCollapsedState] = useState(() => {
    if (!collapseKey || typeof window === 'undefined') return false
    return window.localStorage.getItem(collapseKey) === '1'
  })
  const collapsed = collapsedProp ?? collapsedState

  function toggleCollapsed() {
    if (onToggle) {
      onToggle()
      return
    }
    setCollapsedState((c) => {
      const next = !c
      if (collapseKey) {
        try {
          window.localStorage.setItem(collapseKey, next ? '1' : '0')
        } catch {
          /* ignore */
        }
      }
      return next
    })
  }

  return (
    <aside
      className={[
        position === 'fixed'
          ? 'fixed left-0 top-14 h-[calc(100vh-56px)] z-shell'
          : 'sticky top-14 h-[calc(100vh-56px)] z-shell',
        'bg-primary flex flex-col shrink-0',
        'transition-[width] duration-slow ease-enter overflow-hidden',
        collapsed ? 'w-16' : 'w-16 md:w-[240px]',
      ].join(' ')}
    >
      <div className="hidden md:flex h-12 items-center border-b border-primary-hover shrink-0 px-2">
        <span
          className={[
            'flex-1 px-2 text-meta font-medium text-on-brand-muted uppercase tracking-widest whitespace-nowrap',
            collapsed ? 'hidden' : 'block',
          ].join(' ')}
        >
          {title}
        </span>
        <Tooltip label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <Button
            variant="on-brand"
            size="icon-sm"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="shrink-0"
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </Button>
        </Tooltip>
      </div>

      <nav className="sidebar-scroll flex-1 overflow-y-auto py-3 px-2 flex flex-col gap-0.5">
        {groups.map((group, gi) => (
          <React.Fragment key={group.label ?? gi}>
            {gi > 0 && (
              <div className={['my-1 h-px bg-primary-hover', collapsed ? 'mx-1' : 'mx-1 md:mx-2'].join(' ')} />
            )}
            {group.label && (
              <p
                className={[
                  'px-3 pt-1 pb-0.5 text-meta font-medium text-on-brand-muted uppercase tracking-widest',
                  collapsed ? 'hidden' : 'hidden md:block',
                ].join(' ')}
              >
                {group.label}
                {group.note && <span className="ml-2 normal-case tracking-normal text-on-brand-muted">{group.note}</span>}
              </p>
            )}
            {group.items.map((item) => {
              if (item.disabled) {
                return (
                  <Tooltip key={item.key ?? item.href} label={item.disabledLabel ?? (collapsed ? item.label : undefined)}>
                    <span
                      className={[
                        'flex items-center rounded-[8px] py-2.5 text-body font-normal text-on-brand-muted cursor-not-allowed',
                        collapsed ? 'justify-center px-2' : 'justify-center px-2 md:justify-start md:gap-3 md:px-3',
                      ].join(' ')}
                    >
                      <item.Icon size={18} className="shrink-0" />
                      {!collapsed && <span className="hidden md:inline">{item.label}</span>}
                    </span>
                  </Tooltip>
                )
              }
              const active = !!item.active
              return (
                <Tooltip key={item.key ?? item.href} label={collapsed ? item.label : undefined}>
                  <Link
                    href={item.href}
                    className={[
                      'relative flex items-center rounded-[8px] py-2.5 text-body font-normal transition-[background-color] duration-fast whitespace-nowrap',
                      'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-ring',
                      collapsed ? 'justify-center px-2' : 'justify-center px-2 md:justify-start md:gap-3 md:px-3',
                      active
                        ? 'bg-surface text-primary-text font-medium'
                        : 'text-on-brand hover:bg-primary-hover',
                    ].join(' ')}
                  >
                    <item.Icon size={18} className="shrink-0" />
                    {!collapsed && <span className="hidden md:inline">{item.label}</span>}
                    {!!item.badge && item.badge > 0 && (
                      collapsed ? (
                        <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-surface ring-2 ring-primary" />
                      ) : (
                        <>
                          <span className="md:hidden absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-surface ring-2 ring-primary" />
                          <span className="hidden md:inline-flex ml-auto">
                            <Count value={item.badge} className={active ? 'bg-surface text-primary-text' : undefined} />
                          </span>
                        </>
                      )
                    )}
                  </Link>
                </Tooltip>
              )
            })}
          </React.Fragment>
        ))}
      </nav>
    </aside>
  )
}
