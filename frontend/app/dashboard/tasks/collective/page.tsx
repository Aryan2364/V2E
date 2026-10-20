'use client'

import React, { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { tasksApi } from '@/lib/api/tasks'
import type { CollectiveOrgTasks, Task, TaskPriority, TaskStatus, TaskCategory } from '@/lib/types/tasks'
import TaskCard from '@/components/tasks/TaskCard'
import { Globe, Building2 } from 'lucide-react'
import { PageHeader } from '@/components/shell/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'

export default function CollectivePage() {
  const router = useRouter()
  const [data, setData] = useState<CollectiveOrgTasks[]>([])
  const [loading, setLoading] = useState(true)
  const [activeOrg, setActiveOrg] = useState<string>('all')

  useEffect(() => {
    tasksApi.getCollective().then(setData).catch(() => setData([])).finally(() => setLoading(false))
  }, [])

  // Merged lists for "All" tab
  const allTasks = useMemo(() => data.flatMap((d) => d.tasks), [data])

  // Gather all unique priorities, statuses, categories across orgs
  const priorities = useMemo(() => {
    const map = new Map<string, TaskPriority>()
    allTasks.forEach((t) => { if (t.priority) map.set(t.priority.id, t.priority) })
    return Array.from(map.values())
  }, [allTasks])

  const statuses = useMemo(() => {
    const map = new Map<string, TaskStatus>()
    allTasks.forEach((t) => { if (t.status) map.set(t.status.id, t.status) })
    return Array.from(map.values())
  }, [allTasks])

  const categories = useMemo(() => {
    const map = new Map<string, TaskCategory>()
    allTasks.forEach((t) => { if (t.category) map.set(t.category.id, t.category) })
    return Array.from(map.values())
  }, [allTasks])

  const orgById = useMemo(() => new Map(data.map((d) => [d.organization.id, d.organization])), [data])

  const displayTasks: Task[] = activeOrg === 'all'
    ? allTasks
    : (data.find((d) => d.organization.id === activeOrg)?.tasks ?? [])

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Collective view"
          trail={[{ label: 'Tasks', href: '/dashboard/tasks' }]}
          meta="Tasks across all organizations you belong to."
        />
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-control" />
          ))}
        </div>
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Collective view"
          trail={[{ label: 'Tasks', href: '/dashboard/tasks' }]}
          meta="Tasks across all organizations you belong to."
        />
        <EmptyState variant="nothing-yet" heading="No organizations found">
          You don't appear to be a member of any organization.
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Collective view"
        trail={[{ label: 'Tasks', href: '/dashboard/tasks' }]}
        meta="Tasks across all organizations you belong to."
      />

      {/* Org tabs */}
      <div className="flex items-center gap-1 border-b border-border-light overflow-x-auto pb-0">
        {/* All tab */}
        <button
          onClick={() => setActiveOrg('all')}
          className={`flex items-center gap-2 px-4 py-2.5 text-body font-medium border-b-2 outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring transition-[background-color,border-color,color] whitespace-nowrap -mb-px ${
            activeOrg === 'all'
              ? 'border-primary text-primary-text'
              : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
        >
          <Globe size={14} />
          All organizations
          <span className="ml-1 text-meta bg-surface-control text-text-secondary px-1.5 py-0.5 rounded-full font-medium">
            {allTasks.length}
          </span>
        </button>

        {/* Per-org tabs */}
        {data.map((d) => (
          <button
            key={d.organization.id}
            onClick={() => setActiveOrg(d.organization.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-body font-medium border-b-2 outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring transition-[background-color,border-color,color] whitespace-nowrap -mb-px ${
              activeOrg === d.organization.id
                ? 'border-primary text-primary-text'
                : 'border-transparent text-text-muted hover:text-text-primary'
            }`}
          >
            <Building2 size={14} />
            {d.organization.name}
            <span className="ml-1 text-meta bg-surface-control text-text-secondary px-1.5 py-0.5 rounded-full font-medium">
              {d.tasks.length}
            </span>
          </button>
        ))}
      </div>

      {/* Task count */}
      <p className="text-body text-text-secondary">
        {displayTasks.length} task{displayTasks.length !== 1 ? 's' : ''}
      </p>

      {/* Task list */}
      {displayTasks.length === 0 ? (
        <EmptyState variant="nothing-yet" heading="No tasks">
          This organization has no tasks yet.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {displayTasks.map((task) => {
            const org = orgById.get(task.organization_id)
            return (
              <div key={task.id} className="relative">
                {activeOrg === 'all' && org && (
                  <div className="absolute top-0 right-3 z-10">
                    <span className="text-meta font-medium px-2 py-0.5 rounded-b-[6px] bg-surface-control text-text-secondary border border-border-light border-t-0">
                      {org.name}
                    </span>
                  </div>
                )}
                <TaskCard
                  task={task}
                  onClick={() => router.push(`/dashboard/tasks/${task.id}`)}
                  priorities={priorities}
                  statuses={statuses}
                  categories={categories}
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
