'use client'

import React, { useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { usePermissions } from '@/lib/auth/use-permissions'
import { PageHeader } from '@/components/shell/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { Settings2, Tag, Tags, BarChart, Activity, List, Users, Ticket as TicketIcon, CheckSquare, Bell } from 'lucide-react'
import type { TaskMasterTab, TicketMasterTab } from '@/components/tasks/masters/types'

function TabFallback() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-control" />
      ))}
    </div>
  )
}

const ConfigTab = dynamic(() => import('@/components/tasks/masters/ConfigTab'), { loading: () => <TabFallback /> })
const CategoriesTab = dynamic(() => import('@/components/tasks/masters/CategoriesTab'), { loading: () => <TabFallback /> })
const TagsTab = dynamic(() => import('@/components/tasks/masters/TagsTab'), { loading: () => <TabFallback /> })
const PrioritiesTab = dynamic(() => import('@/components/tasks/masters/PrioritiesTab'), { loading: () => <TabFallback /> })
const StatusesTab = dynamic(() => import('@/components/tasks/masters/StatusesTab'), { loading: () => <TabFallback /> })
const ChecklistTemplatesTab = dynamic(() => import('@/components/tasks/masters/ChecklistTemplatesTab'), { loading: () => <TabFallback /> })
const AssigneeVisibilityTab = dynamic(() => import('@/components/tasks/AssigneeVisibilityTab').then((m) => m.AssigneeVisibilityTab), { loading: () => <TabFallback /> })
const TktConfigTab = dynamic(() => import('@/components/tasks/masters/TktConfigTab'), { loading: () => <TabFallback /> })
const TktTypesTab = dynamic(() => import('@/components/tasks/masters/TktTypesTab'), { loading: () => <TabFallback /> })
const TktCategoriesTab = dynamic(() => import('@/components/tasks/masters/TktCategoriesTab'), { loading: () => <TabFallback /> })
const TktPrioritiesTab = dynamic(() => import('@/components/tasks/masters/TktPrioritiesTab'), { loading: () => <TabFallback /> })
const TktStatusesTab = dynamic(() => import('@/components/tasks/masters/TktStatusesTab'), { loading: () => <TabFallback /> })
const TktResolverGroupsTab = dynamic(() => import('@/components/tasks/masters/TktResolverGroupsTab'), { loading: () => <TabFallback /> })
const TktTemplatesTab = dynamic(() => import('@/components/tasks/masters/TktTemplatesTab'), { loading: () => <TabFallback /> })
const NotificationsMasterTab = dynamic(() => import('@/components/tasks/masters/NotificationsMasterTab'), { loading: () => <TabFallback /> })

// ─── Page ─────────────────────────────────────────────────────────────────────

const taskTabs: { key: TaskMasterTab; label: string; icon: React.ReactNode }[] = [
  { key: 'assignee_visibility', label: 'Assignee Visibility', icon: <Users size={15} /> },
  { key: 'checklists', label: 'Checklist Templates', icon: <List size={15} /> },
  { key: 'categories', label: 'Categories', icon: <Tag size={15} /> },
  { key: 'tags', label: 'Tags', icon: <Tags size={15} /> },
  { key: 'priorities', label: 'Priorities', icon: <BarChart size={15} /> },
  { key: 'statuses', label: 'Statuses', icon: <Activity size={15} /> },
  { key: 'config', label: 'Config', icon: <Settings2 size={15} /> },
]

// Each Task Masters tab is gated by the matching access-rights leaf. A user sees a
// tab only if they (or admin) hold any manage action on it; the backend re-enforces
// each action. Ticket Masters / Notifications remain admin-only as before.
const TASK_TAB_LEAF: Record<TaskMasterTab, string> = {
  config: 'tasks.config.settings.manage',
  categories: 'tasks.config.categories.manage',
  tags: 'tasks.config.tags.manage',
  priorities: 'tasks.config.priorities.manage',
  statuses: 'tasks.config.statuses.manage',
  checklists: 'tasks.config.checklist_templates.manage',
  assignee_visibility: 'tasks.config.assignee_visibility.manage',
}

const ticketTabs: { key: TicketMasterTab; label: string; icon: React.ReactNode }[] = [
  { key: 'config', label: 'Configuration', icon: <Settings2 size={15} /> },
  { key: 'types', label: 'Types', icon: <TicketIcon size={15} /> },
  { key: 'categories', label: 'Categories', icon: <Tag size={15} /> },
  { key: 'priorities', label: 'Priorities', icon: <BarChart size={15} /> },
  { key: 'statuses', label: 'Statuses', icon: <Activity size={15} /> },
  { key: 'resolver-groups', label: 'Resolver Groups', icon: <Users size={15} /> },
  { key: 'templates', label: 'Templates', icon: <CheckSquare size={15} /> },
]

const TASK_TAB_KEYS: TaskMasterTab[] = ['config', 'categories', 'tags', 'priorities', 'statuses', 'checklists', 'assignee_visibility']
const TICKET_TAB_KEYS: TicketMasterTab[] = ['config', 'types', 'categories', 'priorities', 'statuses', 'resolver-groups', 'templates']

function readParam(name: string): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get(name)
}

export default function MastersPage() {
  const { user } = useAuth()
  const { can, isAdmin, loading: permsLoading } = usePermissions()
  const router = useRouter()
  const pathname = usePathname()
  const orgId = user?.organizationId ?? ''
  const [masterSection, setMasterSection] = useState<'tasks' | 'tickets' | 'notifications'>(() => {
    const s = readParam('section')
    return s === 'tickets' || s === 'notifications' ? s : 'tasks'
  })
  const [taskTab, setTaskTab] = useState<TaskMasterTab>(() => {
    const t = readParam('tab') as TaskMasterTab | null
    return t && TASK_TAB_KEYS.includes(t) ? t : 'assignee_visibility'
  })
  const [ticketTab, setTicketTab] = useState<TicketMasterTab>(() => {
    const t = readParam('tab') as TicketMasterTab | null
    return t && TICKET_TAB_KEYS.includes(t) ? t : 'config'
  })

  // Reflect the active section + tab in the URL so a reload (or a shared link)
  // lands on the same place. Uses replace so it doesn't pollute browser history.
  const syncUrl = useCallback((section: string, tab: string) => {
    const params = new URLSearchParams()
    params.set('section', section)
    params.set('tab', tab)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [router, pathname])

  if (!orgId) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="font-medium text-text-primary">No organization found</p>
      </div>
    )
  }

  if (permsLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-card" />
      </div>
    )
  }

  const canManage = (leaf: string) =>
    isAdmin || can(leaf, 'write') || can(leaf, 'edit') || can(leaf, 'delete')

  // Task Masters tabs the user may configure; Ticket Masters / Notifications stay admin-only.
  const visibleTaskTabs = taskTabs.filter((t) => canManage(TASK_TAB_LEAF[t.key]))
  const canViewTaskMasters = visibleTaskTabs.length > 0

  const availableSections = (
    [
      canViewTaskMasters ? (['tasks', 'Task'] as const) : null,
      isAdmin ? (['tickets', 'Ticket'] as const) : null,
      isAdmin ? (['notifications', 'Notifications'] as const) : null,
    ].filter(Boolean) as ReadonlyArray<readonly ['tasks' | 'tickets' | 'notifications', string]>
  )

  if (availableSections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <p className="font-medium text-text-primary">No access to task configuration</p>
        <p className="mt-1 text-body text-text-muted">
          You don&apos;t have permission to configure task masters. Contact an administrator.
        </p>
      </div>
    )
  }

  // Clamp the active section/tab to what's actually available for this user.
  const effectiveSection = availableSections.some(([k]) => k === masterSection)
    ? masterSection
    : availableSections[0][0]
  const effectiveTaskTab = visibleTaskTabs.some((t) => t.key === taskTab)
    ? taskTab
    : (visibleTaskTabs[0]?.key ?? 'config')

  const notifTabs: { key: string; label: string; icon: React.ReactNode }[] = [
    { key: 'config', label: 'Notification Settings', icon: <Bell size={15} /> },
  ]
  const activeTabs = effectiveSection === 'tasks' ? visibleTaskTabs : effectiveSection === 'tickets' ? ticketTabs : notifTabs

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PageHeader
        title="Work Settings"
        trail={[{ label: 'Tasks', href: '/dashboard/tasks' }]}
        meta="Configure system settings for tasks and tickets."
      />

      {/* Top-level switcher */}
      <div className="flex shrink-0 gap-2 p-1 bg-surface-control rounded-control w-fit">
        {availableSections.map(([key, label]) => (
          <button
            key={key}
            onClick={() => {
              setMasterSection(key)
              const tab = key === 'tasks' ? taskTab : key === 'tickets' ? ticketTab : 'config'
              syncUrl(key, tab)
            }}
            className={[
              'px-4 py-2 rounded-control text-body font-medium outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring transition-colors',
              effectiveSection === key ? 'bg-surface text-text-primary shadow-card' : 'text-text-secondary hover:text-text-primary',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col bg-surface border border-border-light rounded-card shadow-card">
        {/* Tab bar */}
        <div className="flex-none flex border-b border-border-light overflow-x-auto">
          {activeTabs.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                if (effectiveSection === 'tasks') {
                  setTaskTab(t.key as TaskMasterTab)
                  syncUrl('tasks', t.key)
                } else if (effectiveSection === 'tickets') {
                  setTicketTab(t.key as TicketMasterTab)
                  syncUrl('tickets', t.key)
                }
              }}
              className={[
                'flex items-center gap-2 px-4 py-3.5 text-body font-medium outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring transition-colors whitespace-nowrap border-b-2',
                (effectiveSection === 'tasks' ? effectiveTaskTab : effectiveSection === 'tickets' ? ticketTab : 'config') === t.key
                  ? 'text-primary-text border-primary'
                  : 'text-text-secondary border-transparent hover:text-text-primary',
              ].join(' ')}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Content: the frame keeps the window's height (section 10); the tab bar stays
            put and this area is what scrolls, so the page itself never does. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {effectiveSection === 'tasks' && (
            <>
              {effectiveTaskTab === 'config' && <ConfigTab orgId={orgId} />}
              {effectiveTaskTab === 'categories' && <CategoriesTab orgId={orgId} />}
              {effectiveTaskTab === 'tags' && <TagsTab orgId={orgId} />}
              {effectiveTaskTab === 'priorities' && <PrioritiesTab orgId={orgId} />}
              {effectiveTaskTab === 'statuses' && <StatusesTab orgId={orgId} />}
              {effectiveTaskTab === 'checklists' && <ChecklistTemplatesTab orgId={orgId} />}
              {effectiveTaskTab === 'assignee_visibility' && <AssigneeVisibilityTab orgId={orgId} />}
            </>
          )}
          {effectiveSection === 'tickets' && (
            <>
              {ticketTab === 'config' && <TktConfigTab orgId={orgId} />}
              {ticketTab === 'types' && <TktTypesTab orgId={orgId} />}
              {ticketTab === 'categories' && <TktCategoriesTab orgId={orgId} />}
              {ticketTab === 'priorities' && <TktPrioritiesTab orgId={orgId} />}
              {ticketTab === 'statuses' && <TktStatusesTab orgId={orgId} />}
              {ticketTab === 'resolver-groups' && <TktResolverGroupsTab orgId={orgId} />}
              {ticketTab === 'templates' && <TktTemplatesTab orgId={orgId} />}
            </>
          )}
          {effectiveSection === 'notifications' && <NotificationsMasterTab orgId={orgId} />}
        </div>
      </div>
    </div>
  )
}
