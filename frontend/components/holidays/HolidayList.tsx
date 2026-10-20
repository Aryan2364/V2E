'use client'

import { Button } from '@/components/ui/button'
import { useState } from 'react'
import { Pencil, Trash2, RefreshCw, Check, X } from 'lucide-react'
import type { OrgHoliday, DepartmentHoliday, IndividualHoliday, HolidayType } from '@/lib/types/holidays'
import { parseLocalDate, dateOnly } from '@/lib/date'
import { formatDate } from '@/lib/format'
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
    return <p className="text-body text-text-muted py-3 text-center">{emptyText}</p>
  }

  return (
    <div className="divide-y divide-surface-control-pressed">
      {holidays.map((h) => {
        const isEditing = editing?.id === h.id
        const isDeleting = deleting === h.id
        const dateDisplay = formatDate(parseLocalDate(h.date))

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
                  className="flex-1 h-8 px-2 rounded-md border border-border text-body text-text-primary bg-surface focus:border-primary outline-hidden"
                />
                <Tooltip label="Save">
                  <Button type="button" onClick={saveEdit} variant="ghost" size="icon" aria-label="Save">
                    <Check size={14} />
                  </Button>
                </Tooltip>
                <Tooltip label="Cancel">
                  <Button
                    type="button"
                    onClick={() => setEditing(null)}
                    variant="ghost"
                    size="icon"
                    aria-label="Cancel"
                  >
                    <X size={14} />
                  </Button>
                </Tooltip>
              </>
            ) : (
              <>
                <span className="w-28 shrink-0 text-body text-text-secondary">{dateDisplay}</span>
                <span className="flex-1 text-body font-medium text-text-primary truncate">{h.name}</span>
                <span className={`shrink-0 text-meta font-medium px-2 py-0.5 rounded-full border ${TYPE_COLORS[h.type]}`}>
                  {h.type}
                </span>
                {h.status === 'pending_review' && (
                  <span className="shrink-0 text-meta font-medium px-2 py-0.5 rounded-full border bg-warning-bg text-warning border-warning-border">
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
                <Tooltip label="Edit">
                  <Button
                    type="button"
                    onClick={() => startEdit(h)}
                    variant="ghost"
                    size="icon"
                    aria-label="Edit"
                  >
                    <Pencil size={13} />
                  </Button>
                </Tooltip>
                <Tooltip label="Delete">
                  <Button
                    type="button"
                    disabled={isDeleting}
                    onClick={() => confirmDelete(h.id)}
                    variant="ghost"
                    size="icon"
                    aria-label="Delete"
                  >
                    <Trash2 size={13} />
                  </Button>
                </Tooltip>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
