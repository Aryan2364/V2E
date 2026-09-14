'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { reportsApi } from '@/lib/api/reports'
import { getDepartments } from '@/lib/api/departments'
import type { Department } from '@/lib/types'
import type {
  AgeingReport, AgeBuckets, AgeBucketKey, PersonAgeRow, TaskAgeRow, PendingTaskRow, ScorecardScope,
} from '@/lib/types/reports'
import type { WorkScope } from '@/lib/types/tasks'
import ScopeSwitcher from '@/components/tasks/overview/ScopeSwitcher'
import DepartmentMultiSelect from '@/components/employees/DepartmentMultiSelect'
import StyledSelect from '@/components/ui/StyledSelect'
import PendingDrillDrawer, { type DrillFilter } from '@/components/reports/PendingDrillDrawer'
import { exportAgeingXlsx } from '@/lib/reports/ageing-export'
import { BUCKETS, WITHDRAWN_META, HANDED_OVER_META, OVER_MONTH_BUCKETS, BUCKET_LABEL, countColor, fmtDate, fmtAsOn } from '@/lib/reports/ageing-format'
import { useSort } from '@/lib/reports/use-sort'
import { ArrowLeft, Search, Download, Lock, CalendarClock, ArrowUpDown, AlertTriangle, Inbox } from 'lucide-react'

type Tab = 'person' | 'task' | 'pending'
const STATE_KEY = 'ageing-report-state-v1'

// Columns after the identity column(s): seven bands + four derived figures, then the
// two integrity columns APPENDED at the end so the client's signed-off column order is
// untouched. Shared by the Person-wise and Task-wise grids.
const BAND_COLS: { id: string; label: string; title: string }[] = [
  ...BUCKETS.map((b) => ({ id: b.key, label: b.short, title: b.label })),
  { id: 'total_pending', label: 'Total', title: 'Total Pending — every open task, including Not Yet Due (Withdrawn excluded)' },
  { id: 'over_month_late', label: '› Month', title: 'More than a Month Late — everything above 30 days (the review column)' },
  { id: 'oldest_late_days', label: 'Oldest', title: 'Oldest Late Task, in days (Not Yet Due excluded)' },
  { id: 'avg_late_days', label: 'Avg Late', title: 'Average Days Late (Not Yet Due excluded)' },
  {
    id: 'withdrawn',
    label: 'Withdrawn',
    title: 'Removed from the task before its original due date without finishing — listed so the removal is visible, but not aged and not counted in Total Pending',
  },
  {
    id: 'handed_over',
    label: 'Handed over',
    title: 'Already late when this person was taken off and the task was given to someone else. Listed so the delay stays visible, but not aged and not counted in Total Pending — it is not their work to finish any more. Open it to see who holds each one now',
  },
  {
    id: 'revised_entries',
    label: 'Revised',
    title: 'Pending tasks whose due date has been revised at least once. Ageing is always measured against the ORIGINAL due date, so moving a deadline cannot change a band',
  },
]

const bandAccessors = Object.fromEntries(BAND_COLS.map((c) => [c.id, (r: AgeBuckets) => (r as any)[c.id] as number | null]))

interface PersistState {
  tab: Tab
  personSearch: string; personDeptIds: string[]
  taskSearch: string; taskFreq: string
  pendingSearch: string; pendingDeptIds: string[]; pendingFreq: string; pendingBand: string
  scrollTop: number
}

export default function AgeingReportPage() {
  const { user } = useAuth()
  const router = useRouter()
  const orgId = user?.organizationId ?? ''

  const [requestedScope, setRequestedScope] = useState<ScorecardScope | undefined>(undefined)
  const [report, setReport] = useState<AgeingReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [departments, setDepartments] = useState<Department[]>([])
  const [drill, setDrill] = useState<DrillFilter | null>(null)

  // Restore persisted view (survives the round-trip to a task screen). Read once.
  const restored = useRef<PersistState | null>(null)
  if (restored.current === null && typeof window !== 'undefined') {
    try {
      const raw = sessionStorage.getItem(STATE_KEY)
      restored.current = raw ? (JSON.parse(raw) as PersistState) : ({} as PersistState)
    } catch { restored.current = {} as PersistState }
  }
  const r0 = restored.current ?? ({} as PersistState)

  const [tab, setTab] = useState<Tab>(r0.tab ?? 'person')
  const [personSearch, setPersonSearch] = useState(r0.personSearch ?? '')
  const [personDeptIds, setPersonDeptIds] = useState<string[]>(r0.personDeptIds ?? [])
  const [taskSearch, setTaskSearch] = useState(r0.taskSearch ?? '')
  const [taskFreq, setTaskFreq] = useState(r0.taskFreq ?? 'all')
  const [pendingSearch, setPendingSearch] = useState(r0.pendingSearch ?? '')
  const [pendingDeptIds, setPendingDeptIds] = useState<string[]>(r0.pendingDeptIds ?? [])
  const [pendingFreq, setPendingFreq] = useState(r0.pendingFreq ?? 'all')
  const [pendingBand, setPendingBand] = useState(r0.pendingBand ?? 'all')

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    setLoading(true)
    reportsApi
      .getAgeingReport(orgId, requestedScope)
      .then((res) => { if (!cancelled) setReport(res) })
      .catch(() => { if (!cancelled) setReport(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [orgId, requestedScope])

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    getDepartments(orgId).then((d) => { if (!cancelled) setDepartments(d) }).catch(() => { if (!cancelled) setDepartments([]) })
    return () => { cancelled = true }
  }, [orgId])

  // Restore scroll once the data is on screen.
  useEffect(() => {
    if (loading || !report || !restored.current?.scrollTop) return
    const y = restored.current.scrollTop
    // Wait a frame so the restored rows exist before scrolling.
    requestAnimationFrame(() => window.scrollTo(0, y))
    restored.current = { ...(restored.current as PersistState), scrollTop: 0 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, report])

  const persist = () => {
    try {
      const scrollTop = window.scrollY
      const s: PersistState = {
        tab, personSearch, personDeptIds, taskSearch, taskFreq,
        pendingSearch, pendingDeptIds, pendingFreq, pendingBand, scrollTop,
      }
      sessionStorage.setItem(STATE_KEY, JSON.stringify(s))
    } catch { /* ignore */ }
  }

  const openTask = (taskId: string) => { persist(); router.push(`/dashboard/tasks/${taskId}`) }

  // Department id → name set (rows carry names).
  const deptNames = (ids: string[]) => {
    if (ids.length === 0) return null
    const byId = new Map(departments.map((d) => [d.id, d.name]))
    return new Set(ids.map((id) => byId.get(id)).filter(Boolean) as string[])
  }

  // ── Person-wise ──────────────────────────────────────────────────────────────---
  const personFiltered = useMemo(() => {
    if (!report) return []
    const q = personSearch.trim().toLowerCase()
    const names = deptNames(personDeptIds)
    return report.people.filter((p) => {
      if (names && !(p.department_name && names.has(p.department_name))) return false
      if (q && !p.name.toLowerCase().includes(q) && !(p.role_title ?? '').toLowerCase().includes(q)) return false
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, personSearch, personDeptIds, departments])

  const personSort = useSort<PersonAgeRow>(
    personFiltered,
    { name: (r) => r.name, ...(bandAccessors as any) },
    { key: 'total_pending', dir: 'desc' },
  )

  // ── Task-wise ────────────────────────────────────────────────────────────────---
  const taskFiltered = useMemo(() => {
    if (!report) return []
    const q = taskSearch.trim().toLowerCase()
    return report.tasks.filter((t) => {
      if (taskFreq !== 'all' && t.frequency !== taskFreq) return false
      if (q && !t.title.toLowerCase().includes(q)) return false
      return true
    })
  }, [report, taskSearch, taskFreq])

  const taskSort = useSort<TaskAgeRow>(
    taskFiltered,
    { title: (r) => r.title, frequency: (r) => r.frequency, ...(bandAccessors as any) },
    { key: 'total_pending', dir: 'desc' },
  )

  // ── Pending list ─────────────────────────────────────────────────────────────---
  const pendingFiltered = useMemo(() => {
    if (!report) return []
    const q = pendingSearch.trim().toLowerCase()
    const names = deptNames(pendingDeptIds)
    const bandSet: Set<AgeBucketKey> | null =
      pendingBand === 'all' ? null : pendingBand === 'over_month' ? new Set(OVER_MONTH_BUCKETS) : new Set([pendingBand as AgeBucketKey])
    return report.pending.filter((r) => {
      if (names && !(r.department && names.has(r.department))) return false
      if (pendingFreq !== 'all' && r.frequency !== pendingFreq) return false
      // "All ages" means all AGE bands — withdrawn rows are not aged and are not part
      // of Total Pending, so they surface only under their own option. Same rule the
      // drill drawer applies, so the two views never disagree about what "all" means.
      if (!bandSet) { if (r.bucket === 'withdrawn' || r.bucket === 'handed_over') return false }
      else if (!bandSet.has(r.bucket)) return false
      if (q && !r.title.toLowerCase().includes(q) && !r.assigned_to.toLowerCase().includes(q) && !(r.assigned_by ?? '').toLowerCase().includes(q)) return false
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, pendingSearch, pendingDeptIds, pendingFreq, pendingBand, departments])

  const pendingSort = useSort<PendingTaskRow>(
    pendingFiltered,
    {
      title: (r) => r.title, assigned_to: (r) => r.assigned_to, assigned_by: (r) => r.assigned_by,
      department: (r) => r.department, frequency: (r) => r.frequency, due_date: (r) => r.due_date, days_late: (r) => r.days_late,
    },
    { key: 'days_late', dir: 'desc' },
  )

  async function downloadReport() {
    if (!report || downloading) return
    setDownloading(true)
    try {
      // Export the exact snapshot on screen (same As-On date, same figures) — never a refetch.
      await exportAgeingXlsx(report, `pending-overdue-ageing-${report.applied_scope ?? 'scope'}`)
    } finally { setDownloading(false) }
  }

  const freqOptions = useMemo(
    () => [{ value: 'all', label: 'All frequencies' }, ...((report?.frequencies ?? []).map((f) => ({ value: f, label: f })))],
    [report],
  )
  const bandOptions = [
    { value: 'all', label: 'All ages' },
    ...BUCKETS.map((b) => ({ value: b.key, label: b.label })),
    { value: 'over_month', label: 'More than a Month Late' },
    { value: WITHDRAWN_META.key, label: WITHDRAWN_META.label },
    { value: HANDED_OVER_META.key, label: HANDED_OVER_META.label },
  ]

  // Drill openers.
  const drillPerson = (p: PersonAgeRow, buckets: AgeBucketKey[] | null, bandLabel: string | null) =>
    setDrill({ personId: p.user_id, personName: p.name, taskTitle: null, buckets, bandLabel })
  const drillTask = (t: TaskAgeRow, buckets: AgeBucketKey[] | null, bandLabel: string | null) =>
    setDrill({ personId: null, personName: null, taskTitle: t.title, buckets, bandLabel })

  return (
    <div className="space-y-5">
      <button onClick={() => router.push('/dashboard/tasks/reports-new')} className="inline-flex items-center gap-1.5 text-sm text-[#475569] hover:text-[#0F172A] transition-colors">
        <ArrowLeft size={15} /> Reports
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold text-[#0F172A] leading-tight">Pending &amp; Overdue Ageing</h1>
          <p className="mt-1 text-[15px] text-[#475569]">
            Only open work — Overdue or Ongoing — sorted into age bands so the oldest pile stands out.
          </p>
          {report && (
            <p className="mt-1.5 inline-flex items-center gap-1.5 text-sm font-medium text-[#1D4ED8]">
              <CalendarClock size={15} /> Position as on {fmtAsOn(report.as_on_date)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ScopeSwitcher
            maxScope={(report?.max_scope as WorkScope) ?? null}
            value={(report?.applied_scope as WorkScope) ?? 'own'}
            onChange={(s) => setRequestedScope(s as ScorecardScope)}
          />
          <button
            onClick={downloadReport}
            disabled={downloading || !report || (report.totals.total_pending === 0 && report.totals.withdrawn === 0 && report.totals.handed_over === 0)}
            className="flex items-center gap-1.5 px-3.5 py-[7px] bg-[#2563EB] text-white rounded-[8px] text-sm font-semibold hover:bg-[#1D4ED8] disabled:opacity-60 transition-colors"
          >
            <Download size={15} /> {downloading ? 'Preparing…' : 'Download'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[#E2E8F0]">
        {([['person', 'By Person'], ['task', 'By Task'], ['pending', 'Pending List']] as [Tab, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === id ? 'border-[#2563EB] text-[#2563EB]' : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
            }`}
          >
            {label}
            {report && (
              <span className="ml-1.5 text-xs font-medium text-[#94A3B8]">
                {id === 'person' ? report.people.length : id === 'task' ? report.tasks.length : report.totals.total_pending}
              </span>
            )}
          </button>
        ))}
      </div>

      {report?.list_truncated && tab === 'pending' && (
        <div className="flex items-start gap-2 rounded-[10px] border border-[#FDE68A] bg-[#FFFBEB] px-4 py-2.5 text-sm text-[#92400E]">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>This view is very large, so the detail list is capped at the newest {report.pending.length.toLocaleString()} rows. The By&nbsp;Person and By&nbsp;Task totals above are still complete — narrow the scope for a full drill-down.</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-48"><div className="w-7 h-7 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" /></div>
      ) : !report || report.people.length === 0 ? (
        <div className="bg-white border border-[#E2E8F0] rounded-[12px] py-16 flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-full bg-[#FEE2E2] flex items-center justify-center mb-4"><Lock size={24} className="text-[#DC2626]" /></div>
          <p className="font-semibold text-[#0F172A]">{report ? 'No pending work in your scope' : 'No access'}</p>
          <p className="text-sm text-[#475569] mt-1 max-w-sm">{report ? 'Everyone you can see is up to date — nothing is overdue or ongoing.' : 'You can only see ageing for people within your visibility.'}</p>
        </div>
      ) : tab === 'person' ? (
        // ── By Person ──────────────────────────────────────────────────────────────
        <>
          <Toolbar>
            <SearchBox value={personSearch} onChange={setPersonSearch} placeholder="Search people…" />
            <div className="w-[230px]"><DepartmentMultiSelect selected={personDeptIds} onChange={setPersonDeptIds} departments={departments} allLabel="All departments" /></div>
          </Toolbar>
          <GridCard>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[#475569] text-left whitespace-nowrap">
                  <SortHead sort={personSort} id="name" className="px-4 sticky left-0 bg-[#F8FAFC] z-10">Person</SortHead>
                  {BAND_COLS.map((c) => <SortHead key={c.id} sort={personSort} id={c.id} title={c.title} center>{c.label}</SortHead>)}
                </tr>
              </thead>
              <tbody>
                {personSort.sorted.map((p) => (
                  <tr key={p.user_id} className="group border-b border-[#F1F5F9] last:border-0 hover:bg-[#F8FAFC] transition-colors whitespace-nowrap">
                    <td className="px-4 py-3 sticky left-0 bg-white group-hover:bg-[#F8FAFC] z-10">
                      <button onClick={() => drillPerson(p, null, null)} className="text-left min-w-0 hover:text-[#2563EB]">
                        <p className="font-semibold text-[#0F172A] group-hover:text-[#2563EB] truncate">{p.name}</p>
                        {p.role_title && <p className="text-[12px] text-[#94A3B8] truncate">{p.role_title}</p>}
                      </button>
                    </td>
                    <BandCells b={p} onDrill={(buckets, label) => drillPerson(p, buckets, label)} />
                  </tr>
                ))}
                {personSort.sorted.length === 0 && <EmptyRow span={BAND_COLS.length + 1} />}
              </tbody>
              {personSort.sorted.length > 0 && personDeptIds.length === 0 && !personSearch.trim() && (
                <TotalsFoot label={`Total / Overall · ${report.people.length} people`} totals={report.totals} leadCols={1} />
              )}
            </table>
          </GridCard>
        </>
      ) : tab === 'task' ? (
        // ── By Task ────────────────────────────────────────────────────────────────
        <>
          <Toolbar>
            <SearchBox value={taskSearch} onChange={setTaskSearch} placeholder="Search tasks…" />
            <div className="w-[200px]"><StyledSelect value={taskFreq} onChange={setTaskFreq} options={freqOptions} /></div>
          </Toolbar>
          <GridCard>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[#475569] text-left whitespace-nowrap">
                  <SortHead sort={taskSort} id="title" className="px-4 sticky left-0 bg-[#F8FAFC] z-10">Task</SortHead>
                  <SortHead sort={taskSort} id="frequency">Frequency</SortHead>
                  {BAND_COLS.map((c) => <SortHead key={c.id} sort={taskSort} id={c.id} title={c.title} center>{c.label}</SortHead>)}
                </tr>
              </thead>
              <tbody>
                {taskSort.sorted.map((t) => (
                  <tr key={t.title} className="group border-b border-[#F1F5F9] last:border-0 hover:bg-[#F8FAFC] transition-colors whitespace-nowrap">
                    <td className="px-4 py-3 sticky left-0 bg-white group-hover:bg-[#F8FAFC] z-10 max-w-[320px]">
                      <button onClick={() => drillTask(t, null, null)} className="text-left hover:text-[#2563EB] font-semibold text-[#0F172A] group-hover:text-[#2563EB]">
                        <span className="line-clamp-1">{t.title}</span>
                      </button>
                    </td>
                    <td className="px-3 py-3 text-[#475569]">{t.frequency}</td>
                    <BandCells b={t} onDrill={(buckets, label) => drillTask(t, buckets, label)} />
                  </tr>
                ))}
                {taskSort.sorted.length === 0 && <EmptyRow span={BAND_COLS.length + 2} />}
              </tbody>
              {taskSort.sorted.length > 0 && taskFreq === 'all' && !taskSearch.trim() && (
                <TotalsFoot label={`Total / Overall · ${report.tasks.length} tasks`} totals={report.totals} leadCols={2} />
              )}
            </table>
          </GridCard>
        </>
      ) : (
        // ── Pending List ───────────────────────────────────────────────────────────
        <>
          <Toolbar>
            <SearchBox value={pendingSearch} onChange={setPendingSearch} placeholder="Search task, person or assigner…" />
            <div className="w-[210px]"><DepartmentMultiSelect selected={pendingDeptIds} onChange={setPendingDeptIds} departments={departments} allLabel="All departments" /></div>
            <div className="w-[180px]"><StyledSelect value={pendingFreq} onChange={setPendingFreq} options={freqOptions} /></div>
            <div className="w-[210px]"><StyledSelect value={pendingBand} onChange={setPendingBand} options={bandOptions} /></div>
          </Toolbar>
          <GridCard>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[#475569] text-left whitespace-nowrap">
                  <SortHead sort={pendingSort} id="title" className="px-4">Task</SortHead>
                  <SortHead sort={pendingSort} id="assigned_to">Assigned To</SortHead>
                  <SortHead sort={pendingSort} id="assigned_by">Assigned By</SortHead>
                  <SortHead sort={pendingSort} id="department">Department</SortHead>
                  <SortHead sort={pendingSort} id="frequency">Frequency</SortHead>
                  <SortHead sort={pendingSort} id="due_date">Due Date</SortHead>
                  <SortHead sort={pendingSort} id="days_late" center>Days Late</SortHead>
                  <th className="px-3 py-3 font-semibold">How Late</th>
                </tr>
              </thead>
              <tbody>
                {pendingSort.sorted.map((r) => (
                  <tr
                    key={`${r.task_id}:${r.assigned_to_user_id}`}
                    onClick={() => openTask(r.task_id)}
                    className="border-b border-[#F1F5F9] last:border-0 hover:bg-[#EFF6FF] cursor-pointer transition-colors align-top"
                    title="Open task"
                  >
                    <td className="px-4 py-3 font-medium text-[#0F172A] max-w-[280px]"><span className="line-clamp-2">{r.title}</span></td>
                    <td className="px-3 py-3 text-[#0F172A] whitespace-nowrap">
                      {r.assigned_to}
                      {r.handover && (
                        <span className="block text-[11px] font-normal text-[#475569]" title={`Taken off ${r.assigned_to} on ${fmtDate(r.handover.at)}. This is no longer pending on them.`}>
                          → now with {r.handover.to.length ? r.handover.to.join(', ') : 'no one'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-[#475569] whitespace-nowrap">{r.assigned_by ?? '—'}</td>
                    <td className="px-3 py-3 text-[#475569] whitespace-nowrap">{r.department ?? '—'}</td>
                    <td className="px-3 py-3 text-[#475569] whitespace-nowrap">{r.frequency}</td>
                    <td className="px-3 py-3 text-[#475569] whitespace-nowrap tabular-nums">
                      {fmtDate(r.due_date)}
                      {/* The due date shown is the LIVE one; the ageing beside it was measured
                          against the original. Say so when the two differ, rather than letting
                          a moved deadline quietly explain away the Days Late figure. */}
                      {r.deadline_revision_count > 0 && (
                        <span className="block text-[11px] font-medium text-[#B45309]" title={`Originally due ${fmtDate(r.original_deadline)} — aged from that date`}>
                          Revised {r.deadline_revision_count}× · was {fmtDate(r.original_deadline)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-center tabular-nums font-semibold whitespace-nowrap" style={{ color: r.days_late === null ? '#94A3B8' : r.days_late > 30 ? '#DC2626' : '#B45309' }}>{r.days_late ?? '—'}</td>
                    <td className="px-3 py-3 whitespace-nowrap"><span className={`text-xs font-medium ${r.status === 'Overdue' ? 'text-[#B91C1C]' : 'text-[#475569]'}`}>{r.bucket_label}</span></td>
                  </tr>
                ))}
                {pendingSort.sorted.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-[#94A3B8]"><Inbox size={22} className="mx-auto mb-2" />No pending tasks match your filters.</td></tr>
                )}
              </tbody>
            </table>
          </GridCard>
          <p className="text-xs text-[#94A3B8]">Showing {pendingSort.sorted.length.toLocaleString()} of {report.pending.length.toLocaleString()} pending {report.pending.length === 1 ? 'task' : 'tasks'}. Click a row to open the task.</p>
        </>
      )}

      {drill && report && (
        <PendingDrillDrawer
          pending={report.pending}
          asOn={report.as_on_date}
          initial={drill}
          onClose={() => setDrill(null)}
          onOpenTask={openTask}
        />
      )}
    </div>
  )
}

// ─── Small building blocks ─────────────────────────────────────────────────────---

function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2 flex-wrap">{children}</div>
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative flex-1 min-w-[220px]">
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-[8px] border border-[#CBD5E1] bg-white pl-9 pr-3 py-2.5 text-[15px] text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
      />
    </div>
  )
}

function GridCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden">
      <div className="overflow-x-auto">{children}</div>
    </div>
  )
}

function SortHead({
  sort, id, children, center, className = '', title,
}: {
  sort: { sortKey: string; dir: 'asc' | 'desc'; toggle: (k: string) => void }
  id: string; children: React.ReactNode; center?: boolean; className?: string; title?: string
}) {
  const active = sort.sortKey === id
  return (
    <th className={`py-3 font-semibold ${center ? 'text-center px-3' : 'px-3'} ${className}`} title={title}>
      <button onClick={() => sort.toggle(id)} className={`inline-flex items-center gap-1 hover:text-[#0F172A] transition-colors ${center ? 'justify-center' : ''}`}>
        {children}
        <ArrowUpDown size={12} className={active ? 'text-[#2563EB]' : 'text-[#CBD5E1]'} />
      </button>
    </th>
  )
}

function CountCell({ value, onClick, color, bold }: { value: number; onClick: () => void; color: string; bold?: boolean }) {
  if (value === 0) return <td className="px-3 py-3 text-center tabular-nums text-[#CBD5E1]">0</td>
  return (
    <td className="px-3 py-3 text-center tabular-nums">
      <button onClick={onClick} className={`hover:underline underline-offset-2 tabular-nums ${bold ? 'font-bold' : 'font-semibold'}`} style={{ color }} title="See these tasks">
        {value.toLocaleString()}
      </button>
    </td>
  )
}

function BandCells({ b, onDrill }: { b: AgeBuckets; onDrill: (buckets: AgeBucketKey[] | null, label: string | null) => void }) {
  return (
    <>
      {BUCKETS.map((meta) => (
        <CountCell key={meta.key} value={b[meta.key]} color={countColor(meta.key, b[meta.key])} onClick={() => onDrill([meta.key], meta.label)} />
      ))}
      <CountCell value={b.total_pending} color="#0F172A" bold onClick={() => onDrill(null, null)} />
      <CountCell value={b.over_month_late} color={b.over_month_late ? '#DC2626' : '#CBD5E1'} bold onClick={() => onDrill(OVER_MONTH_BUCKETS, 'More than a Month Late')} />
      <td className="px-3 py-3 text-center tabular-nums text-[#475569]">{b.oldest_late_days ?? '—'}</td>
      <td className="px-3 py-3 text-center tabular-nums text-[#475569]">{b.avg_late_days ?? '—'}</td>
      {/* Clickable like every other count: it passes the 'withdrawn' bucket explicitly,
          which is the only way withdrawn rows are reachable in the drawer — so this
          count and the rows it opens match exactly, same as the age bands. */}
      <CountCell
        value={b.withdrawn}
        color={countColor('withdrawn', b.withdrawn)}
        onClick={() => onDrill(['withdrawn'], WITHDRAWN_META.label)}
      />
      {/* Same contract: reachable only by clicking its own count, so this number and
          the rows it opens match exactly. Never part of Total Pending. */}
      <CountCell
        value={b.handed_over}
        color={b.handed_over ? '#475569' : '#CBD5E1'}
        onClick={() => onDrill(['handed_over'], 'Handed over to someone else')}
      />
      {/* Not click-through: `revised_entries` cuts ACROSS the buckets (a revised task is
          still in whichever band it belongs to), so it is not a filter dimension the
          drawer can honour without breaking count === rows. Read-only flag. */}
      <td className="px-3 py-3 text-center tabular-nums" style={{ color: b.revised_entries ? '#B45309' : '#CBD5E1' }}>
        {b.revised_entries.toLocaleString()}
      </td>
    </>
  )
}

function TotalsFoot({ label, totals, leadCols }: { label: string; totals: AgeBuckets; leadCols: number }) {
  return (
    <tfoot>
      <tr className="bg-[#F8FAFC] border-t-2 border-[#E2E8F0] font-semibold text-[#0F172A] whitespace-nowrap">
        <td className="px-4 py-3 sticky left-0 bg-[#F8FAFC] z-10">{label}</td>
        {Array.from({ length: leadCols - 1 }).map((_, i) => <td key={i} className="px-3 py-3" />)}
        {BUCKETS.map((meta) => <td key={meta.key} className="px-3 py-3 text-center tabular-nums">{totals[meta.key].toLocaleString()}</td>)}
        <td className="px-3 py-3 text-center tabular-nums">{totals.total_pending.toLocaleString()}</td>
        <td className="px-3 py-3 text-center tabular-nums" style={{ color: totals.over_month_late ? '#DC2626' : '#0F172A' }}>{totals.over_month_late.toLocaleString()}</td>
        <td className="px-3 py-3 text-center tabular-nums">{totals.oldest_late_days ?? '—'}</td>
        <td className="px-3 py-3 text-center tabular-nums">{totals.avg_late_days ?? '—'}</td>
        {/* Withdrawn is its own total — never folded into Total Pending or a band. */}
        <td className="px-3 py-3 text-center tabular-nums">{totals.withdrawn.toLocaleString()}</td>
        <td className="px-3 py-3 text-center tabular-nums">{totals.handed_over.toLocaleString()}</td>
        <td className="px-3 py-3 text-center tabular-nums">{totals.revised_entries.toLocaleString()}</td>
      </tr>
    </tfoot>
  )
}

function EmptyRow({ span }: { span: number }) {
  return <tr><td colSpan={span} className="px-4 py-12 text-center text-[#94A3B8]"><Inbox size={22} className="mx-auto mb-2" />No rows match your filters.</td></tr>
}
