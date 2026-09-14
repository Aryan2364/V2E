'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { reportsApi } from '@/lib/api/reports'
import { getDepartments } from '@/lib/api/departments'
import type { Department } from '@/lib/types'
import type { CalendarReport, CalendarRow, CalendarCell, ScorecardScope } from '@/lib/types/reports'
import type { WorkScope } from '@/lib/types/tasks'
import ScopeSwitcher from '@/components/tasks/overview/ScopeSwitcher'
import DepartmentMultiSelect from '@/components/employees/DepartmentMultiSelect'
import StyledSelect from '@/components/ui/StyledSelect'
import { exportCalendarXlsx } from '@/lib/reports/calendar-export'
import { RESULT_META, RESULT_ORDER, fmtDate, fmtAsOn, shiftMonth } from '@/lib/reports/calendar-format'
import { ArrowLeft, Search, Download, Lock, CalendarClock, ChevronLeft, ChevronRight, Inbox } from 'lucide-react'

type ResultFilter = 'all' | 'missed' | 'late' | 'clean'
const STATE_KEY = 'calendar-report-state-v1'

interface PersistState {
  month: string; search: string; deptIds: string[]; freq: string; result: ResultFilter; scrollTop: number; gridScroll: number
}

export default function CalendarReportPage() {
  const { user } = useAuth()
  const router = useRouter()
  const orgId = user?.organizationId ?? ''

  const restored = useRef<PersistState | null>(null)
  if (restored.current === null && typeof window !== 'undefined') {
    try { const raw = sessionStorage.getItem(STATE_KEY); restored.current = raw ? JSON.parse(raw) : ({} as PersistState) }
    catch { restored.current = {} as PersistState }
  }
  const r0 = restored.current ?? ({} as PersistState)

  const [requestedScope, setRequestedScope] = useState<ScorecardScope | undefined>(undefined)
  const [month, setMonth] = useState<string>(r0.month ?? '')
  const [report, setReport] = useState<CalendarReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [departments, setDepartments] = useState<Department[]>([])

  const [search, setSearch] = useState(r0.search ?? '')
  const [deptIds, setDeptIds] = useState<string[]>(r0.deptIds ?? [])
  const [freq, setFreq] = useState(r0.freq ?? 'all')
  const [result, setResult] = useState<ResultFilter>(r0.result ?? 'all')

  const gridRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    setLoading(true)
    reportsApi
      .getTaskCalendar(orgId, month || undefined, requestedScope)
      .then((res) => { if (!cancelled) { setReport(res); if (!month) setMonth(res.month) } })
      .catch(() => { if (!cancelled) setReport(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [orgId, month, requestedScope])

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    getDepartments(orgId).then((d) => { if (!cancelled) setDepartments(d) }).catch(() => { if (!cancelled) setDepartments([]) })
    return () => { cancelled = true }
  }, [orgId])

  // Restore scroll once data is on screen.
  useEffect(() => {
    if (loading || !report || !restored.current) return
    const { scrollTop, gridScroll } = restored.current
    if (scrollTop) requestAnimationFrame(() => window.scrollTo(0, scrollTop))
    if (gridScroll && gridRef.current) requestAnimationFrame(() => { if (gridRef.current) gridRef.current.scrollLeft = gridScroll })
    restored.current = null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, report])

  const persist = () => {
    try {
      const s: PersistState = { month, search, deptIds, freq, result, scrollTop: window.scrollY, gridScroll: gridRef.current?.scrollLeft ?? 0 }
      sessionStorage.setItem(STATE_KEY, JSON.stringify(s))
    } catch { /* ignore */ }
  }
  const openTask = (taskId: string) => { persist(); router.push(`/dashboard/tasks/${taskId}`) }

  const deptNames = useMemo(() => {
    if (deptIds.length === 0) return null
    const byId = new Map(departments.map((d) => [d.id, d.name]))
    return new Set(deptIds.map((id) => byId.get(id)).filter(Boolean) as string[])
  }, [deptIds, departments])

  const rows = useMemo(() => {
    if (!report) return []
    const q = search.trim().toLowerCase()
    return report.rows.filter((r) => {
      if (deptNames && !(r.department && deptNames.has(r.department))) return false
      if (freq !== 'all' && r.frequency !== freq) return false
      if (result === 'missed' && r.missed === 0) return false
      if (result === 'late' && r.late === 0) return false
      if (result === 'clean' && !(r.missed === 0 && r.late === 0 && r.scheduled > 0)) return false
      if (q && !r.title.toLowerCase().includes(q) && !r.person.toLowerCase().includes(q)) return false
      return true
    })
  }, [report, search, deptNames, freq, result])

  async function download() {
    if (!report || downloading) return
    setDownloading(true)
    try { await exportCalendarXlsx(report, `monthly-task-compliance-${report.month}`) }
    finally { setDownloading(false) }
  }

  const freqOptions = useMemo(
    () => [{ value: 'all', label: 'All frequencies' }, ...((report?.frequencies ?? []).map((f) => ({ value: f, label: f })))],
    [report],
  )
  const resultOptions = [
    { value: 'all', label: 'All rows' },
    { value: 'missed', label: 'Has missed' },
    { value: 'late', label: 'Has late' },
    { value: 'clean', label: 'Clean (no late / missed)' },
  ]

  // Cell lookup per row: worst mark per day.
  const marksOf = (row: CalendarRow) => {
    const m = new Map<number, CalendarCell>()
    for (const c of row.cells) if (!m.has(c.day)) m.set(c.day, c)
    return m
  }

  const t = report?.totals
  const onTimePct = t && t.on_time + t.late + t.missed > 0 ? Math.round((t.on_time / (t.on_time + t.late + t.missed)) * 100) : null

  return (
    <div className="space-y-5">
      <button onClick={() => router.push('/dashboard/tasks/reports-new')} className="inline-flex items-center gap-1.5 text-sm text-[#475569] hover:text-[#0F172A] transition-colors">
        <ArrowLeft size={15} /> Reports
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold text-[#0F172A] leading-tight">Monthly Task Compliance Calendar</h1>
          <p className="mt-1 text-[15px] text-[#475569]">
            One row per task and person, one square per day — green done on time, amber late, red missed, white not due yet.
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
            onClick={download}
            disabled={downloading || !report || report.rows.length === 0}
            className="flex items-center gap-1.5 px-3.5 py-[7px] bg-[#2563EB] text-white rounded-[8px] text-sm font-semibold hover:bg-[#1D4ED8] disabled:opacity-60 transition-colors"
          >
            <Download size={15} /> {downloading ? 'Preparing…' : 'Download'}
          </button>
        </div>
      </div>

      {/* Month switcher + legend */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-1.5">
          <button onClick={() => month && setMonth(shiftMonth(month, -1))} disabled={!month} className="w-9 h-9 rounded-[8px] border border-[#CBD5E1] flex items-center justify-center text-[#475569] hover:bg-[#F1F5F9] disabled:opacity-50" title="Previous month"><ChevronLeft size={17} /></button>
          <div className="px-3 min-w-[150px] text-center text-[15px] font-bold text-[#0F172A]">{report?.month_label ?? '—'}</div>
          <button onClick={() => month && setMonth(shiftMonth(month, 1))} disabled={!month} className="w-9 h-9 rounded-[8px] border border-[#CBD5E1] flex items-center justify-center text-[#475569] hover:bg-[#F1F5F9] disabled:opacity-50" title="Next month"><ChevronRight size={17} /></button>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {RESULT_ORDER.map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5 text-xs font-medium text-[#475569]">
              <span className="w-5 h-5 rounded-[5px] flex items-center justify-center text-[11px] font-bold" style={{ backgroundColor: RESULT_META[k].bg, color: RESULT_META[k].fg, border: `1px solid ${RESULT_META[k].border}` }}>{RESULT_META[k].code}</span>
              {RESULT_META[k].label}
            </span>
          ))}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search task or person…" className="w-full rounded-[8px] border border-[#CBD5E1] bg-white pl-9 pr-3 py-2.5 text-[15px] text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]" />
        </div>
        <div className="w-[210px]"><DepartmentMultiSelect selected={deptIds} onChange={setDeptIds} departments={departments} allLabel="All departments" /></div>
        <div className="w-[180px]"><StyledSelect value={freq} onChange={setFreq} options={freqOptions} /></div>
        <div className="w-[210px]"><StyledSelect value={result} onChange={(v) => setResult(v as ResultFilter)} options={resultOptions} /></div>
      </div>

      {/* Totals strip */}
      {t && report && report.rows.length > 0 && (
        <div className="flex gap-6 flex-wrap bg-white border border-[#E2E8F0] rounded-[12px] px-5 py-3">
          <Stat label="Task · person rows" value={t.rows} />
          <Stat label="Scheduled" value={t.scheduled} />
          <Stat label="Done on time" value={t.on_time} color="#166534" />
          <Stat label="Done late" value={t.late} color="#92400E" />
          <Stat label="Missed" value={t.missed} color={t.missed ? '#991B1B' : '#94A3B8'} />
          <Stat label="Brought forward" value={t.brought_forward} color={t.brought_forward ? '#991B1B' : '#94A3B8'} />
          {/* Own tiles, never folded into Scheduled or a verdict: Withdrawn = removed
              before the original due date (no verdict earned or owed); Revised = due
              dates that were moved, which the marks were NOT graded against. */}
          {t.withdrawn > 0 && <Stat label="Withdrawn" value={t.withdrawn} color="#64748B" />}
          {t.handed_over > 0 && <Stat label="Handed over" value={t.handed_over} color="#475569" />}
          {t.revised_entries > 0 && <Stat label="Due date revised" value={t.revised_entries} color="#B45309" />}
          <Stat label="On-time rate" value={onTimePct === null ? '—' : `${onTimePct}%`} color={onTimePct === null ? '#94A3B8' : onTimePct >= 60 ? '#166534' : onTimePct >= 30 ? '#92400E' : '#991B1B'} />
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-48"><div className="w-7 h-7 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" /></div>
      ) : !report || report.rows.length === 0 ? (
        <div className="bg-white border border-[#E2E8F0] rounded-[12px] py-16 flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-full bg-[#EFF6FF] flex items-center justify-center mb-4">{report ? <CalendarClock size={24} className="text-[#2563EB]" /> : <Lock size={24} className="text-[#DC2626]" />}</div>
          <p className="font-semibold text-[#0F172A]">{report ? 'Nothing scheduled this month' : 'No access'}</p>
          <p className="text-sm text-[#475569] mt-1 max-w-sm">{report ? 'No task fell due in this month for anyone in your scope. Try another month.' : 'You can only see the calendar for people within your visibility.'}</p>
        </div>
      ) : (
        <div className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden">
          <div ref={gridRef} className="overflow-x-auto">
            <table className="text-sm border-collapse w-max">
              <thead>
                <tr className="bg-[#F8FAFC] text-[#475569] text-left whitespace-nowrap">
                  <th className="px-3 py-2.5 font-semibold sticky left-0 bg-[#F8FAFC] z-20 w-[264px] border border-[#CBD5E1] shadow-[1px_0_0_#CBD5E1]">Task · Person</th>
                  <th className="px-2 py-2.5 font-semibold text-center bg-[#F8FAFC] border border-[#CBD5E1]" title="Earlier occurrences still open coming into the month">BF</th>
                  {report.days.map((d) => (
                    <th key={d.day} className={`px-0 py-2 font-semibold text-center w-8 border border-[#CBD5E1] ${d.weekend ? 'bg-[#E8EDF3]' : ''}`}>
                      <div className="text-[12px] leading-none">{d.day}</div>
                      <div className="text-[10px] text-[#94A3B8] leading-tight mt-0.5">{d.dow}</div>
                    </th>
                  ))}
                  <th className="px-2 py-2.5 font-semibold text-center bg-[#F8FAFC] border border-[#CBD5E1]" title="Scheduled this month">Sch</th>
                  <th className="px-2 py-2.5 font-semibold text-center bg-[#F8FAFC] border border-[#CBD5E1]" title="Done on time">D</th>
                  <th className="px-2 py-2.5 font-semibold text-center bg-[#F8FAFC] border border-[#CBD5E1]" title="Done late">L</th>
                  <th className="px-2 py-2.5 font-semibold text-center bg-[#F8FAFC] border border-[#CBD5E1]" title="Missed">X</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const marks = marksOf(row)
                  return (
                    <tr key={`${row.title}:${row.user_id}`} className="group hover:bg-[#F8FAFC] transition-colors">
                      <td className="px-3 py-2 sticky left-0 bg-white group-hover:bg-[#F8FAFC] z-10 w-[264px] border border-[#CBD5E1] shadow-[1px_0_0_#CBD5E1]">
                        <div className="w-[240px]">
                          <p className="font-semibold text-[#0F172A] truncate leading-tight" title={row.title}>{row.title}</p>
                          <p className="text-[12px] text-[#64748B] truncate">{row.person} · {row.frequency}</p>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-center tabular-nums border border-[#CBD5E1]" style={{ color: row.brought_forward ? '#B91C1C' : '#CBD5E1' }}>{row.brought_forward || ''}</td>
                      {report.days.map((d) => {
                        const c = marks.get(d.day)
                        // Not scheduled that day → grey "not applicable" cell.
                        if (!c) return <td key={d.day} className="w-8 h-8 border border-[#CBD5E1] bg-[#EEF1F5]" />
                        const meta = RESULT_META[c.result]
                        const tip = `${row.title} — ${row.person}\n${fmtDate(c.due_date)} · ${meta.label}${c.completion_date ? ` · done ${fmtDate(c.completion_date)}` : ''}`
                        return (
                          <td key={d.day} className="w-8 h-8 p-0 border border-[#CBD5E1]" style={{ backgroundColor: meta.bg }}>
                            <button
                              onClick={() => openTask(c.task_id)}
                              title={tip}
                              className="w-full h-full text-[11px] font-bold flex items-center justify-center hover:ring-2 hover:ring-inset hover:ring-[#2563EB] transition-all"
                              style={{ color: meta.fg }}
                            >
                              {meta.code}
                            </button>
                          </td>
                        )
                      })}
                      <td className="px-2 py-2 text-center font-semibold tabular-nums text-[#0F172A] border border-[#CBD5E1]">{row.scheduled}</td>
                      <td className="px-2 py-2 text-center tabular-nums border border-[#CBD5E1]" style={{ color: row.on_time ? '#166534' : '#CBD5E1' }}>{row.on_time || ''}</td>
                      <td className="px-2 py-2 text-center tabular-nums border border-[#CBD5E1]" style={{ color: row.late ? '#92400E' : '#CBD5E1' }}>{row.late || ''}</td>
                      <td className="px-2 py-2 text-center tabular-nums border border-[#CBD5E1]" style={{ color: row.missed ? '#991B1B' : '#CBD5E1' }}>{row.missed || ''}</td>
                    </tr>
                  )
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={report.days.length + 6} className="px-4 py-12 text-center text-[#94A3B8]"><Inbox size={22} className="mx-auto mb-2" />No rows match your filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {report && report.rows.length > 0 && (
        <p className="text-xs text-[#94A3B8]">Showing {rows.length.toLocaleString()} of {report.rows.length.toLocaleString()} task·person rows. Click any square to open that task.</p>
      )}
    </div>
  )
}

function Stat({ label, value, color = '#0F172A' }: { label: string; value: number | string; color?: string }) {
  return (
    <div>
      <div className="text-lg font-bold tabular-nums leading-none" style={{ color }}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
      <div className="text-xs mt-1 text-[#94A3B8]">{label}</div>
    </div>
  )
}
