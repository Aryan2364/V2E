'use client'

import React from 'react'
import { Search, X } from 'lucide-react'
import type { Task, TaskCategory, TaskPriority, TaskStatus } from '@/lib/types/tasks'
import type { TaskFilters } from './TaskFilterBar'
import TaskFilterPopover from './TaskFilterPopover'
import TaskFilterChips from './TaskFilterChips'
import TaskSortControl, { type TaskSort } from './TaskSortControl'

/**
 * The one-row task toolbar shared by My Tasks and Assigned: a grow-to-fit search box,
 * the collapsed Filters popover (with an active-count badge), and — in list view — the
 * sort control. Keeping this shared is what keeps the two screens consistent.
 */
export default function TaskListToolbar({
  search,
  onSearch,
  filters,
  onFilters,
  sort,
  onSort,
  showSort,
  tasks,
  statuses,
  priorities,
  categories,
  currentUserId,
}: {
  search: string
  onSearch: (v: string) => void
  filters: TaskFilters
  onFilters: (f: TaskFilters) => void
  sort: TaskSort
  onSort: (s: TaskSort) => void
  showSort: boolean
  tasks: Task[]
  statuses: TaskStatus[]
  priorities: TaskPriority[]
  categories: TaskCategory[]
  currentUserId?: string
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
      <div className="relative flex-1 min-w-[220px]">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8] pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search tasks by title, tag, category or person"
          className="w-full h-[38px] pl-9 pr-9 rounded-[8px] border border-[#CBD5E1] bg-[#F8FAFC] text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:bg-white transition-colors"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearch('')}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#475569] transition-colors"
          >
            <X size={15} />
          </button>
        )}
      </div>
      <TaskFilterPopover
        tasks={tasks}
        statuses={statuses}
        priorities={priorities}
        categories={categories}
        filters={filters}
        onChange={onFilters}
      />
        {showSort && <TaskSortControl sort={sort} onChange={onSort} />}
      </div>
      <TaskFilterChips
        filters={filters}
        onChange={onFilters}
        tasks={tasks}
        statuses={statuses}
        priorities={priorities}
        categories={categories}
        currentUserId={currentUserId}
      />
    </div>
  )
}
