'use client'

import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { tasksApi } from '@/lib/api/tasks'
import type { Task, TaskCategory, TaskPriority, TaskStatus } from '@/lib/types/tasks'
import { TERMINAL_STATUS_PHASES } from '@/lib/types/tasks'
import TaskListRow from '@/components/tasks/TaskListRow'
import TaskListToolbar from '@/components/tasks/TaskListToolbar'
import { useTaskListView, GroupedTaskList, ClearNarrowingButton } from '@/components/tasks/taskListView'
import { type TaskSort, DEFAULT_TASK_SORT } from '@/components/tasks/TaskSortControl'
import { useSessionState } from '@/lib/tasks/useSessionState'
import KanbanView from '@/components/tasks/KanbanView'
import CalendarView from '@/components/tasks/CalendarView'
import CreateTaskModal from '@/components/tasks/CreateTaskModal'
import { type TaskFilters, EMPTY_TASK_FILTERS, isTaskFiltered, applyTaskFilters, normalizeTaskFilters } from '@/components/tasks/TaskFilterBar'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { Plus, UserCheck, LayoutList, Columns, CalendarDays, AlertCircle } from 'lucide-react'

type ViewMode = 'list' | 'kanban' | 'calendar'

// Surface the backend's real message (completion gate, already-closed, etc.).
function apiErrorMessage(e: unknown, fallback: string): string {
  const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message
  if (Array.isArray(m)) return m[0] ?? fallback
  return typeof m === 'string' && m ? m : fallback
}

export default function AssignedByMePage() {
  const { user } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { addToast } = useToast()
  const orgId = user?.organizationId ?? ''

  const [tasks, setTasks] = useState<Task[]>([])
  const [categories, setCategories] = useState<TaskCategory[]>([])
  const [priorities, setPriorities] = useState<TaskPriority[]>([])
  const [statuses, setStatuses] = useState<TaskStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)

  const rawView = searchParams.get('view')
  const viewMode: ViewMode = rawView === 'kanban' || rawView === 'calendar' ? rawView : 'list'
  function setViewMode(mode: ViewMode) {
    const params = new URLSearchParams(searchParams.toString())
    if (mode === 'list') params.delete('view')
    else params.set('view', mode)
    router.replace(`/dashboard/tasks/assigned?${params.toString()}`)
  }

  // Stored filters may predate a section (e.g. tags) — normalise so old objects still load.
  const [storedFilters, setFilters] = useSessionState<TaskFilters>('tasks:assigned:filters', { ...EMPTY_TASK_FILTERS })
  const filters = useMemo(() => normalizeTaskFilters(storedFilters), [storedFilters])
  const [search, setSearch] = useSessionState('tasks:assigned:search', '')
  const [sort, setSort] = useSessionState<TaskSort>('tasks:assigned:sort', { ...DEFAULT_TASK_SORT })

  // Assigner-side close controls. Mark Incomplete captures a required reason in a
  // popup here; Mark Complete closes it outright, or sends the assigner to the task
  // page when a clean close isn't possible from the list (gate / pending parts).
  const [incompleteTask, setIncompleteTask] = useState<Task | null>(null)
  const [incompleteReason, setIncompleteReason] = useState('')
  const [incompleteSubmitting, setIncompleteSubmitting] = useState(false)

  const loadData = useCallback(() => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    Promise.all([
      tasksApi.getAssignedByMe(orgId).catch(() => []),
      tasksApi.getCategories(orgId).catch(() => []),
      tasksApi.getPriorities(orgId).catch(() => []),
      tasksApi.getStatuses(orgId).catch(() => []),
    ]).then(([t, c, p, s]) => {
      // Tasks a workflow created aren't handed out by a person: they never count as
      // "assigned by me" (the server leaves them out; older responses are filtered here).
      setTasks((t as Task[]).filter((x) => !x.workflow && !x.workflow_instance_step_id))
      setCategories(c); setPriorities(p); setStatuses(s)
    }).finally(() => setLoading(false))
  }, [orgId])

  useEffect(() => { loadData() }, [loadData])

  const filtered = useMemo(() => applyTaskFilters(tasks, filters, statuses), [tasks, filters, statuses])
  const isFiltered = isTaskFiltered(filters)

  // Header summary — across ALL tasks I've assigned (independent of the active filters).
  const openCount = useMemo(
    () => tasks.filter((t) => {
      const type = statuses.find((s) => s.id === t.status_id)?.type ?? t.status?.type
      return !!type && !TERMINAL_STATUS_PHASES.includes(type)
    }).length,
    [tasks, statuses],
  )
  const overdueCount = useMemo(() => tasks.filter((t) => t.is_overdue).length, [tasks])

  // Same shared pipeline as My Tasks. As the assigner I see the OVERALL status, so no
  // per-track mapping (mapMyTrack off).
  const { sortedTasks, groups } = useTaskListView(filtered, {
    search,
    sort,
    priorities,
    statuses,
  })

  // As the assigner, try to close the task straight from the row. When a clean close
  // isn't possible from here — a checklist/proof gate, or a multi-person task with
  // pending parts that needs the proper confirm — take the assigner to the task page.
  async function handleComplete(task: Task) {
    try {
      const updated = await tasksApi.completeTask(orgId, task.id)
      setTasks((ts) => ts.map((t) => (t.id === task.id ? updated : t)))
      addToast('Task marked complete.', 'success')
    } catch (e) {
      const msg = apiErrorMessage(e, 'Could not complete this task from here.')
      addToast(`${msg} Opening the task to finish closing it.`, 'warning')
      router.push(`/dashboard/tasks/${task.id}`)
    }
  }

  // The assigner closing a task as not-done always closes the WHOLE task (a reason is
  // required) — unlike My Tasks, there's no "just my part" here.
  async function submitIncomplete() {
    if (!incompleteTask) return
    const reason = incompleteReason.trim()
    if (!reason) { addToast('A reason is required to mark a task incomplete.', 'warning'); return }
    setIncompleteSubmitting(true)
    try {
      const updated = await tasksApi.markIncomplete(orgId, incompleteTask.id, reason)
      setTasks((ts) => ts.map((t) => (t.id === incompleteTask.id ? updated : t)))
      addToast('Task marked incomplete.', 'success')
      setIncompleteTask(null)
      setIncompleteReason('')
    } catch (e) {
      addToast(apiErrorMessage(e, 'Could not mark this task incomplete.'), 'error')
    } finally {
      setIncompleteSubmitting(false)
    }
  }

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

  // A single compact row. The assigner can Complete / Mark Incomplete from the row's
  // status menu, but not move a worker's per-person status — so no onStatusChange.
  const renderRow = (task: Task, deadlineDisplay: 'time' | 'date') => (
    <TaskListRow
      key={task.id}
      task={task}
      onClick={() => router.push(`/dashboard/tasks/${task.id}`)}
      priorities={priorities}
      statuses={statuses}
      categories={categories}
      onComplete={() => handleComplete(task)}
      onMarkIncomplete={() => { setIncompleteReason(''); setIncompleteTask(task) }}
      currentUserId={user?.id}
      deadlineDisplay={deadlineDisplay}
    />
  )

  return (
    <div className="space-y-6">
      {/* Title row — summary lead; compact Create action + view switcher on the right
          (mirrors My Tasks so the two headers line up). */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[28px] font-medium text-text-primary leading-tight">Assigned by Me</h1>
          <p className="mt-1 text-[15px] text-text-secondary">
            {openCount} open
            {overdueCount > 0 && (
              <>
                {' · '}
                <span className="text-danger font-medium">{overdueCount} overdue</span>
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center border border-border-light rounded-control bg-surface p-0.5 gap-0.5">
            {([
              { mode: 'list', icon: <LayoutList size={15} />, label: 'List' },
              { mode: 'kanban', icon: <Columns size={15} />, label: 'Kanban' },
              { mode: 'calendar', icon: <CalendarDays size={15} />, label: 'Calendar' },
            ] as const).map(({ mode, icon, label }) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-control text-sm font-medium transition-colors ${
                  viewMode === mode
                    ? 'bg-primary text-white'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface-control'
                }`}
              >
                {icon}
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-[7px] bg-primary text-white rounded-control text-sm font-medium hover:bg-primary-hover transition-colors"
          >
            <Plus size={15} />
            <span className="hidden sm:inline">Create Task</span>
          </button>
        </div>
      </div>

      {/* Toolbar — search + filters + sort (the calendar filters by date itself) */}
      {viewMode !== 'calendar' && (
        <TaskListToolbar
          search={search}
          onSearch={setSearch}
          filters={filters}
          onFilters={setFilters}
          sort={sort}
          onSort={setSort}
          showSort={viewMode === 'list'}
          tasks={tasks}
          statuses={statuses}
          priorities={priorities}
          categories={categories}
          currentUserId={user?.id}
        />
      )}

      {/* Content */}
      {viewMode === 'list' && (
        <>
          {(isFiltered || search.trim()) && (
            <p className="text-sm text-text-secondary">
              Showing {sortedTasks.length} of {tasks.length} task{tasks.length !== 1 ? 's' : ''}
            </p>
          )}
          {sortedTasks.length === 0 ? (
            <div className="bg-surface border border-border-light rounded-card shadow-card flex flex-col items-center justify-center py-20">
              <div className="w-14 h-14 rounded-full bg-surface-control flex items-center justify-center mb-4">
                <UserCheck size={24} className="text-text-muted" />
              </div>
              <p className="font-medium text-text-primary">
                {search.trim() ? `No tasks match ‘${search.trim()}’` : isFiltered ? 'No tasks match your filters' : 'No tasks assigned by you'}
              </p>
              <p className="text-sm text-text-secondary mt-1">
                {search.trim() ? 'Try a different search term.' : isFiltered ? 'Try adjusting your filters.' : 'Tasks you create and assign to others will appear here.'}
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
        </>
      )}

      {viewMode === 'kanban' && (
        <KanbanView
          orgId={orgId}
          tasks={sortedTasks}
          statuses={statuses}
          priorities={priorities}
          categories={categories}
          perspective="owner"
          currentUserId={user?.id}
          onChanged={(u) => setTasks((ts) => ts.map((t) => (t.id === u.id ? u : t)))}
          onTaskClick={(id) => router.push(`/dashboard/tasks/${id}`)}
        />
      )}

      {viewMode === 'calendar' && (
        <CalendarView
          tasks={tasks}
          priorities={priorities}
          onTaskClick={(id) => router.push(`/dashboard/tasks/${id}`)}
        />
      )}

      {/* Mark-incomplete reason popup — the assigner closes the whole task as not-done. */}
      <Modal
        isOpen={!!incompleteTask}
        onClose={() => { if (!incompleteSubmitting) { setIncompleteTask(null); setIncompleteReason('') } }}
        title="Mark task incomplete"
        size="md"
        closeOnEscape={!incompleteSubmitting}
      >
        <div className="space-y-4">
          <div className="flex items-start gap-2 px-3 py-2 rounded-control bg-warning-bg border border-warning-border">
            <AlertCircle size={15} className="text-warning shrink-0 mt-0.5" />
            <p className="text-xs text-warning">
              This closes the task as not-done for everyone. A reason is required.
            </p>
          </div>

          {incompleteTask && (
            <p className="text-sm font-medium text-text-primary truncate">{incompleteTask.title}</p>
          )}

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Reason</label>
            <textarea
              value={incompleteReason}
              onChange={(e) => setIncompleteReason(e.target.value)}
              rows={3}
              autoFocus
              placeholder="Why is this being closed as not-done?"
              className="w-full rounded-control border border-border-light px-3 py-2 text-sm text-text-primary focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary resize-none"
            />
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => { setIncompleteTask(null); setIncompleteReason('') }}
              disabled={incompleteSubmitting}
              className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-text-secondary rounded-control hover:bg-surface-control disabled:opacity-60 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submitIncomplete}
              disabled={incompleteSubmitting || !incompleteReason.trim()}
              className="w-full sm:w-auto px-5 py-2 text-sm font-medium text-white bg-danger rounded-control hover:bg-danger-hover disabled:bg-surface-control-pressed disabled:text-text-muted disabled:cursor-not-allowed transition-colors"
            >
              {incompleteSubmitting ? 'Saving…' : 'Mark Incomplete'}
            </button>
          </div>
        </div>
      </Modal>

      <CreateTaskModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={() => { setShowCreateModal(false); loadData() }}
        onImported={loadData}
        categories={categories}
        priorities={priorities}
        statuses={statuses}
      />
    </div>
  )
}
