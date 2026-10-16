'use client'

import React, { useEffect, useRef, useState } from 'react'
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronDown, Check } from 'lucide-react'
import Tooltip from '@/components/ui/Tooltip'

export type SortField = 'deadline' | 'priority' | 'title' | 'status' | 'created'
export type SortDir = 'asc' | 'desc'

export interface TaskSort {
  field: SortField
  dir: SortDir
}

export const DEFAULT_TASK_SORT: TaskSort = { field: 'deadline', dir: 'asc' }

const FIELDS: { value: SortField; label: string }[] = [
  { value: 'deadline', label: 'Deadline' },
  { value: 'priority', label: 'Priority' },
  { value: 'title', label: 'Title' },
  { value: 'status', label: 'Status' },
  { value: 'created', label: 'Recently created' },
]

const FIELD_LABEL: Record<SortField, string> = {
  deadline: 'Deadline',
  priority: 'Priority',
  title: 'Title',
  status: 'Status',
  created: 'Created',
}

/**
 * Sort control for the task list: pick a field from the menu, or tap the arrow to
 * flip ascending/descending. The menu is absolutely anchored to the trigger (not a
 * portal), so it moves with the toolbar and never drifts — see memory `no-overflow-parent`.
 */
export default function TaskSortControl({ sort, onChange }: { sort: TaskSort; onChange: (s: TaskSort) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggleDir = () => onChange({ ...sort, dir: sort.dir === 'asc' ? 'desc' : 'asc' })

  return (
    <div ref={ref} className="relative shrink-0">
      <div className="flex items-center h-[38px] rounded-[8px] border border-border bg-surface-sunken hover:border-border-strong transition-colors">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="flex items-center gap-1.5 pl-3 pr-2 py-2 text-sm text-text-primary"
        >
          <ArrowUpDown size={15} className="text-text-secondary" />
          <span className="font-medium">{FIELD_LABEL[sort.field]}</span>
          <ChevronDown size={14} className={`text-text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        <Tooltip label={sort.dir === 'asc' ? 'Ascending' : 'Descending'}>
          <button
            type="button"
            onClick={toggleDir}
            aria-label={sort.dir === 'asc' ? 'Sort ascending — tap to reverse' : 'Sort descending — tap to reverse'}
            className="flex items-center h-full px-2 border-l border-border text-text-secondary hover:text-text-primary hover:bg-white rounded-r-[8px] transition-colors"
          >
            {sort.dir === 'asc' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
          </button>
        </Tooltip>
      </div>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-[calc(100%+6px)] z-50 w-52 rounded-[10px] border border-border-light bg-white shadow-[0_8px_24px_rgba(0,0,0,0.12)] py-1"
        >
          {FIELDS.map((f) => {
            const active = f.value === sort.field
            return (
              <button
                key={f.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange({ ...sort, field: f.value })
                  setOpen(false)
                }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                  active ? 'bg-primary-subtle text-primary-text font-medium' : 'text-text-primary hover:bg-surface-sunken'
                }`}
              >
                <span className="flex-1">{f.label}</span>
                {active && <Check size={14} className="text-primary-text shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
