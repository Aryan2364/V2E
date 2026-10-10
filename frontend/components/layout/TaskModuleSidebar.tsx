'use client'

import { useEffect, useState } from 'react'
import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { usePermissions } from '@/lib/auth/use-permissions'
import { useEntitlements } from '@/lib/auth/use-entitlements'
import { getMyOrgs } from '@/lib/api/auth'
import { leaveApi } from '@/lib/api/leave'
import {
  LayoutDashboard,
  CheckSquare,
  UserCheck,
  RotateCcw,
  AlertTriangle,
  Archive,
  BarChart2,
  Settings2,
  Globe,
  GitBranch,
  Ticket,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  Eye,
  ArrowRightLeft,
  CalendarCheck,
} from 'lucide-react'
import Tooltip from '@/components/ui/Tooltip'

interface NavItem {
  label: string
  href: string
  Icon: React.ElementType
  adminOnly?: boolean
  /** Visible to admins OR any role granted a task-configuration permission. */
  taskConfigGated?: boolean
  /** Only relevant to people who belong to 2+ firms (a group of companies). */
  multiOrgOnly?: boolean
  /** Only for people the org's leave policy makes an approver (server-decided). */
  leaveApproverOnly?: boolean
  disabled?: boolean
}

/** Leaves that grant access to the Task Masters configuration page. */
const TASK_CONFIG_LEAVES = [
  'tasks.config.settings.manage',
  'tasks.config.categories.manage',
  'tasks.config.priorities.manage',
  'tasks.config.statuses.manage',
  'tasks.config.checklist_templates.manage',
  'tasks.config.assignee_visibility.manage',
  'tasks.config.tags.manage',
]

interface NavGroup {
  label?: string
  module: 'tasks' | 'projects' | 'workflows' | 'tickets' | 'delegation' | 'ecs'
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Tasks',
    module: 'tasks',
    items: [
      { label: 'Overview', href: '/dashboard/tasks', Icon: LayoutDashboard },
      { label: 'My Tasks', href: '/dashboard/tasks/my', Icon: CheckSquare },
      { label: 'Assigned by Me', href: '/dashboard/tasks/assigned', Icon: UserCheck },
      { label: 'Recurring', href: '/dashboard/tasks/recurring', Icon: RotateCcw },
      { label: 'Escalated', href: '/dashboard/tasks/escalated', Icon: AlertTriangle },
      { label: "CC'd Tasks", href: '/dashboard/tasks/cc', Icon: Eye },
      { label: 'Reports', href: '/dashboard/tasks/reports-new', Icon: BarChart2 },
      { label: 'Collective', href: '/dashboard/tasks/collective', Icon: Globe, multiOrgOnly: true },
      { label: 'Archive', href: '/dashboard/tasks/archive', Icon: Archive, adminOnly: true },
      { label: 'Analytics', href: '/dashboard/tasks/reports', Icon: BarChart2, adminOnly: true },
    ],
  },
  {
    label: 'Projects',
    module: 'projects',
    items: [
      { label: 'Projects', href: '/dashboard/projects', Icon: Briefcase },
      { label: 'My Projects', href: '/dashboard/projects/my', Icon: Briefcase },
    ],
  },
  {
    label: 'Workflows',
    module: 'workflows',
    items: [
      { label: 'Workflows', href: '/dashboard/tasks/workflows', Icon: GitBranch },
    ],
  },
  {
    label: 'Tickets',
    module: 'tickets',
    items: [
      { label: 'Tickets', href: '/dashboard/tasks/tickets', Icon: Ticket },
      { label: 'My Tickets', href: '/dashboard/tasks/tickets/my', Icon: Ticket },
      { label: 'Assigned to Me', href: '/dashboard/tasks/tickets/assigned', Icon: Ticket },
      { label: 'Archive', href: '/dashboard/tasks/tickets/archive', Icon: Archive },
      { label: 'Reports', href: '/dashboard/tasks/tickets/reports', Icon: BarChart2 },
    ],
  },
  {
    // Sold separately and OFF by default — this whole group stays hidden until the
    // vendor enables the `delegation` entitlement for the org (super-admin portal).
    label: 'Delegation',
    module: 'delegation',
    items: [
      { label: 'Delegation', href: '/dashboard/tasks/delegation', Icon: ArrowRightLeft },
    ],
  },
  {
    // Leave lives in the `ecs` module (Leave & Policies). Approvals sit in Work
    // because deciding a request is work an approver does.
    label: 'Leave',
    module: 'ecs',
    items: [
      { label: 'Leave Approvals', href: '/dashboard/tasks/leave-approvals', Icon: CalendarCheck, leaveApproverOnly: true },
    ],
  },
  {
    label: 'Config',
    module: 'tasks',
    items: [
      { label: 'Work Settings', href: '/dashboard/tasks/masters', Icon: Settings2, taskConfigGated: true },
    ],
  },
]

const ALL_HREFS = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href))

const COLLAPSE_KEY = 'task-sidebar-collapsed'

// Per-org cache of "does this person approve leave?" so moving between Work pages
// (and the Projects layout, which shares this sidebar) doesn't refetch it.
const leaveApproverCache = new Map<string, boolean>()

/**
 * Dark "Task Management" sidebar shared by the Tasks AND Projects layouts so
 * the menu never swaps when moving between the two modules. Collapse state is
 * persisted in localStorage to survive cross-layout navigation.
 */
export default function TaskModuleSidebar() {
  const pathname = usePathname()
  const { user } = useAuth()
  const { can, isAdmin } = usePermissions()
  const { entitlements } = useEntitlements()
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(COLLAPSE_KEY) === '1'
  })

  // "Collective" (cross-firm) tasks only make sense for a person who belongs to
  // a group of companies — i.e. has 2+ active org memberships. For a single
  // firm it just duplicates "My Tasks", so hide it until we confirm multi-org.
  const [multiOrg, setMultiOrg] = useState(false)
  useEffect(() => {
    if (user && !user.isSuperAdmin && user.organizationId) {
      getMyOrgs()
        .then((orgs) => setMultiOrg(orgs.length > 1))
        .catch(() => setMultiOrg(false))
    } else {
      setMultiOrg(false)
    }
  }, [user?.id, user?.isSuperAdmin, user?.organizationId])

  // Leave approvers are decided by the org's leave policy (manager / named approvers /
  // admin), not by a permission leaf — so the server answers it. Unknown → hidden
  // (fail closed), same as an entitlement that hasn't loaded.
  const orgId = user?.organizationId ?? ''
  const ecsOn = !!entitlements && entitlements.ecs !== 'off'
  const [leaveApprover, setLeaveApprover] = useState<boolean | undefined>(
    orgId ? leaveApproverCache.get(orgId) : undefined,
  )
  useEffect(() => {
    if (!orgId || !ecsOn) return
    if (leaveApproverCache.has(orgId)) {
      setLeaveApprover(leaveApproverCache.get(orgId))
      return
    }
    let cancelled = false
    leaveApi
      .approvalEligibility(orgId)
      .then((r) => {
        leaveApproverCache.set(orgId, r.can_approve)
        if (!cancelled) setLeaveApprover(r.can_approve)
      })
      .catch(() => { if (!cancelled) setLeaveApprover(false) })
    return () => { cancelled = true }
  }, [orgId, ecsOn])

  const isAdminOrHR = !!user?.is_admin
  const canSeeMasters =
    isAdmin ||
    TASK_CONFIG_LEAVES.some(
      (k) => can(k, 'write') || can(k, 'edit') || can(k, 'delete'),
    )

  // While the "Delegated to me" view is hidden, Delegation is a delegators-only
  // tool — so a user who can't delegate shouldn't even see the nav entry. (Restore
  // by loosening this alongside re-enabling the incoming view in the page.)
  const canDelegate = isAdmin || can('delegation.delegation.manage', 'write')

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c
      try { window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }

  function isActive(href: string): boolean {
    if (href === '/dashboard/tasks') return pathname === '/dashboard/tasks'
    if (href === '/dashboard/projects') {
      // "Projects" covers the overview and per-project pages, but not the
      // sibling section pages that have their own sidebar entry / tab.
      return pathname === '/dashboard/projects' ||
        (pathname.startsWith('/dashboard/projects/') &&
          !['/dashboard/projects/my', '/dashboard/projects/managing', '/dashboard/projects/templates']
            .some((p) => pathname.startsWith(p)))
    }
    // Most specific entry wins: on a nested route only the deepest matching entry
    // lights up (e.g. Tickets › My Tickets, not Tickets as well).
    const matches = (h: string) => pathname === h || pathname.startsWith(h + '/')
    if (!matches(href)) return false
    return !ALL_HREFS.some((h) => h.length > href.length && h.startsWith(href + '/') && matches(h))
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
          Work
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

      {/* Nav groups */}
      <nav className="sidebar-scroll flex-1 overflow-y-auto py-3 px-2 flex flex-col gap-0.5">
        {NAV_GROUPS.map((group, gi) => {
          const entitlementState = entitlements?.[group.module]
          // Fail closed: hide an entitlement-gated group until its ceiling loads,
          // rather than flashing a module the org may not have bought.
          if (group.module && !entitlements) return null
          if (entitlementState === 'off') return null
          // Delegation section is visible only to people who can delegate (its
          // recipient view is currently hidden — see canDelegate above).
          if (group.module === 'delegation' && !canDelegate) return null
          const visibleItems = group.items.filter((item) => {
            if (item.taskConfigGated) return canSeeMasters
            if (item.multiOrgOnly && !multiOrg) return false
            if (item.leaveApproverOnly) return leaveApprover === true
            return !(item.adminOnly && !isAdminOrHR)
          })
          if (visibleItems.length === 0) return null

          return (
            <React.Fragment key={gi}>
              {gi > 0 && (
                <div className={['my-1 h-px bg-white/10', collapsed ? 'mx-1' : 'mx-1 md:mx-2'].join(' ')} />
              )}
              {group.label && (
                <p
                  className={[
                    'px-3 pt-1 pb-0.5 text-[10px] font-semibold text-[#475569] uppercase tracking-widest',
                    collapsed ? 'hidden' : 'hidden md:block',
                  ].join(' ')}
                >
                  {group.label}
                  {entitlementState === 'preview' && (
                    <span className="ml-2 normal-case tracking-normal text-[9px] text-[#FBBF24]">Read only</span>
                  )}
                </p>
              )}
              {visibleItems.map((item) => {
                if (item.disabled) {
                  return (
                    <Tooltip key={item.href} label={collapsed ? item.label : undefined}>
                    <span
                      className={[
                        'flex items-center rounded-[8px] py-2.5 text-sm font-medium text-[#334155] cursor-not-allowed',
                        collapsed ? 'justify-center px-2' : 'justify-center px-2 md:justify-start md:gap-3 md:px-3',
                      ].join(' ')}
                    >
                      <item.Icon size={18} className="shrink-0" />
                      {!collapsed && (
                        <>
                          <span className="hidden md:inline">{item.label}</span>
                          <span className="ml-auto hidden md:block text-[9px] font-semibold text-[#475569] bg-[#1E293B] px-1.5 py-0.5 rounded">
                            Soon
                          </span>
                        </>
                      )}
                    </span>
                    </Tooltip>
                  )
                }

                const active = isActive(item.href)
                return (
                  <Tooltip key={item.href} label={collapsed ? item.label : undefined}>
                  <Link
                    href={item.href}
                    className={[
                      'flex items-center rounded-[8px] py-2.5 text-sm font-medium transition-colors duration-150 whitespace-nowrap',
                      collapsed ? 'justify-center px-2' : 'justify-center px-2 md:justify-start md:gap-3 md:px-3',
                      active
                        ? 'bg-[#2563EB] text-white'
                        : 'text-[#CBD5E1] hover:bg-[#1E293B] hover:text-[#F1F5F9]',
                    ].join(' ')}
                  >
                    <item.Icon size={18} className="shrink-0" />
                    {!collapsed && <span className="hidden md:inline">{item.label}</span>}
                  </Link>
                  </Tooltip>
                )
              })}
            </React.Fragment>
          )
        })}
      </nav>
    </aside>
  )
}
