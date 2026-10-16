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
import { Eye } from 'lucide-react'
import { PageHeader } from '@/components/shell/page-header'

export default function CCTasksPage() {
  const { user } = useAuth()
  const router = useRouter()
  const orgId = user?.organizationId ?? ''

  const [tasks, setTasks] = useState<Task[]>([])
  const [categories, setCategories] = useState<TaskCategory[]>([])
  const [priorities, setPriorities] = useState<TaskPriority[]>([])
  const [statuses, setStatuses] = useState<TaskStatus[]>([])
  const [loading, setLoading] = useState(true)
  // Stored filters may predate a section (e.g. tags) — normalise so old objects still load.
  const [storedFilters, setFilters] = useSessionState<TaskFilters>('tasks:cc:filters', { ...EMPTY_TASK_FILTERS })
  const filters = useMemo(() => normalizeTaskFilters(storedFilters), [storedFilters])
  const [search, setSearch] = useSessionState('tasks:cc:search', '')
  const [sort, setSort] = useSessionState<TaskSort>('tasks:cc:sort', { ...DEFAULT_TASK_SORT })

  const loadData = useCallback(() => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    Promise.all([
      tasksApi.getMyCCTasks(orgId).catch(() => []),
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

  // Header summary — across ALL CC'd tasks (independent of the active filters).
  const openCount = useMemo(
    () => tasks.filter((t) => {
      const type = statuses.find((s) => s.id === t.status_id)?.type ?? t.status?.type
      return !!type && !TERMINAL_STATUS_PHASES.includes(type)
    }).length,
    [tasks, statuses],
  )
  const overdueCount = useMemo(() => tasks.filter((t) => t.is_overdue).length, [tasks])

  // Same shared pipeline as the other task lists. CC is a read-only view of the overall
  // status, so no per-track mapping.
  const { sortedTasks, groups } = useTaskListView(filtered, { search, sort, priorities, statuses })

  if (!orgId) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="font-medium text-text-primary">No organization found</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Read-only row — CC'd users view and comment, but can't change status or complete,
  // so no action handlers are passed (TaskListRow then shows a read-only status pill).
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
      <PageHeader
        title="CC'd Tasks"
        trail={[{ label: 'Tasks', href: '/dashboard/tasks' }]}
        meta={
          <>
            {openCount} open
            {overdueCount > 0 && (
              <>
                {' · '}
                <span className="text-danger font-medium">{overdueCount} overdue</span>
              </>
            )}
          </>
        }
      />

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
        <p className="text-sm text-text-secondary">
          Showing {sortedTasks.length} of {tasks.length} task{tasks.length !== 1 ? 's' : ''}
        </p>
      )}

      {sortedTasks.length === 0 ? (
        <div className="bg-surface border border-border-light rounded-card shadow-card flex flex-col items-center justify-center py-12">
          <div className="w-14 h-14 rounded-full bg-warning-bg flex items-center justify-center mb-4">
            <Eye size={24} className="text-warning" />
          </div>
          <p className="font-medium text-text-primary">
            {search.trim() ? `No tasks match ‘${search.trim()}’` : isFiltered ? 'No tasks match your filters' : 'No CC’d tasks'}
          </p>
          <p className="text-sm text-text-secondary mt-1">
            {search.trim() ? 'Try a different search term.' : isFiltered ? 'Try adjusting your filters.' : 'Tasks where you’re CC’d will appear here.'}
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
