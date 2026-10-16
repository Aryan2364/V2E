'use client'

import { useState } from 'react'
import { Pencil, Trash2, RefreshCw, Check, X, Unlink, GitBranch } from 'lucide-react'
import type { CalendarHoliday, HolidayType } from '@/lib/types/holidays'
import { parseLocalDate, dateOnly } from '@/lib/date'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/button'
import DatePicker from '@/components/ui/DatePicker'
import Tooltip from '@/components/ui/tooltip'

const TYPE_COLORS: Record<HolidayType, string> = {
  national: 'bg-surface-control text-text-secondary border-border-light',
  company: 'bg-surface-control text-text-secondary border-border-light',
  regional: 'bg-warning-bg text-warning border-warning-border',
  team: 'bg-success-bg text-success border-success-border',
  personal: 'bg-danger-bg text-danger border-danger-border',
  leave: 'bg-danger-bg text-danger border-danger-border',
}

function typeLabel(t: HolidayType): string {
  return t.charAt(0).toUpperCase() + t.slice(1)
}

interface EditState {
  id: string
  name: string
  date: string
}

interface Props {
  holidays: CalendarHoliday[]
  onDelete: (id: string) => void
  onUpdate: (id: string, patch: { name?: string; date?: string }) => void
  emptyText?: string
  /**
   * When provided, inherited (cascaded) holidays show an "Inherited from …" badge
   * and a remove action that calls this instead of edit/delete — a local opt-out.
   */
  onOptOut?: (h: CalendarHoliday) => void
  /** Enable per-row checkboxes on inherited (removable) rows for bulk removal. */
  selectable?: boolean
  selectedIds?: Set<string>
  onToggleSelect?: (h: CalendarHoliday) => void
}

/**
 * Org-calendar holiday list. Each row leads with a small date chip — the weekday
 * stacked over the day/month (e.g. "MON / 26 Jan") — then the name, a type tag, and
 * bare pencil/trash actions.
 */
export default function OrgHolidayList({ holidays, onDelete, onUpdate, emptyText = 'No holidays added.', onOptOut, selectable = false, selectedIds, onToggleSelect }: Props) {
  const [editing, setEditing] = useState<EditState | null>(null)
  const [toDelete, setToDelete] = useState<CalendarHoliday | null>(null)
  const [deleting, setDeleting] = useState(false)

  function startEdit(h: CalendarHoliday) {
    setEditing({ id: h.id, name: h.name, date: dateOnly(h.date) })
  }

  async function saveEdit() {
    if (!editing) return
    await onUpdate(editing.id, { name: editing.name, date: editing.date })
    setEditing(null)
  }

  async function confirmDelete() {
    if (!toDelete) return
    setDeleting(true)
    try {
      await onDelete(toDelete.id)
      setToDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  if (holidays.length === 0) {
    return <p className="text-sm text-text-muted py-6 text-center">{emptyText}</p>
  }

  return (
    <>
    <div className="divide-y divide-surface-control-pressed">
      {holidays.map((h) => {
        const isEditing = editing?.id === h.id
        const d = parseLocalDate(h.date)
        const weekday = d.toLocaleDateString('en-IN', { weekday: 'short' }).toUpperCase()
        const dayMonth = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
        const isRange = !!h.end_date && dateOnly(h.end_date) !== dateOnly(h.date)
        const endDayMonth = h.end_date ? parseLocalDate(h.end_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''

        if (isEditing) {
          return (
            <div key={h.id} className="flex items-center gap-3 py-3 px-1">
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
            </div>
          )
        }

        return (
          <div
            key={h.id}
            className="group flex items-center gap-3 py-2.5 px-1 rounded-[8px] hover:bg-surface-sunken transition-colors"
          >
            {selectable && h.inherited && (
              <Tooltip label="Select for bulk removal">
                <input
                  type="checkbox"
                  className="shrink-0 w-4 h-4 accent-primary cursor-pointer"
                  checked={selectedIds?.has(h.id) ?? false}
                  onChange={() => onToggleSelect?.(h)}
                  aria-label="Select for bulk removal"
                />
              </Tooltip>
            )}

            {/* Date chip — weekday over day/month (start date) */}
            <div className="shrink-0 w-14 flex flex-col items-center justify-center rounded-[8px] border border-border-light bg-surface-sunken py-1">
              <span className="text-[10px] font-semibold tracking-wide text-text-muted leading-tight">{weekday}</span>
              <span className="text-[13px] font-semibold text-text-primary leading-tight">{dayMonth}</span>
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">{h.name}</p>
              {isRange && (
                <p className="text-xs text-text-muted truncate">{dayMonth} – {endDayMonth}</p>
              )}
              {h.inherited && (
                <span
                  className={`mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5 border ${
                    h.origin === 'org'
                      ? 'text-text-secondary bg-surface-control border-border-light'
                      : 'text-text-secondary bg-surface-control border-border-light'
                  }`}
                >
                  <GitBranch size={11} />
                  Inherited from {h.origin === 'org' ? 'Organization' : (h.source_department_name ?? h.source_label ?? 'parent department')}
                </span>
              )}
              {!h.inherited && (h.cascade_target_count ?? 0) > 0 && (
                <Tooltip label="Cascaded to sub-departments">
                  <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-text-secondary">
                    <GitBranch size={11} className="text-text-muted" />
                    Shared with {h.cascade_target_count} sub-department{h.cascade_target_count === 1 ? '' : 's'}
                  </span>
                </Tooltip>
              )}
            </div>

            <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full border ${TYPE_COLORS[h.type]}`}>
              {typeLabel(h.type)}
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

            {h.inherited ? (
              onOptOut && (
                <Tooltip label="Opt out (remove for this department and its sub-departments)">
                  <button
                    type="button"
                    onClick={() => onOptOut(h)}
                    className="p-1.5 rounded-[6px] hover:bg-warning-bg text-text-secondary hover:text-warning transition-colors shrink-0"
                    aria-label="Opt out (remove for this department and its sub-departments)"
                  >
                    <Unlink size={13} />
                  </button>
                </Tooltip>
              )
            ) : (
              <>
                <Tooltip label="Edit">
                  <button
                    type="button"
                    onClick={() => startEdit(h)}
                    className="p-1.5 rounded-[6px] hover:bg-primary-subtle text-text-secondary hover:text-primary-text transition-colors shrink-0"
                    aria-label="Edit"
                  >
                    <Pencil size={13} />
                  </button>
                </Tooltip>
                <Tooltip label="Delete">
                  <button
                    type="button"
                    onClick={() => setToDelete(h)}
                    className="p-1.5 rounded-[6px] hover:bg-danger-bg text-text-secondary hover:text-danger transition-colors shrink-0"
                    aria-label="Delete"
                  >
                    <Trash2 size={13} />
                  </button>
                </Tooltip>
              </>
            )}
          </div>
        )
      })}
    </div>

    {/* Delete confirmation */}
    <Modal
      isOpen={!!toDelete}
      onClose={() => !deleting && setToDelete(null)}
      title="Delete holiday"
      size="sm"
    >
      <p className="text-sm text-text-primary">
        Delete <span className="font-semibold">{toDelete?.name}</span>? This can&apos;t be undone.
      </p>
      <div className="flex items-center justify-end gap-2 mt-5">
        <Button variant="secondary" onClick={() => setToDelete(null)} disabled={deleting}>Cancel</Button>
        <Button variant="danger" onClick={confirmDelete} isLoading={deleting} disabled={deleting}>Delete</Button>
      </div>
    </Modal>
    </>
  )
}
