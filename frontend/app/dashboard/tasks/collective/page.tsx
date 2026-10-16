'use client'

import React, { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { tasksApi } from '@/lib/api/tasks'
import type { CollectiveOrgTasks, Task, TaskPriority, TaskStatus, TaskCategory } from '@/lib/types/tasks'
import TaskCard from '@/components/tasks/TaskCard'
import { Globe, Building2 } from 'lucide-react'

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
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <div className="w-14 h-14 rounded-full bg-surface-control flex items-center justify-center mb-4">
          <Globe size={24} className="text-text-muted" />
        </div>
        <p className="font-medium text-text-primary">No organizations found</p>
        <p className="text-sm text-text-secondary mt-1">You don't appear to be a member of any organization.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-[28px] font-medium text-text-primary leading-tight">Collective View</h1>
        <p className="mt-1 text-[15px] text-text-secondary">Tasks across all organizations you belong to.</p>
      </div>

      {/* Org tabs */}
      <div className="flex items-center gap-1 border-b border-border-light overflow-x-auto pb-0">
        {/* All tab */}
        <button
          onClick={() => setActiveOrg('all')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap -mb-px ${
            activeOrg === 'all'
              ? 'border-primary text-primary-text'
              : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
        >
          <Globe size={14} />
          All Organizations
          <span className="ml-1 text-xs bg-surface-control text-text-secondary px-1.5 py-0.5 rounded-full font-medium">
            {allTasks.length}
          </span>
        </button>

        {/* Per-org tabs */}
        {data.map((d) => (
          <button
            key={d.organization.id}
            onClick={() => setActiveOrg(d.organization.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap -mb-px ${
              activeOrg === d.organization.id
                ? 'border-primary text-primary-text'
                : 'border-transparent text-text-muted hover:text-text-primary'
            }`}
          >
            <Building2 size={14} />
            {d.organization.name}
            <span className="ml-1 text-xs bg-surface-control text-text-secondary px-1.5 py-0.5 rounded-full font-medium">
              {d.tasks.length}
            </span>
          </button>
        ))}
      </div>

      {/* Task count */}
      <p className="text-sm text-text-secondary">
        {displayTasks.length} task{displayTasks.length !== 1 ? 's' : ''}
      </p>

      {/* Task list */}
      {displayTasks.length === 0 ? (
        <div className="bg-surface border border-border-light rounded-card shadow-card flex flex-col items-center justify-center py-20">
          <div className="w-14 h-14 rounded-full bg-surface-control flex items-center justify-center mb-4">
            <Globe size={24} className="text-text-muted" />
          </div>
          <p className="font-medium text-text-primary">No tasks</p>
          <p className="text-sm text-text-secondary mt-1">This organization has no tasks yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {displayTasks.map((task) => {
            const org = orgById.get(task.organization_id)
            return (
              <div key={task.id} className="relative">
                {activeOrg === 'all' && org && (
                  <div className="absolute top-0 right-3 z-10">
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-b-[6px] bg-surface-control text-text-secondary border border-border-light border-t-0">
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
