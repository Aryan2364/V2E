'use client'

import React, { useMemo } from 'react'
import { getNow } from '@/lib/clock'
import type { Task, TaskPriority, TaskStatus } from '@/lib/types/tasks'
import type { TaskSort } from './TaskSortControl'

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Lifecycle order, so a status sort reads Not started → In progress → Completed …
const PHASE_ORDER: Record<TaskStatus['type'], number> = {
  not_started: 0,
  in_progress: 1,
  completed: 2,
  partially_completed: 3,
  incomplete: 4,
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

// Free-text match across the fields a person would search by: title, description,
// category, tag names (kit §27.1), and the people on the task — including each person's
// job role and department.
export function matchesSearch(t: Task, q: string): boolean {
  if (!q) return true
  const hay = [
    t.title,
    t.description ?? '',
    t.category?.name ?? '',
    ...(t.tags ?? []).map((tag) => tag.name),
    t.created_by?.name ?? '',
    ...(t.assignees ?? []).flatMap((a) => [
      a.user?.name ?? a.user_name ?? '',
      a.user?.role_title ?? '',
      a.user?.department ?? '',
    ]),
  ]
    .join(' ')
    .toLowerCase()
  return hay.includes(q)
}

// A stable day header for a deadline: Today / Tomorrow / Yesterday, else "Monday, 3 August".
function groupLabel(d: Date, now: Date): string {
  const diff = Math.round((startOfDay(d) - startOfDay(now)) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long' })
  const month = d.toLocaleDateString('en-US', { month: 'long' })
  return `${weekday}, ${d.getDate()} ${month}`
}

export interface TaskGroup {
  key: string
  label: string
  tasks: Task[]
}

// ─── The pipeline hook — search → (my-track map) → sort → group ──────────────────

/**
 * Turns an already-filtered task set into the sorted / day-grouped shape the list
 * renders. Shared by My Tasks and Assigned so the two stay identical.
 *
 * `mapMyTrack` (My Tasks only): in "everyone must finish" mode the row must show the
 * viewer's OWN status track, not the shared status — otherwise a status change looks
 * like it snapped back. Off for assigner views, where the overall status is correct.
 */
export function useTaskListView(
  tasks: Task[],
  opts: {
    search: string
    sort: TaskSort
    priorities: TaskPriority[]
    statuses: TaskStatus[]
    currentUserId?: string
    mapMyTrack?: boolean
  },
): { sortedTasks: Task[]; groups: TaskGroup[] | null } {
  const { search, sort, priorities, statuses, currentUserId, mapMyTrack } = opts

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tasks.filter((t) => matchesSearch(t, q))
  }, [tasks, search])

  const displayTasks = useMemo(() => {
    if (!mapMyTrack) return searched
    return searched.map((task) => {
      const mine = task.assignees?.find((a) => a.user_id === currentUserId && !a.is_cc)
      if (task.completion_mode === 'all_must_complete' && mine) {
        return { ...task, status_id: mine.status_id ?? task.status_id, status: mine.status ?? task.status }
      }
      return task
    })
  }, [searched, mapMyTrack, currentUserId])

  const sortedTasks = useMemo(() => {
    const priIndex = (t: Task) => priorities.find((p) => p.id === t.priority_id)?.order_index ?? Number.POSITIVE_INFINITY
    const statusRank = (t: Task) => {
      const st = statuses.find((s) => s.id === t.status_id) ?? t.status
      return st ? PHASE_ORDER[st.type] * 1000 + st.order_index : Number.POSITIVE_INFINITY
    }
    const dir = sort.dir === 'asc' ? 1 : -1
    const arr = [...displayTasks]
    arr.sort((a, b) => {
      switch (sort.field) {
        case 'title':
          return a.title.localeCompare(b.title) * dir
        case 'priority':
          return (priIndex(a) - priIndex(b)) * dir
        case 'status':
          return (statusRank(a) - statusRank(b)) * dir
        case 'created':
          return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir
        case 'deadline':
        default: {
          // Tasks with no deadline always sink to the bottom, regardless of direction.
          const av = a.deadline ? new Date(a.deadline).getTime() : null
          const bv = b.deadline ? new Date(b.deadline).getTime() : null
          if (av === null && bv === null) return 0
          if (av === null) return 1
          if (bv === null) return -1
          return (av - bv) * dir
        }
      }
    })
    return arr
  }, [displayTasks, sort, priorities, statuses])

  const groups = useMemo(() => {
    if (sort.field !== 'deadline') return null
    const now = getNow()
    const out: TaskGroup[] = []
    const index = new Map<string, number>()
    for (const t of sortedTasks) {
      const key = t.deadline ? String(startOfDay(new Date(t.deadline))) : 'none'
      let i = index.get(key)
      if (i === undefined) {
        i = out.length
        index.set(key, i)
        out.push({ key, label: t.deadline ? groupLabel(new Date(t.deadline), now) : 'No deadline', tasks: [] })
      }
      out[i].tasks.push(t)
    }
    return out
  }, [sortedTasks, sort.field])

  return { sortedTasks, groups }
}

// ─── Nothing-found action (kit §13) ─────────────────────────────────────────────

/**
 * The one action on a "nothing found" empty state: clears whatever narrowed the list
 * to nothing — the search, the filters, or both. Renders nothing when neither is set
 * (that is the "nothing yet" state, which offers its own way forward).
 */
export function ClearNarrowingButton({
  hasSearch,
  hasFilters,
  onClear,
}: {
  hasSearch: boolean
  hasFilters: boolean
  onClear: () => void
}) {
  if (!hasSearch && !hasFilters) return null
  const label = hasSearch && hasFilters ? 'Clear search and filters' : hasSearch ? 'Clear search' : 'Clear filters'
  return (
    <button
      type="button"
      onClick={onClear}
      className="mt-4 h-11 sm:h-9 px-4 rounded-btn border border-primary bg-white text-sm font-medium text-primary hover:bg-primary-light focus:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-colors"
    >
      {label}
    </button>
  )
}

// ─── Presentational list — day sections, or one flat list ───────────────────────

/**
 * Renders the compact rows: day-grouped cards when sorted by deadline, else a single
 * flat card. `renderRow` builds each row (the page owns the per-row handlers).
 */
export function GroupedTaskList({
  groups,
  sortedTasks,
  renderRow,
}: {
  groups: TaskGroup[] | null
  sortedTasks: Task[]
  renderRow: (task: Task, deadlineDisplay: 'time' | 'date') => React.ReactNode
}) {
  if (groups) {
    return (
      <div className="space-y-5">
        {groups.map((g) => (
          <div key={g.key}>
            <p className="mb-1.5 px-1 text-[12px] font-medium text-[#64748B]">
              {g.label}
              <span className="text-[#94A3B8]"> · {g.tasks.length}</span>
            </p>
            <div className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] divide-y divide-[#E2E8F0]">
              {g.tasks.map((task) => renderRow(task, 'time'))}
            </div>
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] divide-y divide-[#E2E8F0]">
      {sortedTasks.map((task) => renderRow(task, 'date'))}
    </div>
  )
}
