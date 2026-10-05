'use client'

import type { Task, TaskStatus } from '@/lib/types/tasks'
import { TERMINAL_STATUS_PHASES } from '@/lib/types/tasks'

// Every section is a multi-select where an EMPTY array means "all" (no narrowing).
// Status keeps a preset mode so its default can be "Open" rather than "everything".
//  - statusMode 'open'  (default) → every non-terminal status
//  - statusMode 'all'            → every status, open AND closed
//  - statusMode 'custom'         → the explicit `statusIds` set
export type StatusMode = 'open' | 'all' | 'custom'
export type DeadlineKey = 'overdue' | 'upcoming'

export interface TaskFilters {
  statusMode: StatusMode
  /** Only meaningful when statusMode === 'custom'. */
  statusIds: string[]
  /** Selected deadline buckets — empty = all (both overdue and upcoming). */
  deadlines: DeadlineKey[]
  /** Selected priority ids — empty = all. */
  priorityIds: string[]
  /** Selected category ids — empty = all. */
  categoryIds: string[]
  /** Selected assignee ids — empty = all (Anyone). */
  userIds: string[]
  /** Selected tag ids — empty = all. A task matches when it carries ANY of them. */
  tagIds: string[]
}

// Default view: Open tasks, everything else unfiltered.
export const EMPTY_TASK_FILTERS: TaskFilters = {
  statusMode: 'open',
  statusIds: [],
  deadlines: [],
  priorityIds: [],
  categoryIds: [],
  userIds: [],
  tagIds: [],
}

/**
 * Fill in any section a stored filter object is missing. Filters persist in
 * sessionStorage, so an object saved before a section existed (e.g. `tagIds`) must still
 * load: unknown or malformed fields fall back to the defaults rather than crashing.
 */
export function normalizeTaskFilters(raw: Partial<TaskFilters> | null | undefined): TaskFilters {
  const r = (raw ?? {}) as Partial<TaskFilters>
  const arr = <T,>(v: unknown, fallback: T[]): T[] => (Array.isArray(v) ? (v as T[]) : fallback)
  const mode = r.statusMode === 'all' || r.statusMode === 'custom' || r.statusMode === 'open' ? r.statusMode : EMPTY_TASK_FILTERS.statusMode
  return {
    statusMode: mode,
    statusIds: arr(r.statusIds, []),
    deadlines: arr(r.deadlines, []),
    priorityIds: arr(r.priorityIds, []),
    categoryIds: arr(r.categoryIds, []),
    userIds: arr(r.userIds, []),
    tagIds: arr(r.tagIds, []),
  }
}

export function isTaskFiltered(f: TaskFilters): boolean {
  return (
    f.statusMode !== 'open' ||
    f.deadlines.length > 0 ||
    f.priorityIds.length > 0 ||
    f.categoryIds.length > 0 ||
    f.userIds.length > 0 ||
    f.tagIds.length > 0
  )
}

// How many filter dimensions are active — drives the count badge on the Filters button.
export function countActiveFilters(f: TaskFilters): number {
  return (
    (f.statusMode !== 'open' ? 1 : 0) +
    (f.deadlines.length > 0 ? 1 : 0) +
    (f.priorityIds.length > 0 ? 1 : 0) +
    (f.categoryIds.length > 0 ? 1 : 0) +
    (f.userIds.length > 0 ? 1 : 0) +
    (f.tagIds.length > 0 ? 1 : 0)
  )
}

function statusTypeOf(t: Task, statuses: TaskStatus[]): TaskStatus['type'] | undefined {
  return statuses.find((s) => s.id === t.status_id)?.type ?? t.status?.type
}

function matchesStatus(t: Task, f: TaskFilters, statuses: TaskStatus[]): boolean {
  if (f.statusMode === 'all') return true
  if (f.statusMode === 'open') {
    const type = statusTypeOf(t, statuses)
    return !!type && !TERMINAL_STATUS_PHASES.includes(type)
  }
  return f.statusIds.includes(t.status_id)
}

function matchesDeadline(t: Task, keys: DeadlineKey[]): boolean {
  if (keys.length === 0) return true
  return keys.some((k) => (k === 'overdue' ? !!t.is_overdue : !t.is_overdue))
}

export function applyTaskFilters(tasks: Task[], f: TaskFilters, statuses: TaskStatus[]): Task[] {
  return tasks.filter((t) =>
    matchesStatus(t, f, statuses) &&
    matchesDeadline(t, f.deadlines) &&
    (f.priorityIds.length === 0 || (!!t.priority_id && f.priorityIds.includes(t.priority_id))) &&
    (f.categoryIds.length === 0 || (!!t.category_id && f.categoryIds.includes(t.category_id))) &&
    (f.userIds.length === 0 || (t.assignees ?? []).some((a) => f.userIds.includes(a.user_id))) &&
    (f.tagIds.length === 0 || (t.tags ?? []).some((tag) => f.tagIds.includes(tag.id))),
  )
}
