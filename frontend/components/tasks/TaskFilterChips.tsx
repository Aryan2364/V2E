'use client'

import React, { useMemo } from 'react'
import { X } from 'lucide-react'
import type { Task, TaskCategory, TaskPriority, TaskStatus } from '@/lib/types/tasks'
import { type TaskFilters, EMPTY_TASK_FILTERS, isTaskFiltered } from './TaskFilterBar'

interface Chip {
  key: string
  label: string
  onRemove: () => void
}

/**
 * The removable active-filter chips shown under the toolbar. Reads the shared
 * TaskFilters and lets each dimension be cleared in one tap, plus "Clear all". Only
 * renders when at least one filter is active (mirrors the count badge on Filters).
 */
export default function TaskFilterChips({
  filters,
  onChange,
  tasks,
  statuses,
  priorities,
  categories,
  currentUserId,
}: {
  filters: TaskFilters
  onChange: (f: TaskFilters) => void
  tasks: Task[]
  statuses: TaskStatus[]
  priorities: TaskPriority[]
  categories: TaskCategory[]
  currentUserId?: string
}) {
  // Resolve an assignee id → display name from the people appearing on these tasks.
  const userName = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of tasks) {
      for (const a of t.assignees ?? []) {
        const name = a.user?.name ?? a.user_name
        if (name) m.set(a.user_id, name)
      }
    }
    return m
  }, [tasks])

  // Resolve a tag id → name from the tags on these tasks (the same source the popover offers).
  const tagName = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of tasks) for (const tag of t.tags ?? []) m.set(tag.id, tag.name)
    return m
  }, [tasks])

  const set = (patch: Partial<TaskFilters>) => onChange({ ...filters, ...patch })

  const chips: Chip[] = []

  // Status — hidden at the default "open".
  if (filters.statusMode === 'all') {
    chips.push({ key: 'status', label: 'Status: All statuses', onRemove: () => set({ statusMode: 'open', statusIds: [] }) })
  } else if (filters.statusMode === 'custom') {
    const labels = filters.statusIds
      .map((id) => statuses.find((s) => s.id === id)?.label)
      .filter(Boolean) as string[]
    const label =
      labels.length === 0 ? 'Status: None' : labels.length <= 2 ? `Status: ${labels.join(', ')}` : `Status: ${labels.length} selected`
    chips.push({ key: 'status', label, onRemove: () => set({ statusMode: 'open', statusIds: [] }) })
  }

  // Deadline (a proper subset — both = no filter).
  if (filters.deadlines.length > 0) {
    const label = filters.deadlines.map((d) => (d === 'overdue' ? 'Overdue' : 'Upcoming')).join(', ')
    chips.push({ key: 'deadline', label, onRemove: () => set({ deadlines: [] }) })
  }

  // Priority.
  if (filters.priorityIds.length > 0) {
    const names = filters.priorityIds.map((id) => priorities.find((x) => x.id === id)?.label ?? '—')
    const label = names.length <= 2 ? `Priority: ${names.join(', ')}` : `Priority: ${names.length} selected`
    chips.push({ key: 'priority', label, onRemove: () => set({ priorityIds: [] }) })
  }

  // Category.
  if (filters.categoryIds.length > 0) {
    const names = filters.categoryIds.map((id) => categories.find((x) => x.id === id)?.name ?? '—')
    const label = names.length <= 2 ? `Category: ${names.join(', ')}` : `Category: ${names.length} selected`
    chips.push({ key: 'category', label, onRemove: () => set({ categoryIds: [] }) })
  }

  // Tags — one chip for the selected tags, worded like Category (same order as the Filters panel).
  if (filters.tagIds.length > 0) {
    const names = filters.tagIds.map((id) => tagName.get(id) ?? 'Unknown tag')
    const label = names.length <= 2 ? `Tags: ${names.join(', ')}` : `Tags: ${names.length} selected`
    chips.push({ key: 'tags', label, onRemove: () => set({ tagIds: [] }) })
  }

  // Assignee — one chip for the selected people ("Me" for the current user).
  if (filters.userIds.length > 0) {
    const names = filters.userIds.map((id) => (id === currentUserId ? 'Me' : userName.get(id) ?? '—'))
    const label = names.length <= 2 ? `Assignee: ${names.join(', ')}` : `Assignee: ${names.length} selected`
    chips.push({ key: 'user', label, onRemove: () => set({ userIds: [] }) })
  }

  if (!isTaskFiltered(filters) || chips.length === 0) return null

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1.5 text-[12px] pl-2.5 pr-1.5 py-1 rounded-[999px] bg-[#EFF6FF] text-[#2563EB] border border-[#BFDBFE]"
        >
          {chip.label}
          <button
            type="button"
            onClick={chip.onRemove}
            aria-label={`Remove ${chip.label} filter`}
            className="inline-flex items-center justify-center rounded-full p-0.5 hover:bg-[#DBEAFE] transition-colors"
          >
            <X size={12} />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={() => onChange({ ...EMPTY_TASK_FILTERS })}
        className="text-[12px] font-medium text-[#475569] hover:text-[#0F172A] px-1.5 py-1 transition-colors"
      >
        Reset
      </button>
    </div>
  )
}
