'use client'

import { useState } from 'react'
import { AlertTriangle, Check, X } from 'lucide-react'
import type { OrgHoliday } from '@/lib/types/holidays'

interface Props {
  pending: OrgHoliday[]
  year: number
  onApply: (selectedIds: string[]) => Promise<void>
  onDismiss: () => Promise<void>
}

export default function PendingHolidayReviewer({ pending, year, onApply, onDismiss }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set(pending.map((h) => h.id)))
  const [saving, setSaving] = useState(false)

  function toggleAll() {
    if (selected.size === pending.length) setSelected(new Set())
    else setSelected(new Set(pending.map((h) => h.id)))
  }

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function apply() {
    setSaving(true)
    try {
      await onApply(Array.from(selected))
    } finally {
      setSaving(false)
    }
  }

  async function dismiss() {
    setSaving(true)
    try {
      await onDismiss()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-[12px] border border-warning-border bg-warning-bg p-4 space-y-3">
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="text-warning shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-warning">
            {pending.length} national holiday{pending.length !== 1 ? 's' : ''} pending review for {year}
          </p>
          <p className="text-xs text-warning mt-0.5">
            Select which to activate. Unselected holidays will be dismissed.
          </p>
        </div>
      </div>

      <div className="max-h-56 overflow-y-auto divide-y divide-warning-bg rounded-[8px] border border-warning-border bg-white">
        <div className="flex items-center gap-3 px-3 py-2 border-b border-warning-border">
          <input
            type="checkbox"
            checked={selected.size === pending.length}
            onChange={toggleAll}
            className="w-4 h-4 accent-warning"
          />
          <span className="text-xs font-semibold text-text-secondary">Select all ({pending.length})</span>
        </div>
        {pending.map((h) => (
          <label key={h.id} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-warning-bg transition-colors">
            <input
              type="checkbox"
              checked={selected.has(h.id)}
              onChange={() => toggle(h.id)}
              className="w-4 h-4 accent-warning"
            />
            <span className="w-28 shrink-0 text-xs text-text-secondary">
              {new Date(h.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </span>
            <span className="flex-1 text-sm text-text-primary font-medium">{h.name}</span>
          </label>
        ))}
      </div>

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          disabled={saving}
          onClick={dismiss}
          className="flex items-center gap-1.5 h-9 px-4 rounded-[8px] border border-warning-border text-sm font-semibold text-warning bg-white hover:bg-warning-bg disabled:opacity-50 transition-colors"
        >
          <X size={14} />
          Dismiss All
        </button>
        <button
          type="button"
          disabled={saving || selected.size === 0}
          onClick={apply}
          className="flex items-center gap-1.5 h-9 px-4 rounded-[8px] text-sm font-semibold text-white bg-warning hover:bg-warning disabled:bg-surface-control-pressed disabled:text-text-muted transition-colors"
        >
          <Check size={14} />
          Activate {selected.size > 0 ? `${selected.size} Selected` : ''}
        </button>
      </div>
    </div>
  )
}
