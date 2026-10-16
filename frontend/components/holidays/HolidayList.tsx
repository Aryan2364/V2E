'use client'

import { useState } from 'react'
import { Pencil, Trash2, RefreshCw, Check, X } from 'lucide-react'
import type { OrgHoliday, DepartmentHoliday, IndividualHoliday, HolidayType } from '@/lib/types/holidays'
import { parseLocalDate, dateOnly } from '@/lib/date'
import DatePicker from '@/components/ui/DatePicker'
import Tooltip from '@/components/ui/tooltip'

type AnyHoliday = OrgHoliday | DepartmentHoliday | IndividualHoliday

const TYPE_COLORS: Record<HolidayType, string> = {
  national: 'bg-surface-control text-text-secondary border-border-light',
  company: 'bg-surface-control text-text-secondary border-border-light',
  regional: 'bg-warning-bg text-warning border-warning-border',
  team: 'bg-success-bg text-success border-success-border',
  personal: 'bg-danger-bg text-danger border-danger-border',
  leave: 'bg-danger-bg text-danger border-danger-border',
}

interface EditState {
  id: string
  name: string
  date: string
}

interface Props {
  holidays: AnyHoliday[]
  onDelete: (id: string) => void
  onUpdate: (id: string, patch: { name?: string; date?: string }) => void
  emptyText?: string
}

export default function HolidayList({ holidays, onDelete, onUpdate, emptyText = 'No holidays added.' }: Props) {
  const [editing, setEditing] = useState<EditState | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  function startEdit(h: AnyHoliday) {
    setEditing({ id: h.id, name: h.name, date: dateOnly(h.date) })
  }

  async function saveEdit() {
    if (!editing) return
    await onUpdate(editing.id, { name: editing.name, date: editing.date })
    setEditing(null)
  }

  async function confirmDelete(id: string) {
    setDeleting(id)
    await onDelete(id)
    setDeleting(null)
  }

  if (holidays.length === 0) {
    return <p className="text-sm text-text-muted py-3 text-center">{emptyText}</p>
  }

  return (
    <div className="divide-y divide-surface-control-pressed">
      {holidays.map((h) => {
        const isEditing = editing?.id === h.id
        const isDeleting = deleting === h.id
        const dateDisplay = parseLocalDate(h.date).toLocaleDateString('en-IN', {
          day: 'numeric', month: 'short', year: 'numeric',
        })

        return (
          <div key={h.id} className="flex items-center gap-3 py-3 px-1">
            {isEditing ? (
              <>
                <DatePicker
                  value={editing.date}
                  onChange={(iso) => setEditing((s) => s ? { ...s, date: iso } : s)}
                  placeholder="Select date"
                />
                <input
                  value={editing.name}
                  onChange={(e) => setEditing((s) => s ? { ...s, name: e.target.value } : s)}
                  className="flex-1 h-8 px-2 rounded-[6px] border border-border text-sm text-text-primary bg-white focus:border-primary outline-hidden"
                />
                <button
                  type="button"
                  onClick={saveEdit}
                  className="p-1.5 rounded-[6px] bg-success-bg text-success hover:bg-success-bg transition-colors"
                >
                  <Check size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="p-1.5 rounded-[6px] bg-surface-control text-text-secondary hover:bg-surface-control-pressed transition-colors"
                >
                  <X size={14} />
                </button>
              </>
            ) : (
              <>
                <span className="w-28 shrink-0 text-sm text-text-secondary">{dateDisplay}</span>
                <span className="flex-1 text-sm font-medium text-text-primary truncate">{h.name}</span>
                <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full border ${TYPE_COLORS[h.type]}`}>
                  {h.type}
                </span>
                {h.status === 'pending_review' && (
                  <span className="shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full border bg-warning-bg text-warning border-warning-border">
                    pending
                  </span>
                )}
                {h.is_recurring_yearly && (
                  <Tooltip label="Repeats yearly">
                    <span aria-label="Repeats yearly" className="shrink-0">
                      <RefreshCw size={13} className="text-text-muted" />
                    </span>
                  </Tooltip>
                )}
                <button
                  type="button"
                  onClick={() => startEdit(h)}
                  className="p-1.5 rounded-[6px] hover:bg-surface-control text-text-secondary transition-colors shrink-0"
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => confirmDelete(h.id)}
                  className="p-1.5 rounded-[6px] hover:bg-danger-bg text-danger transition-colors shrink-0"
                >
                  <Trash2 size={13} />
                </button>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
