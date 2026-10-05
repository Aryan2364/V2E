'use client'

import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { tasksApi } from '@/lib/api/tasks'
import type { Task, TaskCategory, TaskPriority, TaskStatus } from '@/lib/types/tasks'
import { TERMINAL_STATUS_PHASES } from '@/lib/types/tasks'
import TaskListRow from '@/components/tasks/TaskListRow'
import TaskListToolbar from '@/components/tasks/TaskListToolbar'
import { useTaskListView, GroupedTaskList, ClearNarrowingButton } from '@/components/tasks/taskListView'
import { type TaskSort, DEFAULT_TASK_SORT } from '@/components/tasks/TaskSortControl'
import { useSessionState } from '@/lib/tasks/useSessionState'
import { type TaskFilters, EMPTY_TASK_FILTERS, isTaskFiltered, applyTaskFilters, normalizeTaskFilters } from '@/components/tasks/TaskFilterBar'
import { AlertTriangle } from 'lucide-react'

export default function EscalatedPage() {
  const { user } = useAuth()
  const router = useRouter()
  const orgId = user?.organizationId ?? ''

  const [tasks, setTasks] = useState<Task[]>([])
  const [categories, setCategories] = useState<TaskCategory[]>([])
  const [priorities, setPriorities] = useState<TaskPriority[]>([])
  const [statuses, setStatuses] = useState<TaskStatus[]>([])
  const [loading, setLoading] = useState(true)
  // Stored filters may predate a section (e.g. tags) — normalise so old objects still load.
  const [storedFilters, setFilters] = useSessionState<TaskFilters>('tasks:escalated:filters', { ...EMPTY_TASK_FILTERS })
  const filters = useMemo(() => normalizeTaskFilters(storedFilters), [storedFilters])
  const [search, setSearch] = useSessionState('tasks:escalated:search', '')
  const [sort, setSort] = useSessionState<TaskSort>('tasks:escalated:sort', { ...DEFAULT_TASK_SORT })

  const loadData = useCallback(() => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    Promise.all([
      tasksApi.getEscalated(orgId).catch(() => []),
      tasksApi.getCategories(orgId).catch(() => []),
      tasksApi.getPriorities(orgId).catch(() => []),
      tasksApi.getStatuses(orgId).catch(() => []),
    ]).then(([t, c, p, s]) => {
      setTasks(t)
      setCategories(c)
      setPriorities(p)
      setStatuses(s)
    }).finally(() => setLoading(false))
  }, [orgId])

  useEffect(() => { loadData() }, [loadData])

  const filtered = useMemo(() => applyTaskFilters(tasks, filters, statuses), [tasks, filters, statuses])
  const isFiltered = isTaskFiltered(filters)

  // Header summary — across ALL escalated tasks (independent of the active filters).
  const openCount = useMemo(
    () => tasks.filter((t) => {
      const type = statuses.find((s) => s.id === t.status_id)?.type ?? t.status?.type
      return !!type && !TERMINAL_STATUS_PHASES.includes(type)
    }).length,
    [tasks, statuses],
  )
  const overdueCount = useMemo(() => tasks.filter((t) => t.is_overdue).length, [tasks])

  // Same shared pipeline as the other task lists. Escalation contacts view the overall
  // status, so no per-track mapping.
  const { sortedTasks, groups } = useTaskListView(filtered, { search, sort, priorities, statuses })

  if (!orgId) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="font-semibold text-[#0F172A]">No organization found</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Read-only row — an escalation view, no inline status/complete actions.
  const renderRow = (task: Task, deadlineDisplay: 'time' | 'date') => (
    <TaskListRow
      key={task.id}
      task={task}
      onClick={() => router.push(`/dashboard/tasks/${task.id}`)}
      priorities={priorities}
      statuses={statuses}
      categories={categories}
      currentUserId={user?.id}
      deadlineDisplay={deadlineDisplay}
    />
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] font-bold text-[#0F172A] leading-tight">Escalated Tasks</h1>
        <p className="mt-1 text-[15px] text-[#475569]">
          {openCount} open
          {overdueCount > 0 && (
            <>
              {' · '}
              <span className="text-[#DC2626] font-medium">{overdueCount} overdue</span>
            </>
          )}
        </p>
      </div>

      <TaskListToolbar
        search={search}
        onSearch={setSearch}
        filters={filters}
        onFilters={setFilters}
        sort={sort}
        onSort={setSort}
        showSort
        tasks={tasks}
        statuses={statuses}
        priorities={priorities}
        categories={categories}
        currentUserId={user?.id}
      />

      {(isFiltered || search.trim()) && (
        <p className="text-sm text-[#475569]">
          Showing {sortedTasks.length} of {tasks.length} escalated task{tasks.length !== 1 ? 's' : ''}
        </p>
      )}

      {sortedTasks.length === 0 ? (
        <div className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] flex flex-col items-center justify-center py-20">
          <div className="w-14 h-14 rounded-full bg-[#FEF9C3] flex items-center justify-center mb-4">
            <AlertTriangle size={24} className="text-[#D97706]" />
          </div>
          <p className="font-semibold text-[#0F172A]">
            {search.trim() ? `No tasks match ‘${search.trim()}’` : isFiltered ? 'No tasks match your filters' : 'No escalated tasks'}
          </p>
          <p className="text-sm text-[#475569] mt-1">
            {search.trim() ? 'Try a different search term.' : isFiltered ? 'Try adjusting your filters.' : 'Tasks flagged for escalation will appear here.'}
          </p>
          <ClearNarrowingButton
            hasSearch={!!search.trim()}
            hasFilters={isFiltered}
            onClear={() => { setSearch(''); setFilters({ ...EMPTY_TASK_FILTERS }) }}
          />
        </div>
      ) : (
        <GroupedTaskList groups={groups} sortedTasks={sortedTasks} renderRow={renderRow} />
      )}
    </div>
  )
}
