'use client'

import React, { useEffect, useState } from 'react'
import { Plus, X, TrendingUp, ShieldAlert } from 'lucide-react'
import EmployeePicker, { type EmployeePickerOption } from '@/components/ui/EmployeePicker'
import { tasksApi } from '@/lib/api/tasks'

const MAX_LEVELS = 5

interface Props {
  orgId: string
  /** Ordered escalation contacts — position 0 is Level 1 (alerted first). */
  value: string[]
  onChange: (userIds: string[]) => void
  /**
   * The assigner (task creator). When provided with `defaultToAssigner`, they are
   * seeded as Level 1 automatically — shown as a fixed "You (assigner)" chip, not a
   * dropdown. They are also hidden from the pickers (you don't pick yourself).
   */
  assignerId?: string
  /** Seed Level 1 with the assigner by default (create flows only). */
  defaultToAssigner?: boolean
  /**
   * People who must not be offered as escalation contacts — the task's assignees.
   * Escalating to the person who is already late is meaningless (they get the alert
   * anyway), so they're excluded from every picker.
   */
  excludeUserIds?: string[]
}

/**
 * Collapsible "Escalation" card (Create Task + Edit Recurring). When the task goes
 * past its deadline the escalation engine alerts these people one level at a time
 * (Level 1 first, then Level 2 an hour later, and so on). Level 1 defaults to the
 * assigner; each level offers only people not already used and not doing the work.
 */
export default function EscalationLevelsField({ orgId, value, onChange, assignerId, defaultToAssigner, excludeUserIds }: Props) {
  const [open, setOpen] = useState(false)
  const [employees, setEmployees] = useState<EmployeePickerOption[]>([])
  const [loaded, setLoaded] = useState(false)
  const [rowError, setRowError] = useState<string | null>(null)
  const exclude = excludeUserIds ?? []
  // '' rows are levels added but not yet filled — kept local to this field. The parent
  // value only seeds the initial rows: both host modals unmount when they close, so a
  // fresh mount always starts from the parent's current list. Level 1 defaults to the
  // assigner (unless they're doing the work) so the person who handed the task out is
  // the first to hear it went late.
  const [rows, setRows] = useState<string[]>(() => {
    if (value.length > 0) return value
    if (defaultToAssigner && assignerId && !exclude.includes(assignerId)) return [assignerId]
    return []
  })

  // Push the seeded assigner up to the parent once, on first mount (a mount-only
  // effect — NOT a resync; it never reacts to later `value` changes).
  useEffect(() => {
    if (defaultToAssigner && value.length === 0 && rows.length > 0) onChange(rows.filter(Boolean))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!open || loaded || !orgId) return
    tasksApi
      .getEligibleAssignees(orgId)
      .then((res) => {
        const opts: EmployeePickerOption[] = []
        res.departments.forEach((dept) =>
          dept.users.forEach((u) =>
            opts.push({ user_id: u.user_id, name: u.name, role_title: u.role_title, department_name: u.department_name }),
          ),
        )
        setEmployees(opts)
      })
      .catch(() => setEmployees([]))
      .finally(() => setLoaded(true))
  }, [open, loaded, orgId])

  function emit(next: string[]) {
    setRows(next)
    onChange(next.filter(Boolean))
  }

  function setLevel(idx: number, uid: string) {
    setRowError(null)
    const existingAt = rows.findIndex((r, i) => r === uid && i !== idx)
    if (uid && existingAt >= 0) {
      setRowError(`That person is already Level ${existingAt + 1}.`)
      return
    }
    const next = [...rows]
    next[idx] = uid
    emit(next)
  }

  function removeLevel(idx: number) {
    setRowError(null)
    emit(rows.filter((_, i) => i !== idx))
  }

  function addLevel() {
    setRowError(null)
    if (rows.length >= MAX_LEVELS) return
    setRows([...rows, ''])
  }

  const filledCount = rows.filter(Boolean).length

  // Options for a given level's picker: drop the assigner, the assignees, and anyone
  // already chosen at another level, so each level offers only fresh, escalatable people.
  function optionsFor(idx: number): EmployeePickerOption[] {
    const chosenElsewhere = new Set(rows.filter((r, i) => r && i !== idx))
    return employees.filter(
      (e) => e.user_id !== assignerId && !exclude.includes(e.user_id) && !chosenElsewhere.has(e.user_id),
    )
  }

  return (
    <div>
      <div className="rounded-xl border border-border-light bg-surface overflow-visible">
        {/* Card header — click anywhere to toggle; + button on the right */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="w-full flex items-center gap-2 px-3 py-3 text-left hover:bg-surface-sunken transition-colors"
        >
          <label className="text-sm font-medium text-text-secondary cursor-pointer shrink-0">Escalation</label>
          <span className="text-xs font-normal text-text-secondary shrink-0">Optional</span>
          {filledCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-white text-[11px] font-medium shrink-0">
              {filledCount}
            </span>
          )}
          {!open && filledCount > 0 && (
            <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
              {filledCount} level{filledCount !== 1 ? 's' : ''} set
            </span>
          )}
          <span
            className={[
              'ml-auto flex items-center justify-center w-6 h-6 rounded-[6px] text-primary-text transition-transform shrink-0',
              open ? 'rotate-45' : '',
            ].join(' ')}
            aria-hidden
          >
            <Plus size={18} />
          </span>
        </button>

        {open && (
          <div className="px-3 pb-3 pt-0 space-y-2">
            <p className="text-xs text-text-secondary flex items-start gap-1.5">
              <TrendingUp size={13} className="mt-0.5 shrink-0 text-text-muted" />
              If the task goes past its deadline, these people are alerted one level at a time — Level 1 first,
              then the next level an hour later if it stays open.
            </p>
            {rows.map((uid, idx) => {
              const isAssigner = !!assignerId && uid === assignerId
              return (
                <div key={idx} className="flex items-center gap-2">
                  <span className="shrink-0 w-14 text-xs font-medium text-text-secondary">Level {idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    {isAssigner ? (
                      <div className="flex items-center gap-2 h-[42px] px-3 rounded-lg border border-primary-border bg-primary-subtle">
                        <ShieldAlert size={14} className="text-primary-text shrink-0" />
                        <span className="text-sm font-medium text-text-primary">You (assigner)</span>
                        <span className="text-[11px] font-medium text-primary-text bg-surface border border-primary-border rounded-full px-1.5 py-0.5">Default</span>
                      </div>
                    ) : (
                      <EmployeePicker
                        value={uid}
                        onChange={(v) => setLevel(idx, v)}
                        employees={optionsFor(idx)}
                        title={`Escalate to (Level ${idx + 1})`}
                        placeholder={loaded ? 'Pick a person…' : 'Loading people…'}
                      />
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLevel(idx)}
                    className="shrink-0 w-7 h-7 flex items-center justify-center rounded-[6px] text-text-muted hover:text-danger hover:bg-danger-bg transition-colors"
                    aria-label={`Remove level ${idx + 1}`}
                  >
                    <X size={14} />
                  </button>
                </div>
              )
            })}
            {rowError && <p className="text-xs text-danger">{rowError}</p>}
            {rows.length < MAX_LEVELS && (
              <button
                type="button"
                onClick={addLevel}
                className="flex items-center justify-center gap-1.5 w-full px-3 py-2 text-sm font-medium text-primary-text border border-primary rounded-lg hover:bg-primary-subtle transition-colors"
              >
                <Plus size={14} /> Add escalation level
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
