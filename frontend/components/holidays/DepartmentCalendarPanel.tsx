'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Loader2, Plus, ChevronLeft, ChevronRight, ChevronDown, Trash2, Undo2, RotateCcw, X } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { holidaysApi } from '@/lib/api/holidays'
import { getDepartments } from '@/lib/api/departments'
import type { CalendarHoliday, RemovedOrgHoliday } from '@/lib/types/holidays'
import type { Department } from '@/lib/types'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/button'
import WorkingDaysStrip from './WorkingDaysStrip'
import OrgHolidayList from './OrgHolidayList'
import OrgHolidayCalendar from './OrgHolidayCalendar'
import HolidayFormModal, { type HolidayFormData } from './HolidayFormModal'
import { parseLocalDate } from '@/lib/date'

const YEARS_BASE = new Date().getFullYear()

interface Props {
  orgId: string
  deptId: string
  deptName: string
}

export default function DepartmentCalendarPanel({ orgId, deptId, deptName }: Props) {
  const { user } = useAuth()
  const isAdmin = !!user?.is_admin

  const [orgWorkingDays, setOrgWorkingDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6])
  const [override, setOverride] = useState(false)
  const [deptDays, setDeptDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6])
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')

  const [holidays, setHolidays] = useState<CalendarHoliday[]>([])
  const [removedOrg, setRemovedOrg] = useState<RemovedOrgHoliday[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [selectedYear, setSelectedYear] = useState(YEARS_BASE)
  const [loading, setLoading] = useState(true)
  const [holidaysLoading, setHolidaysLoading] = useState(false)
  const [showAdd, setShowAdd] = useState(false)

  // Bulk removal (opt-out) of inherited holidays — selection, confirm + scope, undo.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [scopeSubtree, setScopeSubtree] = useState(true)
  const [removing, setRemoving] = useState(false)
  const [undoToast, setUndoToast] = useState<{ items: { holiday_source: 'org' | 'department'; holiday_id: string }[]; count: number } | null>(null)
  const [showRemoved, setShowRemoved] = useState(false)

  const effectiveDays = override ? deptDays : orgWorkingDays
  const hasDescendants = useMemo(
    () => departments.some((d) => d.parent_department_id === deptId),
    [departments, deptId],
  )
  const selected = useMemo(() => holidays.filter((h) => selectedIds.has(h.id)), [holidays, selectedIds])
  const selectedHasOrg = selected.some((h) => h.origin === 'org')
  const selectableCount = useMemo(() => holidays.filter((h) => h.inherited).length, [holidays])

  const loadBase = useCallback(async () => {
    setLoading(true)
    try {
      const [org, dept, depts] = await Promise.all([
        holidaysApi.getOrgWorkingDays(orgId),
        holidaysApi.getDeptWorkingDays(orgId, deptId),
        getDepartments(orgId),
      ])
      setDepartments(depts)
      setOrgWorkingDays(org.working_days)
      if (dept) {
        setOverride(true)
        setDeptDays(dept.working_days)
      } else {
        setOverride(false)
        setDeptDays(org.working_days)
      }
    } finally {
      setLoading(false)
    }
  }, [orgId, deptId])

  const loadHolidays = useCallback(async () => {
    setHolidaysLoading(true)
    try {
      const [hols, discrepancies] = await Promise.all([
        holidaysApi.listDeptHolidays(orgId, deptId, { year: selectedYear }),
        holidaysApi.getHolidayDiscrepancies(orgId),
      ])
      setHolidays(hols)
      // Org holidays this department itself removed (anchored here, restorable here).
      setRemovedOrg(discrepancies.find((d) => d.department_id === deptId)?.removed ?? [])
      setSelectedIds(new Set())
    } finally {
      setHolidaysLoading(false)
    }
  }, [orgId, deptId, selectedYear])

  useEffect(() => { loadBase() }, [loadBase])
  useEffect(() => { loadHolidays() }, [loadHolidays])

  // Clear the "Saved" note after a moment.
  useEffect(() => {
    if (status !== 'saved') return
    const t = setTimeout(() => setStatus('idle'), 2000)
    return () => clearTimeout(t)
  }, [status])

  async function persistDays(days: number[]) {
    setStatus('saving')
    try {
      await holidaysApi.upsertDeptWorkingDays(orgId, deptId, days)
      setStatus('saved')
    } catch {
      setStatus('idle')
      await loadBase()
    }
  }

  function toggleDay(index: number) {
    if (!override || !isAdmin) return
    const next = deptDays.includes(index)
      ? deptDays.filter((d) => d !== index)
      : [...deptDays, index].sort((a, b) => a - b)
    setDeptDays(next) // optimistic
    persistDays(next)
  }

  async function toggleOverride(next: boolean) {
    if (!isAdmin) return
    if (next) {
      // Start overriding from the current org defaults.
      setOverride(true)
      setDeptDays(orgWorkingDays)
      await persistDays(orgWorkingDays)
    } else {
      setOverride(false)
      setDeptDays(orgWorkingDays)
      setStatus('saving')
      try {
        await holidaysApi.deleteDeptWorkingDays(orgId, deptId)
        setStatus('saved')
      } catch {
        setStatus('idle')
        await loadBase()
      }
    }
  }

  async function addHoliday(data: HolidayFormData) {
    await holidaysApi.createDeptHoliday(orgId, deptId, {
      ...data,
      end_date: data.end_date || null,
      status: 'active',
      description: data.description || null,
      target_department_ids: data.target_department_ids,
    })
    await loadHolidays()
  }

  async function deleteHoliday(id: string) {
    await holidaysApi.deleteDeptHoliday(orgId, deptId, id)
    setHolidays((h) => h.filter((x) => x.id !== id))
  }

  async function updateHoliday(id: string, patch: { name?: string; date?: string }) {
    await holidaysApi.updateDeptHoliday(orgId, deptId, id, patch)
    await loadHolidays()
  }

  function toggleSelect(h: CalendarHoliday) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(h.id)) next.delete(h.id)
      else next.add(h.id)
      return next
    })
  }

  function selectAll() {
    setSelectedIds(new Set(holidays.filter((h) => h.inherited).map((h) => h.id)))
  }

  /** Remove (opt out of) the currently selected inherited holidays. */
  async function confirmRemove() {
    if (!selected.length) return
    setRemoving(true)
    try {
      const orgIds = selected.filter((h) => h.origin === 'org').map((h) => h.id)
      const deptOnes = selected.filter((h) => h.origin === 'department')
      if (orgIds.length) {
        await holidaysApi.optOutOrgHolidaysForDept(orgId, deptId, orgIds, hasDescendants ? scopeSubtree : false)
      }
      for (const h of deptOnes) {
        await holidaysApi.optOutDeptHoliday(orgId, deptId, h.id)
      }
      setUndoToast({
        count: selected.length,
        items: [
          ...orgIds.map((id) => ({ holiday_source: 'org' as const, holiday_id: id })),
          ...deptOnes.map((h) => ({ holiday_source: 'department' as const, holiday_id: h.id })),
        ],
      })
      setConfirmOpen(false)
      await loadHolidays()
    } finally {
      setRemoving(false)
    }
  }

  /** Undo the most recent removal batch (org + dept origins). */
  async function undoRemoval() {
    if (!undoToast) return
    const { items } = undoToast
    setUndoToast(null)
    const orgIds = items.filter((i) => i.holiday_source === 'org').map((i) => i.holiday_id)
    const deptIds = items.filter((i) => i.holiday_source === 'department').map((i) => i.holiday_id)
    if (orgIds.length) await holidaysApi.undoOptOutOrgHolidaysForDept(orgId, deptId, orgIds)
    for (const id of deptIds) await holidaysApi.undoOptOutDeptHoliday(orgId, deptId, id)
    await loadHolidays()
  }

  /** Restore a single org holiday this department had removed (from the Removed drawer). */
  async function restoreOrgHoliday(orgHolidayId: string) {
    await holidaysApi.undoOptOutOrgHolidaysForDept(orgId, deptId, [orgHolidayId])
    await loadHolidays()
  }

  // Auto-dismiss the undo toast after a few seconds.
  useEffect(() => {
    if (!undoToast) return
    const t = setTimeout(() => setUndoToast(null), 6000)
    return () => clearTimeout(t)
  }, [undoToast])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 size={20} className="animate-spin text-text-muted" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-[18px] font-semibold text-text-primary">{deptName}</h3>
        <p className="text-sm text-text-secondary mt-0.5">
          Org holidays apply here by default; add department holidays on top, or remove any you don&apos;t observe.
        </p>
      </div>

      {/* Working days — slim strip with override switch */}
      <WorkingDaysStrip
        days={effectiveDays}
        override={override}
        status={status}
        disabled={!isAdmin}
        overrideLabel="Override org defaults"
        followingLabel="Following org days"
        onToggleDay={toggleDay}
        onToggleOverride={toggleOverride}
      />

      {/* Holidays + calendar, side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6 items-start lg:items-stretch">
        <div className="bg-white border border-border-light rounded-[12px] p-5 shadow-[0_1px_3px_rgba(0,0,0,0.08)] flex flex-col">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4 shrink-0">
            <div className="flex items-center gap-3">
              <h2 className="text-[18px] font-semibold text-text-primary">Holidays</h2>
              <div className="flex items-center gap-1 rounded-[8px] border border-border bg-white">
                <button
                  type="button"
                  onClick={() => setSelectedYear((y) => y - 1)}
                  className="p-1.5 rounded-l-[7px] text-text-secondary hover:bg-surface-control transition-colors"
                  aria-label="Previous year"
                >
                  <ChevronLeft size={15} />
                </button>
                <span className="min-w-[44px] text-center text-sm font-semibold text-text-primary tabular-nums">{selectedYear}</span>
                <button
                  type="button"
                  onClick={() => setSelectedYear((y) => y + 1)}
                  className="p-1.5 rounded-r-[7px] text-text-secondary hover:bg-surface-control transition-colors"
                  aria-label="Next year"
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>

            {isAdmin && (
              <button
                type="button"
                onClick={() => setShowAdd(true)}
                className="flex items-center gap-1.5 h-9 px-4 rounded-[8px] text-sm font-semibold text-white bg-primary hover:bg-primary-hover transition-colors"
              >
                <Plus size={15} />
                New Holiday
              </button>
            )}
          </div>

          {/* Bulk-selection action bar — appears when inherited holidays are selected. */}
          {isAdmin && selectedIds.size > 0 && (
            <div className="flex items-center justify-between gap-3 mb-3 px-3 py-2 rounded-[8px] bg-primary-subtle border border-primary-border shrink-0">
              <span className="text-sm font-medium text-primary-text">{selectedIds.size} selected</span>
              <div className="flex items-center gap-2">
                {selectedIds.size < selectableCount && (
                  <button type="button" onClick={selectAll} className="text-sm font-medium text-primary-text hover:underline">
                    Select all {selectableCount}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="text-sm font-medium text-text-secondary hover:underline"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => { setScopeSubtree(true); setConfirmOpen(true) }}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[8px] text-sm font-semibold text-white bg-danger hover:bg-danger-hover transition-colors"
                >
                  <Trash2 size={14} /> Remove selected
                </button>
              </div>
            </div>
          )}

          {holidaysLoading ? (
            <div className="flex items-center justify-center h-16"><Loader2 size={18} className="animate-spin text-text-muted" /></div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto lg:max-h-[360px]">
              <OrgHolidayList
                holidays={holidays}
                onDelete={deleteHoliday}
                onUpdate={updateHoliday}
                onOptOut={(h) => { setSelectedIds(new Set([h.id])); setScopeSubtree(true); setConfirmOpen(true) }}
                selectable={isAdmin}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                emptyText="No holidays for this department."
              />
            </div>
          )}

          {/* Removed drawer — org holidays this department took out of its calendar. */}
          {removedOrg.length > 0 && (
            <div className="mt-3 border-t border-border-light pt-3 shrink-0">
              <button
                type="button"
                onClick={() => setShowRemoved((s) => !s)}
                className="flex items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-text-primary"
              >
                {showRemoved ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                Removed holidays ({removedOrg.length})
              </button>
              {showRemoved && (
                <div className="mt-2 space-y-1.5">
                  {removedOrg.map((r) => (
                    <div key={r.org_holiday_id} className="flex items-center gap-3 py-1.5 px-2 rounded-[8px] bg-surface-sunken">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-text-secondary line-through truncate">{r.name}</p>
                        <p className="text-[11px] text-text-muted">
                          {r.date ? parseLocalDate(r.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                          {r.applies_to_subtree ? ' · also removed for sub-departments' : ''}
                        </p>
                      </div>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => restoreOrgHoliday(r.org_holiday_id)}
                          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[8px] text-sm font-medium text-primary-text hover:bg-primary-subtle transition-colors"
                        >
                          <RotateCcw size={13} /> Restore
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <OrgHolidayCalendar workingDays={effectiveDays} holidays={holidays} />
      </div>

      <HolidayFormModal
        isOpen={showAdd}
        onClose={() => setShowAdd(false)}
        onAdd={addHoliday}
        title="New Department Holiday"
        departments={departments}
        originDeptId={deptId}
        originDeptName={deptName}
      />

      {/* Bulk removal confirmation — firm, with the parent's scope choice for org holidays. */}
      <Modal
        isOpen={confirmOpen}
        onClose={() => !removing && setConfirmOpen(false)}
        title={selected.length === 1 ? 'Remove holiday' : `Remove ${selected.length} holidays`}
        size="sm"
      >
        <div className="space-y-3">
          <p className="text-sm text-text-primary">
            Remove {selected.length === 1 ? <><span className="font-semibold">{selected[0]?.name}</span></> : <><span className="font-semibold">{selected.length} holidays</span></>} from <span className="font-semibold">{deptName}</span>?
          </p>
          <ul className="text-sm text-text-secondary space-y-1.5 list-disc pl-5">
            <li>These dates will be treated as <span className="font-medium text-text-primary">normal working days</span> for this department{scopeSubtree && selectedHasOrg && hasDescendants ? ' and its sub-departments' : ''}.</li>
            <li>Nothing is deleted — you can restore them later from <span className="font-medium text-text-primary">Removed holidays</span>.</li>
          </ul>

          {selectedHasOrg && hasDescendants && (
            <div className="rounded-[8px] border border-border-light p-3 space-y-2">
              <p className="text-[13px] font-medium text-text-secondary">Apply this removal to:</p>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="radio" className="mt-0.5 accent-primary" checked={!scopeSubtree} onChange={() => setScopeSubtree(false)} />
                <span className="text-sm text-text-primary">Just <span className="font-medium">{deptName}</span> <span className="text-text-muted">— sub-departments keep these holidays</span></span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="radio" className="mt-0.5 accent-primary" checked={scopeSubtree} onChange={() => setScopeSubtree(true)} />
                <span className="text-sm text-text-primary"><span className="font-medium">{deptName}</span> and all sub-departments <span className="text-text-muted">— they can&apos;t re-add them</span></span>
              </label>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={removing}>Cancel</Button>
            <Button variant="danger" onClick={confirmRemove} isLoading={removing} disabled={removing}>
              {selected.length === 1 ? 'Remove' : `Remove ${selected.length}`}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Undo toast — a few seconds to reverse an accidental removal. */}
      {undoToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-90 flex items-center gap-3 rounded-[10px] bg-[#0F172A] text-white px-4 py-3 shadow-[0_8px_28px_rgba(0,0,0,0.25)]">
          <span className="text-sm">Removed <span className="font-semibold">{undoToast.count}</span> holiday{undoToast.count === 1 ? '' : 's'}</span>
          <button
            type="button"
            onClick={undoRemoval}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#93C5FD] hover:text-white transition-colors"
          >
            <Undo2 size={14} /> Undo
          </button>
          <button type="button" onClick={() => setUndoToast(null)} className="text-text-muted hover:text-white transition-colors"><X size={14} /></button>
        </div>
      )}
    </div>
  )
}
