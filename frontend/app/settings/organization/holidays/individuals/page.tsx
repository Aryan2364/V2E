'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '@/lib/auth/context'
import { getEmployees } from '@/lib/api/employees'
import { formatDate } from '@/lib/format'
import { holidaysApi } from '@/lib/api/holidays'
import type { EmployeeProfile } from '@/lib/types'
import type { IndividualWorkingDays, CalendarHoliday, HolidayOptOutSource } from '@/lib/types/holidays'
import { Loader2, Search, User, Plus, Trash2, Undo2, RotateCcw, ChevronDown, ChevronRight, X } from 'lucide-react'
import WorkingDaysStrip from '@/components/holidays/WorkingDaysStrip'
import OrgHolidayList from '@/components/holidays/OrgHolidayList'
import HolidayFormModal, { type HolidayFormData } from '@/components/holidays/HolidayFormModal'
import HolidayCalendar from '@/components/holidays/HolidayCalendar'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/button'
import { parseLocalDate } from '@/lib/date'

// An individual override applies to every date (it has no natural start), so the
// single backing record uses a far-past effective_from and an open end.
const OVERRIDE_FROM = '2000-01-01'

/** The opt-out source for an inherited holiday row. */
function sourceOf(h: CalendarHoliday): HolidayOptOutSource {
  return h.origin === 'org' ? 'org' : 'department'
}

export default function IndividualsPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const isAdmin = !!user?.is_admin

  const [employees, setEmployees] = useState<EmployeeProfile[]>([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<EmployeeProfile | null>(null)
  const [loading, setLoading] = useState(true)

  // Working days: the employee follows their department (or org) until they override.
  const [orgDays, setOrgDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6])
  const [deptDays, setDeptDays] = useState<number[] | null>(null)
  const [records, setRecords] = useState<IndividualWorkingDays[]>([])
  const [wdStatus, setWdStatus] = useState<'idle' | 'saving' | 'saved'>('idle')

  // Effective holidays (inherited org/dept + personal) and what the user removed.
  const [holidays, setHolidays] = useState<CalendarHoliday[]>([])
  const [removed, setRemoved] = useState<{ id: string; name: string; date: string | null; source: HolidayOptOutSource }[]>([])
  const [empLoading, setEmpLoading] = useState(false)
  const [calRefresh, setCalRefresh] = useState(0)
  const [showAddHoliday, setShowAddHoliday] = useState(false)

  // Bulk removal (personal opt-out of inherited holidays).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [undoToast, setUndoToast] = useState<{ items: { holiday_source: HolidayOptOutSource; holiday_id: string }[]; count: number } | null>(null)
  const [showRemoved, setShowRemoved] = useState(false)

  const hasDept = !!selected?.department?.id
  const defaultDays = deptDays ?? orgDays
  const overrideRecord = records[0] ?? null
  const override = !!overrideRecord
  const effectiveDays = override ? overrideRecord!.working_days : defaultDays

  const inheritedSelectable = useMemo(() => holidays.filter((h) => h.inherited).length, [holidays])
  const selectedRows = useMemo(() => holidays.filter((h) => selectedIds.has(h.id)), [holidays, selectedIds])

  useEffect(() => {
    if (!orgId) return
    getEmployees(orgId).then(setEmployees).finally(() => setLoading(false))
  }, [orgId])

  const loadHolidays = useCallback(async (emp: EmployeeProfile) => {
    const deptId = emp.department?.id
    const [effective, baseline] = await Promise.all([
      holidaysApi.listUserHolidays(orgId, emp.user_id),
      // Baseline = what this employee WOULD inherit (the dept's effective set, or the org
      // calendar if they're in no department). Diffing against `effective` yields the
      // holidays the employee personally removed — restorable from the drawer.
      deptId
        ? holidaysApi.listDeptHolidays(orgId, deptId)
        : holidaysApi.listOrgHolidays(orgId, { status: 'active' }).then((rows) =>
            rows.map((r): CalendarHoliday => ({ ...r, origin: 'org', inherited: true })),
          ),
    ])
    setHolidays(effective)
    const inheritedIds = new Set(effective.filter((h) => h.inherited).map((h) => h.id))
    setRemoved(
      baseline
        .filter((b) => !inheritedIds.has(b.id))
        .map((b) => ({ id: b.id, name: b.name, date: b.date, source: sourceOf(b) })),
    )
    setSelectedIds(new Set())
  }, [orgId])

  useEffect(() => {
    if (!selected || !orgId) return
    setEmpLoading(true)
    const deptId = selected.department?.id
    Promise.all([
      holidaysApi.getOrgWorkingDays(orgId),
      deptId ? holidaysApi.getDeptWorkingDays(orgId, deptId) : Promise.resolve(null),
      holidaysApi.listUserWorkingDays(orgId, selected.user_id),
      loadHolidays(selected),
    ]).then(([org, dept, wd]) => {
      setOrgDays(org.working_days)
      setDeptDays(dept?.working_days ?? null)
      setRecords(wd)
    }).finally(() => setEmpLoading(false))
  }, [selected, orgId, loadHolidays])

  // Drop the "Saved" note after a moment.
  useEffect(() => {
    if (wdStatus !== 'saved') return
    const t = setTimeout(() => setWdStatus('idle'), 2000)
    return () => clearTimeout(t)
  }, [wdStatus])

  // Auto-dismiss the undo toast.
  useEffect(() => {
    if (!undoToast) return
    const t = setTimeout(() => setUndoToast(null), 6000)
    return () => clearTimeout(t)
  }, [undoToast])

  const filtered = employees.filter((e) => {
    const q = search.toLowerCase()
    return (
      (e.user?.name ?? '').toLowerCase().includes(q) ||
      (e.department?.name ?? '').toLowerCase().includes(q) ||
      (e.role?.title ?? '').toLowerCase().includes(q)
    )
  })

  async function reloadRecords() {
    if (!selected) return
    const wd = await holidaysApi.listUserWorkingDays(orgId, selected.user_id)
    setRecords(wd)
  }

  function toggleDay(index: number) {
    if (!override || !isAdmin || !selected || !overrideRecord) return
    const cur = overrideRecord.working_days
    const next = cur.includes(index)
      ? cur.filter((d) => d !== index)
      : [...cur, index].sort((a, b) => a - b)
    setRecords((r) => r.map((x, i) => (i === 0 ? { ...x, working_days: next } : x))) // optimistic
    persistDays(next)
  }

  async function persistDays(days: number[]) {
    if (!selected || !overrideRecord) return
    setWdStatus('saving')
    try {
      const updated = await holidaysApi.updateUserWorkingDays(orgId, selected.user_id, overrideRecord.id, { working_days: days })
      setRecords((r) => r.map((x, i) => (i === 0 ? updated : x)))
      setWdStatus('saved')
      setCalRefresh((n) => n + 1)
    } catch {
      setWdStatus('idle')
      await reloadRecords()
    }
  }

  async function toggleOverride(next: boolean) {
    if (!isAdmin || !selected) return
    setWdStatus('saving')
    try {
      if (next) {
        const created = await holidaysApi.createUserWorkingDays(orgId, selected.user_id, {
          working_days: defaultDays,
          effective_from: OVERRIDE_FROM,
          effective_to: null,
        })
        setRecords([created])
      } else {
        await Promise.all(records.map((r) => holidaysApi.deleteUserWorkingDays(orgId, selected.user_id, r.id)))
        setRecords([])
      }
      setWdStatus('saved')
      setCalRefresh((n) => n + 1)
    } catch {
      setWdStatus('idle')
      await reloadRecords()
    }
  }

  async function addHoliday(data: HolidayFormData) {
    if (!selected) return
    await holidaysApi.createUserHoliday(orgId, selected.user_id, {
      name: data.name,
      date: data.date,
      type: data.type,
      status: 'active',
      is_recurring_yearly: data.is_recurring_yearly,
      description: data.description || null,
    })
    await loadHolidays(selected)
    setCalRefresh((n) => n + 1)
  }

  async function deleteHoliday(id: string) {
    if (!selected) return
    await holidaysApi.deleteUserHoliday(orgId, selected.user_id, id)
    setHolidays((h) => h.filter((x) => x.id !== id))
    setCalRefresh((n) => n + 1)
  }

  async function updateHoliday(id: string, patch: { name?: string; date?: string }) {
    if (!selected) return
    await holidaysApi.updateUserHoliday(orgId, selected.user_id, id, patch)
    await loadHolidays(selected)
    setCalRefresh((n) => n + 1)
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

  async function confirmRemove() {
    if (!selected || !selectedRows.length) return
    setRemoving(true)
    try {
      const items = selectedRows.map((h) => ({ holiday_source: sourceOf(h), holiday_id: h.id }))
      await holidaysApi.optOutUserHolidays(orgId, selected.user_id, items)
      setUndoToast({ items, count: items.length })
      setConfirmOpen(false)
      await loadHolidays(selected)
      setCalRefresh((n) => n + 1)
    } finally {
      setRemoving(false)
    }
  }

  async function undoRemoval() {
    if (!selected || !undoToast) return
    const { items } = undoToast
    setUndoToast(null)
    await holidaysApi.undoOptOutUserHolidays(orgId, selected.user_id, items)
    await loadHolidays(selected)
    setCalRefresh((n) => n + 1)
  }

  async function restoreHoliday(item: { id: string; source: HolidayOptOutSource }) {
    if (!selected) return
    await holidaysApi.undoOptOutUserHolidays(orgId, selected.user_id, [{ holiday_source: item.source, holiday_id: item.id }])
    await loadHolidays(selected)
    setCalRefresh((n) => n + 1)
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 size={24} className="animate-spin text-text-muted" /></div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-page-title font-medium text-text-primary">Individual Calendars</h1>
        <p className="text-body text-text-secondary mt-1">Set custom working days and personal holidays per employee.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
        {/* Employee search list */}
        <div className="bg-surface border border-border-light rounded-card overflow-hidden shadow-card">
          <div className="px-4 py-3 border-b border-border-light">
            <div className="flex items-center gap-2 px-2 py-1.5 bg-surface-sunken rounded-lg border border-border-light">
              <Search size={13} className="text-text-muted shrink-0" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search employees..."
                className="flex-1 bg-transparent text-body text-text-primary placeholder:text-text-muted outline-hidden"
              />
            </div>
          </div>
          <div className="divide-y divide-surface-control-pressed max-h-[calc(100vh-260px)] overflow-y-auto">
            {filtered.length === 0 && (
              <p className="px-4 py-4 text-body text-text-muted text-center">No employees found.</p>
            )}
            {filtered.map((emp) => (
              <button
                key={emp.id}
                type="button"
                onClick={() => setSelected(emp)}
                className={[
                  'w-full flex items-center gap-3 px-4 py-3 text-body text-left transition-colors',
                  selected?.id === emp.id
                    ? 'bg-primary-subtle text-primary-text'
                    : 'text-text-primary hover:bg-surface-sunken',
                ].join(' ')}
              >
                <User size={14} className="shrink-0 text-text-muted" />
                <div className="min-w-0">
                  <p className={`text-body font-medium truncate ${selected?.id === emp.id ? 'text-primary-text' : 'text-text-primary'}`}>
                    {emp.user?.name ?? 'Unnamed'}
                  </p>
                  <p className="text-meta text-text-muted truncate">
                    {[emp.department?.name, emp.role?.title].filter(Boolean).join(' · ') || emp.employment_type}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Detail panel — mirrors the department panel. */}
        {selected ? (
          empLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 size={20} className="animate-spin text-text-muted" />
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <h3 className="text-section font-medium text-text-primary">{selected.user?.name ?? 'Employee'}</h3>
                <p className="text-body text-text-secondary mt-0.5">
                  Inherits {hasDept ? 'department and org' : 'org'} holidays; add personal holidays, or remove any this employee doesn&apos;t observe.
                </p>
              </div>

              {/* Working days — slim strip with override switch */}
              <WorkingDaysStrip
                days={effectiveDays}
                override={override}
                status={wdStatus}
                disabled={!isAdmin}
                overrideLabel={hasDept ? 'Override department defaults' : 'Override org defaults'}
                followingLabel={hasDept ? 'Following department days' : 'Following org days'}
                onToggleDay={toggleDay}
                onToggleOverride={toggleOverride}
              />

              {/* Holidays + calendar, side by side */}
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6 items-start lg:items-stretch">
                <div className="bg-surface border border-border-light rounded-card p-4 shadow-card flex flex-col">
                  <div className="flex items-center justify-between gap-3 flex-wrap mb-4 shrink-0">
                    <h2 className="text-section font-medium text-text-primary">Holidays</h2>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => setShowAddHoliday(true)}
                        className="flex items-center gap-1.5 h-9 px-4 rounded-lg text-body font-medium text-primary-foreground bg-primary hover:bg-primary-hover transition-colors"
                      >
                        <Plus size={15} />
                        New Holiday
                      </button>
                    )}
                  </div>

                  {/* Bulk-selection action bar */}
                  {isAdmin && selectedIds.size > 0 && (
                    <div className="flex items-center justify-between gap-3 mb-3 px-3 py-2 rounded-lg bg-primary-subtle border border-primary-border shrink-0">
                      <span className="text-body font-medium text-primary-text">{selectedIds.size} selected</span>
                      <div className="flex items-center gap-2">
                        {selectedIds.size < inheritedSelectable && (
                          <button type="button" onClick={selectAll} className="text-body font-medium text-primary-text hover:underline">
                            Select all {inheritedSelectable}
                          </button>
                        )}
                        <button type="button" onClick={() => setSelectedIds(new Set())} className="text-body font-medium text-text-secondary hover:underline">Clear</button>
                        <button
                          type="button"
                          onClick={() => setConfirmOpen(true)}
                          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-body font-medium text-on-danger bg-danger hover:bg-danger-hover transition-colors"
                        >
                          <Trash2 size={14} /> Remove selected
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex-1 min-h-0 overflow-y-auto lg:max-h-[360px]">
                    <OrgHolidayList
                      holidays={holidays}
                      onDelete={deleteHoliday}
                      onUpdate={updateHoliday}
                      onOptOut={(h) => { setSelectedIds(new Set([h.id])); setConfirmOpen(true) }}
                      selectable={isAdmin}
                      selectedIds={selectedIds}
                      onToggleSelect={toggleSelect}
                      emptyText="No holidays for this employee."
                    />
                  </div>

                  {/* Removed drawer */}
                  {removed.length > 0 && (
                    <div className="mt-3 border-t border-border-light pt-3 shrink-0">
                      <button
                        type="button"
                        onClick={() => setShowRemoved((s) => !s)}
                        className="flex items-center gap-1.5 text-body font-medium text-text-secondary hover:text-text-primary"
                      >
                        {showRemoved ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        Removed holidays ({removed.length})
                      </button>
                      {showRemoved && (
                        <div className="mt-2 space-y-1.5">
                          {removed.map((r) => (
                            <div key={`${r.source}:${r.id}`} className="flex items-center gap-3 py-1.5 px-2 rounded-lg bg-surface-sunken">
                              <div className="flex-1 min-w-0">
                                <p className="text-body text-text-secondary line-through truncate">{r.name}</p>
                                <p className="text-meta text-text-muted">
                                  {r.date ? formatDate(parseLocalDate(r.date)) : ''}
                                  {r.source === 'org' ? ' · org holiday' : ' · department holiday'}
                                </p>
                              </div>
                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => restoreHoliday(r)}
                                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-body font-medium text-primary-text hover:bg-primary-subtle transition-colors"
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

                <HolidayCalendar
                  orgId={orgId}
                  deptId={selected.department?.id}
                  userId={selected.user_id}
                  refreshKey={calRefresh}
                />
              </div>

              <HolidayFormModal
                isOpen={showAddHoliday}
                onClose={() => setShowAddHoliday(false)}
                onAdd={addHoliday}
                title="New Personal Holiday"
                allowRange={false}
                defaultType="personal"
              />
            </div>
          )
        ) : (
          <div className="flex items-center justify-center h-48 bg-surface border border-border-light rounded-card shadow-card">
            <p className="text-text-muted text-body">Select an employee to view their schedule.</p>
          </div>
        )}
      </div>

      {/* Bulk removal confirmation */}
      <Modal
        isOpen={confirmOpen}
        onClose={() => !removing && setConfirmOpen(false)}
        title={selectedRows.length === 1 ? 'Remove holiday' : `Remove ${selectedRows.length} holidays`}
        size="sm"
      >
        <div className="space-y-3">
          <p className="text-body text-text-primary">
            Remove {selectedRows.length === 1 ? <span className="font-medium">{selectedRows[0]?.name}</span> : <span className="font-medium">{selectedRows.length} holidays</span>} for <span className="font-medium">{selected?.user?.name ?? 'this employee'}</span>?
          </p>
          <ul className="text-body text-text-secondary space-y-1.5 list-disc pl-4">
            <li>These dates will be treated as <span className="font-medium text-text-primary">normal working days</span> for this employee only.</li>
            <li>Nothing is deleted — you can restore them later from <span className="font-medium text-text-primary">Removed holidays</span>.</li>
          </ul>
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={removing}>Cancel</Button>
            <Button variant="danger" onClick={confirmRemove} isLoading={removing} disabled={removing}>
              {selectedRows.length === 1 ? 'Remove' : `Remove ${selectedRows.length}`}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Undo toast */}
      {undoToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-90 flex items-center gap-3 rounded-xl bg-text-primary text-surface px-4 py-3 shadow-menu">
          <span className="text-body">Removed <span className="font-medium">{undoToast.count}</span> holiday{undoToast.count === 1 ? '' : 's'}</span>
          <button type="button" onClick={undoRemoval} className="inline-flex items-center gap-1.5 text-body font-medium text-surface/70 hover:text-surface transition-colors">
            <Undo2 size={14} /> Undo
          </button>
          <button type="button" onClick={() => setUndoToast(null)} className="text-text-muted hover:text-text-primary transition-colors"><X size={14} /></button>
        </div>
      )}
    </div>
  )
}
