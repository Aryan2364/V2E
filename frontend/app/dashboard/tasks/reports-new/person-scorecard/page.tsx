'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { formatNumber } from '@/lib/format'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { reportsApi } from '@/lib/api/reports'
import type { RosterItem, ScorecardScope, ScorecardTotals, ScorecardGrade } from '@/lib/types/reports'
import { GradePill } from '@/components/reports/GradePill'
import type { WorkScope } from '@/lib/types/tasks'
import ScopeSwitcher from '@/components/tasks/overview/ScopeSwitcher'
import DepartmentMultiSelect from '@/components/employees/DepartmentMultiSelect'
import { getDepartments } from '@/lib/api/departments'
import type { Department } from '@/lib/types'
import DateRangePicker from '@/components/ui/DateRangePicker'
import { exportScorecardsXlsx } from '@/lib/reports/scorecard-export'
import { Search, Download, ChevronRight, UserSquare2, Lock } from 'lucide-react'
import { PageHeader } from '@/components/shell/page-header'
import { Button } from '@/components/ui/button'

function initials(name: string) {
  return name.split(' ').filter(Boolean).map((n) => n[0]).join('').slice(0, 2).toUpperCase() || '?'
}

function windowLabel(from: string, to: string) {
  if (!from && !to) return 'All time'
  return `${from || '…'} → ${to || '…'}`
}

const pct = (v: number | null) => (v === null || v === undefined ? '—' : `${v}%`)
const num = (v: number | null) => (v === null || v === undefined ? '—' : formatNumber(v))
const onTimeColor = (v: number | null) =>
  v === null ? 'var(--text-muted)' : v >= 60 ? 'var(--success)' : v >= 30 ? 'var(--success)' : v >= 15 ? 'var(--warning)' : 'var(--danger)'

export default function ScorecardRosterPage() {
  const { user } = useAuth()
  const router = useRouter()
  const orgId = user?.organizationId ?? ''

  const [requestedScope, setRequestedScope] = useState<ScorecardScope | undefined>(undefined)
  const [people, setPeople] = useState<RosterItem[]>([])
  const [totals, setTotals] = useState<ScorecardTotals | null>(null)
  const [appliedScope, setAppliedScope] = useState<ScorecardScope | null>(null)
  const [maxScope, setMaxScope] = useState<ScorecardScope | null>(null)
  const [loading, setLoading] = useState(true)
  const [redirecting, setRedirecting] = useState(false)

  const [search, setSearch] = useState('')
  const [departments, setDepartments] = useState<Department[]>([])
  const [selectedDeptIds, setSelectedDeptIds] = useState<string[]>([])
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    setLoading(true)
    reportsApi
      .getScorecardRoster(orgId, requestedScope)
      .then((res) => {
        if (cancelled) return
        setAppliedScope(res.applied_scope)
        setMaxScope(res.max_scope)
        // Self-only viewer: skip the one-row roster, land straight on their own card.
        // `replace` keeps the browser Back going to the Reports index, not a loop back here.
        if (res.applied_scope === 'own' && user?.id) {
          setRedirecting(true)
          router.replace(`/dashboard/tasks/reports-new/person-scorecard/${user.id}`)
          return
        }
        setPeople(res.people)
        setTotals(res.totals)
      })
      .catch(() => { if (!cancelled) { setPeople([]); setTotals(null) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [orgId, requestedScope, router, user?.id])

  // Department tree for the multi-select filter (cascades parent → sub-departments).
  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    getDepartments(orgId)
      .then((d) => { if (!cancelled) setDepartments(d) })
      .catch(() => { if (!cancelled) setDepartments([]) })
    return () => { cancelled = true }
  }, [orgId])

  // Selected department ids → the set of their names (the roster carries names only).
  const selectedDeptNames = useMemo(() => {
    if (selectedDeptIds.length === 0) return null
    const nameById = new Map(departments.map((d) => [d.id, d.name]))
    return new Set(selectedDeptIds.map((id) => nameById.get(id)).filter(Boolean) as string[])
  }, [selectedDeptIds, departments])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return people.filter((p) => {
      if (selectedDeptNames && !(p.department_name && selectedDeptNames.has(p.department_name))) return false
      if (q && !p.name.toLowerCase().includes(q) && !(p.role_title ?? '').toLowerCase().includes(q)) return false
      return true
    })
  }, [people, search, selectedDeptNames])

  async function downloadAll() {
    if (downloading) return
    setDownloading(true)
    try {
      const res = await reportsApi.getAllScorecards(orgId, appliedScope ?? undefined, {
        from_date: fromDate || undefined,
        to_date: toDate ? `${toDate}T23:59:59` : undefined,
      })
      await exportScorecardsXlsx(res.cards, `person-scorecards-${appliedScope ?? 'scope'}`, windowLabel(fromDate, toDate))
    } finally {
      setDownloading(false)
    }
  }

  if (redirecting) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Person Scorecard"
        trail={[{ label: 'Tasks', href: '/dashboard/tasks' }, { label: 'Reports', href: '/dashboard/tasks/reports-new' }]}
        meta="Open a person to see their unique tasks and performance — or download everyone you can see."
        actions={
          <div className="flex items-center gap-2 shrink-0">
            <ScopeSwitcher
              maxScope={(maxScope as WorkScope) ?? null}
              value={(appliedScope as WorkScope) ?? 'own'}
              onChange={(s) => setRequestedScope(s as ScorecardScope)}
            />
            <Button onClick={downloadAll} disabled={downloading || filtered.length === 0}>
              <Download size={15} /> {downloading ? 'Preparing…' : 'Download all'}
            </Button>
          </div>
        }
      />

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search people…"
            className="w-full rounded-control border border-border bg-surface pl-8 pr-3 py-2.5 text-body text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="w-[230px]">
          <DepartmentMultiSelect selected={selectedDeptIds} onChange={setSelectedDeptIds} departments={departments} allLabel="All departments" />
        </div>
        <DateRangePicker from={fromDate} to={toDate} onChange={(f, t) => { setFromDate(f); setToDate(t) }} placeholder="Performance window (for download)" />
      </div>

      {/* Roster */}
      {loading ? (
        <div className="flex items-center justify-center h-48"><div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : people.length === 0 ? (
        <div className="bg-surface border border-border-light rounded-card py-12 flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-full bg-danger-bg flex items-center justify-center mb-4"><Lock size={24} className="text-danger" /></div>
          <p className="font-medium text-text-primary">No people in your scope</p>
          <p className="text-body text-text-secondary mt-1 max-w-sm">You can only see scorecards for people within your visibility.</p>
        </div>
      ) : (
        <div className="bg-surface border border-border-light rounded-card shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr className="bg-surface-sunken border-b border-border-light text-text-secondary text-left whitespace-nowrap">
                  <th className="px-4 py-3 font-medium sticky left-0 bg-surface-sunken">Person</th>
                  <th className="px-3 py-3 font-medium text-center" title="How many different task names this person is responsible for — their real scope of work.">Different tasks</th>
                  <th className="px-3 py-3 font-medium text-center" title="Every time those tasks came up in the period (each recurring occurrence + each one-time task).">Total entries</th>
                  <th className="px-3 py-3 font-medium text-center">Completed</th>
                  <th className="px-3 py-3 font-medium text-center" title="Not yet closed — overdue or still ongoing.">Pending</th>
                  <th className="px-3 py-3 font-medium text-center" title="Tasks completed ÷ total entries.">Completion</th>
                  <th className="px-3 py-3 font-medium text-center" title="Completed on or before the due date.">On&nbsp;time</th>
                  <th className="px-3 py-3 font-medium text-center" title="On-time tasks ÷ tasks that have a completion date. Pending work is kept out. This is the real score.">On-time&nbsp;rate</th>
                  <th className="px-3 py-3 font-medium text-center" title="Average of (completion date − due date). Minus means finished early.">Avg delay</th>
                  <th className="px-3 py-3 font-medium text-center" title="The single worst delay for this person.">Longest Delay</th>
                  <th className="px-3 py-3 font-medium">Grade</th>
                  {/* Appended after Grade so the client's signed-off column order is intact. */}
                  <th className="px-3 py-3 font-medium text-center" title="Tasks this person was taken off BEFORE the original due date without finishing. They were released in good standing, so these are left out of every figure above — including Total entries and the Grade — and shown here only so the removal is visible.">Withdrawn</th>
                  <th className="px-3 py-3 font-medium text-center" title="Tasks that were ALREADY LATE when this person was taken off and they were given to someone else. The delay stays on their record (counted in Total entries), frozen at the day they handed it over — but it is NOT counted as pending or overdue, because the work is no longer theirs to finish. Open the person to see who holds each one now.">Handed over</th>
                  <th className="px-3 py-3 font-medium text-center" title="Tasks whose due date has been changed at least once. Every on-time / late / delay figure is measured against the ORIGINAL due date, so moving a deadline cannot turn a late task on time.">Revised</th>
                  <th className="px-3 py-3 w-8" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr
                    key={p.user_id}
                    onClick={() => router.push(`/dashboard/tasks/reports-new/person-scorecard/${p.user_id}`)}
                    className="group border-b border-border-light last:border-0 hover:bg-surface-sunken cursor-pointer transition-colors whitespace-nowrap"
                  >
                    <td className="px-4 py-3 sticky left-0 bg-surface group-hover:bg-surface-sunken">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-primary text-primary-foreground text-meta font-medium flex items-center justify-center shrink-0">{initials(p.name)}</div>
                        <div className="min-w-0">
                          <p className="font-medium text-text-primary truncate">{p.name}</p>
                          {p.role_title && <p className="text-meta text-text-muted truncate">{p.role_title}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center font-medium text-text-secondary tabular-nums">{p.different_tasks}</td>
                    <td className="px-3 py-3 text-center font-medium text-text-primary tabular-nums">{num(p.total_given)}</td>
                    <td className="px-3 py-3 text-center text-text-secondary tabular-nums">{num(p.completed)}</td>
                    <td className="px-3 py-3 text-center tabular-nums" style={{ color: p.pending > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>{num(p.pending)}</td>
                    <td className="px-3 py-3 text-center text-text-secondary tabular-nums">{pct(p.completion_pct)}</td>
                    <td className="px-3 py-3 text-center text-text-secondary tabular-nums">{num(p.completed_on_time)}</td>
                    <td className="px-3 py-3 text-center tabular-nums font-medium" style={{ color: onTimeColor(p.on_time_pct) }}>{pct(p.on_time_pct)}</td>
                    <td className="px-3 py-3 text-center text-text-secondary tabular-nums">{p.avg_delay_days ?? '—'}</td>
                    <td className="px-3 py-3 text-center text-text-secondary tabular-nums">{p.longest_delay_days ?? '—'}</td>
                    <td className="px-3 py-3"><GradePill grade={p.grade} /></td>
                    <td className="px-3 py-3 text-center tabular-nums" style={{ color: p.withdrawn ? 'var(--text-muted)' : 'var(--border)' }}>{num(p.withdrawn)}</td>
                    <td className="px-3 py-3 text-center tabular-nums" style={{ color: p.handed_over ? 'var(--text-secondary)' : 'var(--border)' }}>{num(p.handed_over)}</td>
                    <td className="px-3 py-3 text-center tabular-nums" style={{ color: p.revised_entries ? 'var(--warning)' : 'var(--border)' }}>{num(p.revised_entries)}</td>
                    <td className="px-3 py-3 text-right"><ChevronRight size={16} className="text-text-muted" /></td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={14} className="px-4 py-8 text-center text-text-muted"><UserSquare2 size={22} className="mx-auto mb-2" />No people match your search.</td></tr>
                )}
              </tbody>
              {totals && filtered.length > 0 && selectedDeptIds.length === 0 && !search.trim() && (
                <tfoot>
                  <tr className="bg-surface-sunken border-t-2 border-border-light font-medium text-text-primary whitespace-nowrap">
                    <td className="px-4 py-3 sticky left-0 bg-surface-sunken">Total / Overall <span className="text-text-muted font-normal">· {people.length} people</span></td>
                    <td className="px-3 py-3 text-center tabular-nums">{totals.different_tasks}</td>
                    <td className="px-3 py-3 text-center tabular-nums">{num(totals.total_given)}</td>
                    <td className="px-3 py-3 text-center tabular-nums">{num(totals.completed)}</td>
                    <td className="px-3 py-3 text-center tabular-nums">{num(totals.pending)}</td>
                    <td className="px-3 py-3 text-center tabular-nums">{pct(totals.completion_pct)}</td>
                    <td className="px-3 py-3 text-center tabular-nums">{num(totals.completed_on_time)}</td>
                    <td className="px-3 py-3 text-center tabular-nums" style={{ color: onTimeColor(totals.on_time_pct) }}>{pct(totals.on_time_pct)}</td>
                    <td className="px-3 py-3 text-center tabular-nums">{totals.avg_delay_days ?? '—'}</td>
                    <td className="px-3 py-3 text-center tabular-nums">{totals.longest_delay_days ?? '—'}</td>
                    <td className="px-3 py-3" />
                    {/* Withdrawn is its own total — not folded into Total entries / Completed / On time. */}
                    <td className="px-3 py-3 text-center tabular-nums">{num(totals.withdrawn)}</td>
                    <td className="px-3 py-3 text-center tabular-nums">{num(totals.handed_over)}</td>
                    <td className="px-3 py-3 text-center tabular-nums">{num(totals.revised_entries)}</td>
                    <td className="px-3 py-3" />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
