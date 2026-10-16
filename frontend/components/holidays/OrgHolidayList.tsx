'use client'

import { useState } from 'react'
import { Pencil, Trash2, RefreshCw, Check, X, Unlink, GitBranch } from 'lucide-react'
import type { CalendarHoliday, HolidayType } from '@/lib/types/holidays'
import { parseLocalDate, dateOnly } from '@/lib/date'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import DatePicker from '@/components/ui/DatePicker'
import Tooltip from '@/components/ui/Tooltip'

const TYPE_COLORS: Record<HolidayType, string> = {
  national: 'bg-[#E0F2FE] text-[#0369A1] border-[#BAE6FD]',
  company: 'bg-[#F3E8FF] text-[#7C3AED] border-[#E9D5FF]',
  regional: 'bg-[#FEF9C3] text-[#CA8A04] border-[#FDE68A]',
  team: 'bg-[#DCFCE7] text-[#16A34A] border-[#BBF7D0]',
  personal: 'bg-[#FFE4E6] text-[#BE123C] border-[#FECDD3]',
  leave: 'bg-[#FEE2E2] text-[#DC2626] border-[#FECACA]',
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
    return <p className="text-sm text-[#94A3B8] py-6 text-center">{emptyText}</p>
  }

  return (
    <>
    <div className="divide-y divide-[#E2E8F0]">
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
                className="flex-1 h-8 px-2 rounded-[6px] border border-[#CBD5E1] text-sm text-[#0F172A] bg-white focus:border-[#2563EB] outline-hidden"
              />
              <button
                type="button"
                onClick={saveEdit}
                className="p-1.5 rounded-[6px] bg-[#DCFCE7] text-[#16A34A] hover:bg-[#BBF7D0] transition-colors"
              >
                <Check size={14} />
              </button>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="p-1.5 rounded-[6px] bg-[#F1F5F9] text-[#475569] hover:bg-[#E2E8F0] transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          )
        }

        return (
          <div
            key={h.id}
            className="group flex items-center gap-3 py-2.5 px-1 rounded-[8px] hover:bg-[#F8FAFC] transition-colors"
          >
            {selectable && h.inherited && (
              <Tooltip label="Select for bulk removal">
                <input
                  type="checkbox"
                  className="shrink-0 w-4 h-4 accent-[#2563EB] cursor-pointer"
                  checked={selectedIds?.has(h.id) ?? false}
                  onChange={() => onToggleSelect?.(h)}
                  aria-label="Select for bulk removal"
                />
              </Tooltip>
            )}

            {/* Date chip — weekday over day/month (start date) */}
            <div className="shrink-0 w-14 flex flex-col items-center justify-center rounded-[8px] border border-[#E2E8F0] bg-[#F8FAFC] py-1">
              <span className="text-[10px] font-semibold tracking-wide text-[#94A3B8] leading-tight">{weekday}</span>
              <span className="text-[13px] font-semibold text-[#0F172A] leading-tight">{dayMonth}</span>
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[#0F172A] truncate">{h.name}</p>
              {isRange && (
                <p className="text-xs text-[#94A3B8] truncate">{dayMonth} – {endDayMonth}</p>
              )}
              {h.inherited && (
                <span
                  className={`mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5 border ${
                    h.origin === 'org'
                      ? 'text-[#7C3AED] bg-[#F3E8FF] border-[#E9D5FF]'
                      : 'text-[#0369A1] bg-[#E0F2FE] border-[#BAE6FD]'
                  }`}
                >
                  <GitBranch size={11} />
                  Inherited from {h.origin === 'org' ? 'Organization' : (h.source_department_name ?? h.source_label ?? 'parent department')}
                </span>
              )}
              {!h.inherited && (h.cascade_target_count ?? 0) > 0 && (
                <Tooltip label="Cascaded to sub-departments">
                  <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-[#475569]">
                    <GitBranch size={11} className="text-[#94A3B8]" />
                    Shared with {h.cascade_target_count} sub-department{h.cascade_target_count === 1 ? '' : 's'}
                  </span>
                </Tooltip>
              )}
            </div>

            <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full border ${TYPE_COLORS[h.type]}`}>
              {typeLabel(h.type)}
            </span>
            {h.status === 'pending_review' && (
              <span className="shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full border bg-[#FEF9C3] text-[#CA8A04] border-[#FDE68A]">
                pending
              </span>
            )}
            {h.is_recurring_yearly && (
              <Tooltip label="Repeats yearly">
                <span aria-label="Repeats yearly" className="shrink-0">
                  <RefreshCw size={13} className="text-[#94A3B8]" />
                </span>
              </Tooltip>
            )}

            {h.inherited ? (
              onOptOut && (
                <Tooltip label="Opt out (remove for this department and its sub-departments)">
                  <button
                    type="button"
                    onClick={() => onOptOut(h)}
                    className="p-1.5 rounded-[6px] hover:bg-[#FEF3C7] text-[#475569] hover:text-[#D97706] transition-colors shrink-0"
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
                    className="p-1.5 rounded-[6px] hover:bg-[#EFF6FF] text-[#475569] hover:text-[#2563EB] transition-colors shrink-0"
                    aria-label="Edit"
                  >
                    <Pencil size={13} />
                  </button>
                </Tooltip>
                <Tooltip label="Delete">
                  <button
                    type="button"
                    onClick={() => setToDelete(h)}
                    className="p-1.5 rounded-[6px] hover:bg-[#FEE2E2] text-[#475569] hover:text-[#DC2626] transition-colors shrink-0"
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
      <p className="text-sm text-[#1E293B]">
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
