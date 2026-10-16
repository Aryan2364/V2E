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
import { toast } from '@/components/ui/sonner'
import { CheckSquare, LayoutList, Columns, CalendarDays, AlertCircle, Plus } from 'lucide-react'
import { PageHeader } from '@/components/shell/page-header'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'

// Read the backend's real message (the completion gate, an already-closed task, etc.)
// instead of a generic failure — same convention as the task detail page.
function apiErrorMessage(e: unknown, fallback: string): string {
  const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message
  if (Array.isArray(m)) return m[0] ?? fallback
  return typeof m === 'string' && m ? m : fallback
}

// The completion gate rejects with a message naming the missing checklist / proof.
// Those (and only those) mean "go finish the requirements on the task page".
function isCompletionGate(msg: string): boolean {
  return /before (completing|finishing)|checklist|proof/i.test(msg)
}

type ViewMode = 'list' | 'kanban' | 'calendar'

export default function MyTasksPage() {
  const { user } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const orgId = user?.organizationId ?? ''

  const [tasks, setTasks] = useState<Task[]>([])
  const [categories, setCategories] = useState<TaskCategory[]>([])
  const [priorities, setPriorities] = useState<TaskPriority[]>([])
  const [statuses, setStatuses] = useState<TaskStatus[]>([])
  const [loading, setLoading] = useState(true)

  const rawView = searchParams.get('view')
  const viewMode: ViewMode = rawView === 'kanban' || rawView === 'calendar' ? rawView : 'list'
  function setViewMode(mode: ViewMode) {
    const params = new URLSearchParams(searchParams.toString())
    if (mode === 'list') params.delete('view')
    else params.set('view', mode)
    router.replace(`/dashboard/tasks/my?${params.toString()}`)
  }

  // Stored filters may predate a section (e.g. tags) — normalise so old objects still load.
  const [storedFilters, setFilters] = useSessionState<TaskFilters>('tasks:my:filters', { ...EMPTY_TASK_FILTERS })
  const filters = useMemo(() => normalizeTaskFilters(storedFilters), [storedFilters])
  const [search, setSearch] = useSessionState('tasks:my:search', '')
  const [sort, setSort] = useSessionState<TaskSort>('tasks:my:sort', { ...DEFAULT_TASK_SORT })
  const [showCreateModal, setShowCreateModal] = useState(false)

  // Mark-incomplete flow — a reason is required, captured in a popup right here on
  // My Tasks (no drill-in). Completion, by contrast, may need checklist/proof, which
  // live on the task page — so a gated Complete sends the user there.
  const [incompleteTask, setIncompleteTask] = useState<Task | null>(null)
  const [incompleteReason, setIncompleteReason] = useState('')
  const [incompleteSubmitting, setIncompleteSubmitting] = useState(false)

  const loadData = useCallback(() => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    Promise.all([
      tasksApi.getMyTasks(orgId).catch(() => []),
      tasksApi.getCategories(orgId).catch(() => []),
      tasksApi.getPriorities(orgId).catch(() => []),
      tasksApi.getStatuses(orgId).catch(() => []),
    ]).then(([t, c, p, s]) => {
      setTasks(t); setCategories(c); setPriorities(p); setStatuses(s)
    }).finally(() => setLoading(false))
  }, [orgId])

  useEffect(() => { loadData() }, [loadData])

  const filtered = useMemo(() => applyTaskFilters(tasks, filters, statuses), [tasks, filters, statuses])
  const isFiltered = isTaskFiltered(filters)

  // Header summary — computed across ALL my tasks (independent of the active filters),
  // so the count is a stable "here's your load" reading.
  const openCount = useMemo(
    () => tasks.filter((t) => {
      const type = statuses.find((s) => s.id === t.status_id)?.type ?? t.status?.type
      return !!type && !TERMINAL_STATUS_PHASES.includes(type)
    }).length,
    [tasks, statuses],
  )
  const overdueCount = useMemo(() => tasks.filter((t) => t.is_overdue).length, [tasks])

  // Filters + search + sort + day-grouping, all in one shared pipeline (identical to
  // Assigned). mapMyTrack shows MY status track in all_must mode.
  const { sortedTasks, groups } = useTaskListView(filtered, {
    search,
    sort,
    priorities,
    statuses,
    currentUserId: user?.id,
    mapMyTrack: true,
  })

  async function handleStatusChange(taskId: string, newStatusId: string) {
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return
    // Optimistic — patch the row in place so the list doesn't flash the spinner. In
    // all_must mode this call moves MY track (an assignee row), not the shared status.
    const prev = tasks
    const nextStatus = statuses.find((s) => s.id === newStatusId)
    const isAllMust = task.completion_mode === 'all_must_complete'
    setTasks((ts) => ts.map((t) => {
      if (t.id !== taskId) return t
      if (isAllMust) {
        return {
          ...t,
          assignees: (t.assignees ?? []).map((a) =>
            a.user_id === user?.id && !a.is_cc ? { ...a, status_id: newStatusId, status: nextStatus ?? a.status } : a,
          ),
        }
      }
      return { ...t, status_id: newStatusId, status: nextStatus ?? t.status }
    }))
    try {
      // Mode-aware, like the Kanban / task page: on My Tasks I'm always an assignee, so
      // all_must moves MY track, any_can moves the shared status. (Never updateTask — it
      // requires edit rights and would 403 a plain assignee.) The control only offers open
      // states, so this never hits a terminal transition.
      const updated =
        task.completion_mode === 'all_must_complete'
          ? await tasksApi.setAssigneeStatus(orgId, taskId, newStatusId)
          : await tasksApi.setSharedStatus(orgId, taskId, newStatusId)
      setTasks((ts) => ts.map((t) => (t.id === taskId ? updated : t)))
    } catch {
      setTasks(prev) // revert on failure
    }
  }

  // Mark Complete straight from the row. Completion runs the real gate: if the task
  // needs a checklist ticked or proof attached, the backend rejects with a message —
  // we surface it and send the user to the task page to satisfy it there.
  async function handleComplete(task: Task) {
    try {
      const updated = await tasksApi.completeTask(orgId, task.id)
      setTasks((ts) => ts.map((t) => (t.id === task.id ? updated : t)))
      toast.success('Task marked complete.')
    } catch (e) {
      const msg = apiErrorMessage(e, 'Could not complete this task.')
      if (isCompletionGate(msg)) {
        toast.warning(`${msg} Opening the task so you can add what’s needed.`)
        router.push(`/dashboard/tasks/${task.id}`)
      } else {
        toast.error(msg)
      }
    }
  }

  async function submitIncomplete() {
    if (!incompleteTask) return
    const reason = incompleteReason.trim()
    if (!reason) { toast.warning('A reason is required to mark a task incomplete.'); return }
    setIncompleteSubmitting(true)
    try {
      // all_must_complete → flag only MY part as can't-complete; any_can_complete →
      // close the whole task as not-done. Both require a reason (enforced above + backend).
      const updated =
        incompleteTask.completion_mode === 'all_must_complete'
          ? await tasksApi.flagCannotComplete(orgId, incompleteTask.id, reason)
          : await tasksApi.markIncomplete(orgId, incompleteTask.id, reason)
      setTasks((ts) => ts.map((t) => (t.id === incompleteTask.id ? updated : t)))
      toast.success('Task marked incomplete.')
      setIncompleteTask(null)
      setIncompleteReason('')
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not mark this task incomplete.'))
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
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-control" />
        ))}
      </div>
    )
  }

  // A single compact row. `task` here is already the display copy (per-track status in
  // all_must mode); its id + completion_mode are preserved, so the handlers still target
  // the real task.
  const renderRow = (task: Task, deadlineDisplay: 'time' | 'date') => (
    <TaskListRow
      key={task.id}
      task={task}
      onClick={() => router.push(`/dashboard/tasks/${task.id}`)}
      priorities={priorities}
      statuses={statuses}
      categories={categories}
      onStatusChange={(sid) => handleStatusChange(task.id, sid)}
      onComplete={() => handleComplete(task)}
      onMarkIncomplete={() => { setIncompleteReason(''); setIncompleteTask(task) }}
      currentUserId={user?.id}
      deadlineDisplay={deadlineDisplay}
    />
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Tasks"
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
        actions={
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
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-control text-body font-medium outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring transition-[background-color,color] ${
                    viewMode === mode
                      ? 'bg-primary text-primary-foreground'
                      : 'text-text-secondary hover:text-text-primary hover:bg-surface-control'
                  }`}
                >
                  {icon}
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>

            <Button onClick={() => setShowCreateModal(true)}>
              <Plus size={15} />
              <span className="hidden sm:inline">Create Task</span>
            </Button>
          </div>
        }
      />

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
            <p className="text-body text-text-secondary">
              Showing {sortedTasks.length} of {tasks.length} task{tasks.length !== 1 ? 's' : ''}
            </p>
          )}
          {sortedTasks.length === 0 ? (
            <div className="bg-surface border border-border-light rounded-card shadow-card flex flex-col items-center justify-center py-12">
              <div className="w-14 h-14 rounded-full bg-surface-control flex items-center justify-center mb-4">
                <CheckSquare size={24} className="text-text-muted" />
              </div>
              <p className="font-medium text-text-primary">
                {search.trim() ? `No tasks match ‘${search.trim()}’` : isFiltered ? 'No tasks match your filters' : 'No tasks assigned to you'}
              </p>
              <p className="text-body text-text-secondary mt-1">
                {search.trim() ? 'Try a different search term.' : isFiltered ? 'Try adjusting your filters.' : 'Tasks assigned to you will appear here.'}
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
          perspective="assignee"
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

      {/* Mark-incomplete reason popup — required remark captured right here, no drill-in.
          For "everyone must finish" tasks this flags only your own part. */}
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
            <p className="text-meta text-warning">
              {incompleteTask?.completion_mode === 'all_must_complete'
                ? 'Your part will be flagged as not-done. The task creator decides how the whole task is closed.'
                : 'The task will be closed as not-done for everyone.'}{' '}
              A reason is required.
            </p>
          </div>

          {incompleteTask && (
            <p className="text-body font-medium text-text-primary truncate">{incompleteTask.title}</p>
          )}

          <div>
            <Label className="mb-1.5">Reason</Label>
            <Textarea
              value={incompleteReason}
              onChange={(e) => setIncompleteReason(e.target.value)}
              rows={3}
              autoFocus
              placeholder="Why can’t this be completed?"
            />
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
            <Button
              variant="secondary"
              className="w-full sm:w-auto"
              onClick={() => { setIncompleteTask(null); setIncompleteReason('') }}
              disabled={incompleteSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              className="w-full sm:w-auto"
              onClick={submitIncomplete}
              disabled={incompleteSubmitting || !incompleteReason.trim()}
              loading={incompleteSubmitting}
              loadingLabel="Saving"
            >
              Mark Incomplete
            </Button>
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
