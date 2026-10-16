'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { reportsApi } from '@/lib/api/reports'
import type { Scorecard, TaskEntryRow } from '@/lib/types/reports'
import DateRangePicker from '@/components/ui/DateRangePicker'
import { exportScorecardsXlsx } from '@/lib/reports/scorecard-export'
import { GradePill } from '@/components/reports/GradePill'
import { DateStatusTag } from '@/components/reports/DateStatusTag'
import {
  INK, MUTE, RED,
  daysLatePhrase, daysLateShort, gradeReason,
  completionColor, onTimeColor, completedDelayColor, pendingAgeColor,
} from '@/lib/reports/scorecard-format'
import { Download, Lock, RotateCcw, ListChecks, AlertTriangle, ChevronRight, ChevronDown } from 'lucide-react'
import { PageHeader } from '@/components/shell/page-header'
import { Button } from '@/components/ui/button'
import { formatDate, formatNumber } from '@/lib/format'

function fmt(iso: string | null) {
  if (!iso) return '—'
  return formatDate(iso) || '—'
}

function windowLabel(from: string, to: string) {
  if (!from && !to) return 'All time'
  return `${from || '…'} → ${to || '…'}`
}

// Work this person no longer holds is NOT pending on them — whether they were taken
// off before it came due (withdrawn) or after (handed over). `date_status` is already
// 'handed_over' for both, so one check covers it, and the per-task group tallies stay
// in step with the KPI tiles above, which exclude released work the same way.
//
// This is the reading that matters: a row sitting under someone's name in a Pending
// list is an instruction to go and chase them. If they handed the task on weeks ago,
// that instruction is wrong and wastes a phone call to find out.
const isPending = (e: TaskEntryRow) =>
  e.date_status === 'overdue' || e.date_status === 'in_progress' || e.date_status === 'not_yet_due'

/** The Days Late cell text, respecting where the task stands today. */
function daysLateCell(e: TaskEntryRow): string {
  // Released work reports the lateness it HAD when it left them, never a number that
  // keeps climbing afterwards. Withdrawn carries none at all (they were let go in good
  // standing); a handover carries the frozen figure, clearly labelled as historic.
  if (e.date_status === 'handed_over') {
    const d = e.handover?.days_late_at_handover
    return d != null && d > 0 ? `${d} at handover` : '—'
  }
  if (e.date_status === 'not_yet_due' || e.date_status === 'in_progress') return 'Not Yet Due'
  if (e.date_status === 'closed') return '—'
  return daysLateShort(e.days_late)
}

/**
 * The "was this goalpost moved?" note under a due date. The date above it is the LIVE
 * one (what is expected now); the on-time / delay columns beside it were measured
 * against the original. Saying both is the whole point — a silent live date would let
 * a revision explain away a late mark.
 */
function DueDateNote({ e }: { e: TaskEntryRow }) {
  if (e.deadline_revision_count === 0) return null
  return (
    <span className="block text-[11px] font-medium text-warning" title={`Graded against the original due date, ${fmt(e.original_deadline)}`}>
      revised {e.deadline_revision_count}× · was {fmt(e.original_deadline)}
    </span>
  )
}

/**
 * Standing for an entry the person no longer holds.
 *
 * Always names who has it now. A tag that only said "Withdrawn" told the reader the
 * work had moved but not where, which is a dead end — they would go back to the person
 * on the row, be told it was reassigned, and still have nobody to ask.
 */
function WithdrawnTag({ e }: { e: TaskEntryRow }) {
  const to = e.handover?.to?.length ? e.handover.to.join(', ') : 'no one'
  const late = e.handover?.days_late_at_handover
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium bg-surface-control text-text-secondary"
      title={
        `Taken off this task on ${fmt(e.handover?.at ?? null)}` +
        (e.is_withdrawn
          ? ', before it came due — kept out of every figure above'
          : late != null && late > 0
            ? `, already ${late} ${late === 1 ? 'day' : 'days'} late. That delay stays on their record, frozen at the handover; it is not pending on them any more.`
            : '') +
        ` Now with ${to}.`
      }
    >
      {e.is_withdrawn ? 'Withdrawn' : late != null && late > 0 ? `Was ${late} ${late === 1 ? 'day' : 'days'} late` : 'Handed over'}
      <span className="font-normal">· now with {to}</span>
    </span>
  )
}

/** A plain KPI count / rate tile. Colour is passed in only when it carries meaning. */
function Tile({ label, value, accent = INK, sub }: { label: string; value: React.ReactNode; accent?: string; sub?: string }) {
  return (
    <div className="bg-surface border border-border-light rounded-card shadow-card p-4">
      <p className="text-[12px] font-medium text-text-muted uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-[22px] font-medium tabular-nums leading-tight" style={{ color: accent }}>{value}</p>
      {sub && <p className="mt-0.5 text-[12px] text-text-muted">{sub}</p>}
    </div>
  )
}

/** A timing figure shown in full words: "10.4 days late", "3 days early", "—". */
function TimingFigure({ label, days, color, olderIsWorse = true }: { label: string; days: number | null; color: string; olderIsWorse?: boolean }) {
  const phrase = days === null ? 'No data yet' : olderIsWorse && days === 0 ? 'On the due date' : daysLatePhrase(days)
  const big = days === null ? '—' : `${Math.abs(days)}`
  const unit = days === null ? '' : days < 0 ? 'days early' : days === 0 ? '' : 'days late'
  return (
    <div className="flex-1 min-w-[150px]">
      <p className="text-[12px] font-medium text-text-muted">{label}</p>
      <p className="mt-0.5 text-[20px] font-medium tabular-nums leading-tight" style={{ color }}>
        {big}{unit && <span className="text-[13px] font-medium ml-1">{unit}</span>}
      </p>
      {days !== null && <p className="text-[11px] text-text-muted">{phrase}</p>}
    </div>
  )
}

export default function ScorecardDetailPage() {
  const { user } = useAuth()
  const router = useRouter()
  const params = useParams()
  const orgId = user?.organizationId ?? ''
  const userId = String(params.userId ?? '')

  const [card, setCard] = useState<Scorecard | null>(null)
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const [listView, setListView] = useState<'grouped' | 'flat'>('grouped')
  const [listFilter, setListFilter] = useState<'all' | 'pending' | 'completed'>('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!orgId || !userId) return
    let cancelled = false
    setLoading(true); setDenied(false)
    reportsApi
      .getScorecard(orgId, userId, { from_date: fromDate || undefined, to_date: toDate ? `${toDate}T23:59:59` : undefined })
      .then((c) => { if (!cancelled) setCard(c) })
      .catch((e) => { if (!cancelled) { if (e?.response?.status === 403) setDenied(true); setCard(null) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [orgId, userId, fromDate, toDate])

  function download() {
    if (card) exportScorecardsXlsx([card], `scorecard-${card.employee.name.replace(/\s+/g, '-').toLowerCase()}`, windowLabel(fromDate, toDate))
  }

  const m = card?.metrics

  // Recurring tasks that have never once been completed since they started.
  const neverCompleted = useMemo(() => (card?.recurring_tasks ?? []).filter((r) => r.fired > 0 && r.done === 0), [card])
  const earliestNeverStart = useMemo(() => {
    const dates = neverCompleted.map((r) => r.start_date).filter(Boolean) as string[]
    if (!dates.length) return null
    return dates.sort()[0]
  }, [neverCompleted])

  // The task-entry list: filter → (grouped | flat).
  const entries = card?.entries ?? []
  const filtered = useMemo(() => {
    if (listFilter === 'pending') return entries.filter(isPending)
    if (listFilter === 'completed') return entries.filter((e) => e.date_status === 'completed')
    return entries
  }, [entries, listFilter])
  const pendingView = listFilter === 'pending'

  const groups = useMemo(() => {
    const map = new Map<string, { title: string; frequency: string; total: number; completed: number; pending: number; oldest: number | null; rows: TaskEntryRow[] }>()
    for (const e of filtered) {
      let g = map.get(e.title)
      if (!g) { g = { title: e.title, frequency: e.frequency, total: 0, completed: 0, pending: 0, oldest: null, rows: [] }; map.set(e.title, g) }
      g.total += 1
      g.rows.push(e)
      if (e.date_status === 'completed') g.completed += 1
      if (isPending(e)) g.pending += 1
      if (e.date_status === 'overdue' && e.days_late != null && (g.oldest === null || e.days_late > g.oldest)) g.oldest = e.days_late
    }
    return Array.from(map.values()).sort((a, b) => (b.oldest ?? -1) - (a.oldest ?? -1) || b.total - a.total || a.title.localeCompare(b.title))
  }, [filtered])

  function toggle(title: string) {
    setExpanded((prev) => { const n = new Set(prev); n.has(title) ? n.delete(title) : n.add(title); return n })
  }

  if (denied) {
    return (
      <div className="flex flex-col items-center justify-center h-72 text-center">
        <div className="w-14 h-14 rounded-full bg-danger-bg flex items-center justify-center mb-4"><Lock size={24} className="text-danger" /></div>
        <p className="font-medium text-text-primary text-base">This person is outside your scope</p>
        <p className="text-text-secondary text-sm mt-1 max-w-sm">You can only open scorecards for people within your visibility.</p>
        <Button variant="secondary" className="mt-4" onClick={() => router.push('/dashboard/tasks/reports-new/person-scorecard')}>Back to roster</Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={card?.employee.name ?? 'Loading…'}
        trail={[
          { label: 'Tasks', href: '/dashboard/tasks' },
          { label: 'Reports', href: '/dashboard/tasks/reports-new' },
          { label: 'Person Scorecard', href: '/dashboard/tasks/reports-new/person-scorecard' },
        ]}
        meta={
          <>
            {m && <GradePill grade={m.grade} className="mr-2 align-middle" />}
            {[card?.employee.role_title, card?.employee.department_name].filter(Boolean).join(' · ') || card?.employee.email || ''}
            {m && <span className="block mt-1">{gradeReason(m)}</span>}
          </>
        }
        actions={
          <div className="flex items-center gap-2 shrink-0">
            <DateRangePicker from={fromDate} to={toDate} onChange={(f, t) => { setFromDate(f); setToDate(t) }} placeholder="All time" />
            <Button onClick={download} disabled={!card}>
              <Download size={15} /> Download
            </Button>
          </div>
        }
      />

      {loading ? (
        <div className="flex items-center justify-center h-48"><div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : !card || !m ? (
        <div className="bg-surface border border-border-light rounded-card py-12 text-center text-text-muted">Could not load this scorecard.</div>
      ) : (
        <>
          {/* Warning strip — recurring tasks never once completed since they started */}
          {neverCompleted.length > 0 && (
            <div className="flex items-start gap-3 bg-warning-bg border border-warning-border rounded-card px-4 py-3">
              <AlertTriangle size={18} className="text-warning shrink-0 mt-0.5" />
              <p className="text-[13.5px] text-warning leading-relaxed">
                <span className="font-medium">{neverCompleted.length} recurring {neverCompleted.length === 1 ? 'task has' : 'tasks have'} never been completed</span>
                {earliestNeverStart ? ` since ${neverCompleted.length === 1 ? 'it' : 'the earliest one'} started on ${fmt(earliestNeverStart)}` : ''}
                {` (${neverCompleted.map((r) => r.title).slice(0, 3).join(', ')}${neverCompleted.length > 3 ? '…' : ''}). `}
                A recurring task that has run many times and never once been completed is usually set up wrongly — please check whether its cadence and owner are correct.
              </p>
            </div>
          )}

          {/* KPI tiles — colour only where it carries meaning */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <Tile label="Different tasks" value={m.different_tasks} />
            <Tile label="Total entries" value={formatNumber(m.total_given)} />
            <Tile label="Completion rate" value={m.completion_pct === null ? '—' : `${m.completion_pct}%`} accent={completionColor(m.completion_pct)} sub={`${formatNumber(m.completed)} completed`} />
            <Tile label="On-time rate" value={m.on_time_pct === null ? '—' : `${m.on_time_pct}%`} accent={onTimeColor(m.on_time_pct)} sub={m.completed_with_date > 0 ? `${m.completed_on_time} of ${m.completed_with_date} on time` : 'nothing completed yet'} />
            <Tile label="Pending" value={formatNumber(m.pending)} accent={m.overdue > 0 ? RED : INK} sub={m.overdue > 0 ? `${formatNumber(m.overdue)} overdue` : m.pending > 0 ? 'none overdue yet' : 'nothing pending'} />
          </div>

          {/* Timing — completed delay and pending age kept strictly separate */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-surface border border-border-light rounded-card shadow-card p-4">
              <p className="text-[13px] font-medium text-text-primary mb-3">Completed work — how late it finished</p>
              <div className="flex gap-4">
                <TimingFigure label="Average delay" days={m.avg_delay_days} color={completedDelayColor(m.avg_delay_days)} />
                <TimingFigure label="Longest delay" days={m.longest_delay_days} color={completedDelayColor(m.longest_delay_days)} />
              </div>
            </div>
            <div className="bg-surface border border-border-light rounded-card shadow-card p-4">
              <p className="text-[13px] font-medium text-text-primary mb-3">Pending work — how old it is now</p>
              <div className="flex gap-4">
                <TimingFigure label="Average age" days={m.avg_pending_age_days} color={pendingAgeColor(m.avg_pending_age_days)} />
                <TimingFigure label="Oldest pending" days={m.longest_pending_age_days} color={pendingAgeColor(m.longest_pending_age_days)} />
              </div>
            </div>
          </div>

          {/* Period line */}
          <p className="text-[13px] text-text-muted">
            Showing {formatNumber(m.total_given)} {m.total_given === 1 ? 'entry' : 'entries'}, {windowLabel(fromDate, toDate)}, {m.different_tasks} different {m.different_tasks === 1 ? 'task' : 'tasks'}.
            {m.completed_no_date > 0 && ` ${formatNumber(m.completed_no_date)} completed ${m.completed_no_date === 1 ? 'task has' : 'tasks have'} no completion date entered, so ${m.completed_no_date === 1 ? 'it is' : 'they are'} kept out of the on-time and delay figures.`}
            {/* Say plainly what the numbers above did and did not count. Withdrawn work is
                excluded from every figure, and every on-time/late/delay figure was measured
                against the ORIGINAL due date — both facts change how the score reads. */}
            {m.withdrawn > 0 && ` ${formatNumber(m.withdrawn)} ${m.withdrawn === 1 ? 'entry was' : 'entries were'} withdrawn — taken off this person before the original due date without finishing — so ${m.withdrawn === 1 ? 'it is' : 'they are'} listed below but kept out of every figure above, including the grade.`}
            {m.handed_over > 0 && ` ${formatNumber(m.handed_over)} ${m.handed_over === 1 ? 'entry was' : 'entries were'} handed over to someone else after already running late. The delay ${m.handed_over === 1 ? 'stays' : 'stay'} on this person's record, frozen at the day ${m.handed_over === 1 ? 'it' : 'they'} left them — but ${m.handed_over === 1 ? 'it is' : 'they are'} NOT counted as pending or overdue here, because the work is not theirs to finish any more. Each row below names who holds it now.`}
            {m.revised_entries > 0 && ` ${formatNumber(m.revised_entries)} ${m.revised_entries === 1 ? 'entry has' : 'entries have'} had the due date changed at least once; on-time and delay are always measured against the original due date.`}
          </p>

          {/* Recurring tasks held */}
          <section className="bg-surface border border-border-light rounded-card shadow-card overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border-light">
              <RotateCcw size={16} className="text-text-secondary" />
              <h2 className="text-[15px] font-medium text-text-primary">Recurring tasks held</h2>
              <span className="text-[12px] text-text-muted">({card.recurring_tasks.length})</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="bg-surface-sunken border-b border-border-light text-text-secondary text-left">
                    <th className="px-4 py-2.5 font-medium">Task</th>
                    <th className="px-4 py-2.5 font-medium">Cadence</th>
                    <th className="px-4 py-2.5 font-medium">Start</th>
                    <th className="px-4 py-2.5 font-medium">Next run</th>
                    <th className="px-4 py-2.5 font-medium text-center">Fired</th>
                    <th className="px-4 py-2.5 font-medium text-center">Done</th>
                    <th className="px-4 py-2.5 font-medium text-center">On time</th>
                    <th className="px-4 py-2.5 font-medium text-center" title="Occurrences of this task the person was taken off before their due date — kept out of Fired, Done and On time.">Withdrawn</th>
                    <th className="px-4 py-2.5 font-medium text-center" title="Occurrences already late when they were taken off and given to someone else. Kept out of Fired, Done, On time and the behind-count — the work is no longer theirs to close.">Handed over</th>
                    <th className="px-4 py-2.5 font-medium">Freshness</th>
                  </tr>
                </thead>
                <tbody>
                  {card.recurring_tasks.map((r) => (
                    <tr key={r.template_id} className="border-b border-border-light last:border-0">
                      <td className="px-4 py-2.5 font-medium text-text-primary">{r.title}</td>
                      <td className="px-4 py-2.5 text-text-secondary">{r.cadence_label}</td>
                      <td className="px-4 py-2.5 text-text-secondary">{fmt(r.start_date)}</td>
                      <td className="px-4 py-2.5 text-text-secondary">{fmt(r.next_run)}</td>
                      <td className="px-4 py-2.5 text-center tabular-nums text-text-secondary">{r.fired}</td>
                      <td className="px-4 py-2.5 text-center tabular-nums" style={{ color: r.fired > 0 && r.done === 0 ? RED : INK }}>{r.done}</td>
                      <td className="px-4 py-2.5 text-center tabular-nums">{r.on_time_rate === null ? <span className="text-text-muted">—</span> : `${r.on_time_rate}%`}</td>
                      <td className="px-4 py-2.5 text-center tabular-nums" style={{ color: r.withdrawn ? 'var(--text-muted)' : 'var(--border)' }}>{r.withdrawn}</td>
                    <td className="px-4 py-2.5 text-center tabular-nums" style={{ color: r.handed_over ? 'var(--text-secondary)' : 'var(--border)' }}>{r.handed_over}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className="inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium"
                          style={
                            r.freshness_state === 'behind'
                              ? { backgroundColor: 'var(--danger-bg)', color: 'var(--danger)' }
                              : r.freshness_state === 'current'
                              ? { backgroundColor: 'var(--success-bg)', color: 'var(--success)' }
                              : { backgroundColor: 'var(--surface-control)', color: 'var(--text-muted)' }
                          }
                        >
                          {r.freshness_label}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {card.recurring_tasks.length === 0 && (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-text-muted">No recurring tasks held.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Task entries — grouped by task by default, with a flat toggle + filter */}
          <section className="bg-surface border border-border-light rounded-card shadow-card overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border-light flex-wrap">
              <ListChecks size={16} className="text-text-secondary" />
              <h2 className="text-[15px] font-medium text-text-primary">Task entries</h2>
              <span className="text-[12px] text-text-muted">({filtered.length})</span>
              <div className="ml-auto flex items-center gap-2 flex-wrap">
                {/* Filter */}
                <div className="inline-flex rounded-control border border-border-light overflow-hidden text-[13px]">
                  {(['all', 'pending', 'completed'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setListFilter(f)}
                      className={`px-3 py-1.5 font-medium capitalize transition-colors ${listFilter === f ? 'bg-primary text-white' : 'bg-surface text-text-secondary hover:bg-surface-control'}`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                {/* View */}
                <div className="inline-flex rounded-control border border-border-light overflow-hidden text-[13px]">
                  {(['grouped', 'flat'] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setListView(v)}
                      className={`px-3 py-1.5 font-medium capitalize transition-colors ${listView === v ? 'bg-text-primary text-white' : 'bg-surface text-text-secondary hover:bg-surface-control'}`}
                    >
                      {v === 'grouped' ? 'Grouped by task' : 'Flat list'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="px-4 py-8 text-center text-text-muted">No task entries in this view.</div>
            ) : listView === 'grouped' ? (
              /* ── Grouped view ─────────────────────────────────────────────── */
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-sunken border-b border-border-light text-text-secondary text-left whitespace-nowrap">
                      <th className="px-4 py-2.5 font-medium">Task name</th>
                      <th className="px-3 py-2.5 font-medium">Frequency</th>
                      <th className="px-3 py-2.5 font-medium text-center">Total entries</th>
                      <th className="px-3 py-2.5 font-medium text-center">Completed</th>
                      <th className="px-3 py-2.5 font-medium text-center">Pending</th>
                      <th className="px-3 py-2.5 font-medium text-center">Oldest days late</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => {
                      const open = expanded.has(g.title)
                      return (
                        <React.Fragment key={g.title}>
                          <tr onClick={() => toggle(g.title)} className="border-b border-border-light hover:bg-surface-sunken cursor-pointer whitespace-nowrap">
                            <td className="px-4 py-2.5 font-medium text-text-primary">
                              <span className="inline-flex items-center gap-1.5">
                                {open ? <ChevronDown size={15} className="text-text-muted" /> : <ChevronRight size={15} className="text-text-muted" />}
                                {g.title}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-text-secondary">{g.frequency}</td>
                            <td className="px-3 py-2.5 text-center tabular-nums text-text-primary font-medium">{g.total}</td>
                            <td className="px-3 py-2.5 text-center tabular-nums text-text-secondary">{g.completed}</td>
                            <td className="px-3 py-2.5 text-center tabular-nums" style={{ color: g.pending > 0 ? RED : MUTE }}>{g.pending}</td>
                            <td className="px-3 py-2.5 text-center tabular-nums font-medium" style={{ color: g.oldest === null ? MUTE : pendingAgeColor(g.oldest) }}>
                              {g.oldest === null ? '—' : `${g.oldest}`}
                            </td>
                          </tr>
                          {open && (
                            <tr className="bg-surface-sunken">
                              <td colSpan={6} className="px-4 py-2">
                                <table className="w-full text-[13px]">
                                  <thead>
                                    <tr className="text-text-muted text-left whitespace-nowrap">
                                      <th className="px-2 py-1 font-medium">Due date</th>
                                      <th className="px-2 py-1 font-medium">Stage</th>
                                      <th className="px-2 py-1 font-medium">Standing</th>
                                      <th className="px-2 py-1 font-medium">Days late</th>
                                      {!pendingView && <th className="px-2 py-1 font-medium">Completed date</th>}
                                      {!pendingView && <th className="px-2 py-1 font-medium">On time</th>}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {g.rows.map((e, i) => (
                                      <tr key={`${e.task_id}-${i}`} className="border-t border-border-light whitespace-nowrap">
                                        <td className="px-2 py-1.5 text-text-secondary">{fmt(e.due_date)}<DueDateNote e={e} /></td>
                                        <td className="px-2 py-1.5 text-text-secondary">{e.status ?? '—'}</td>
                                        <td className="px-2 py-1.5">
                                          {e.date_status === 'handed_over' ? <WithdrawnTag e={e} /> : <DateStatusTag status={e.date_status} daysLate={e.days_late} />}
                                        </td>
                                        <td className="px-2 py-1.5 tabular-nums" style={{ color: e.days_late == null || e.date_status === 'handed_over' ? MUTE : e.date_status === 'overdue' ? pendingAgeColor(e.days_late) : completedDelayColor(e.days_late) }}>{daysLateCell(e)}</td>
                                        {!pendingView && <td className="px-2 py-1.5 text-text-secondary">{fmt(e.completion_date)}</td>}
                                        {!pendingView && <td className="px-2 py-1.5 font-medium" style={{ color: e.on_time === 'Yes' ? 'var(--success)' : e.on_time === 'No' ? RED : MUTE }}>{e.on_time || '—'}</td>}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              /* ── Flat view ────────────────────────────────────────────────── */
              <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-surface-sunken border-b border-border-light text-text-secondary text-left">
                      <th className="px-4 py-2.5 font-medium">Task</th>
                      <th className="px-3 py-2.5 font-medium">Frequency</th>
                      <th className="px-3 py-2.5 font-medium">Due date</th>
                      <th className="px-3 py-2.5 font-medium">Stage</th>
                      <th className="px-3 py-2.5 font-medium">Standing</th>
                      <th className="px-3 py-2.5 font-medium">Days late</th>
                      {!pendingView && <th className="px-3 py-2.5 font-medium">Completed date</th>}
                      {!pendingView && <th className="px-3 py-2.5 font-medium text-center">On time</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((e, i) => (
                      <tr key={`${e.task_id}-${i}`} className="border-b border-border-light last:border-0">
                        <td className="px-4 py-2 font-medium text-text-primary">{e.title}</td>
                        <td className="px-3 py-2 text-text-secondary">{e.frequency}</td>
                        <td className="px-3 py-2 text-text-secondary">{fmt(e.due_date)}<DueDateNote e={e} /></td>
                        <td className="px-3 py-2 text-text-secondary">{e.status ?? '—'}</td>
                        <td className="px-3 py-2">
                          {e.date_status === 'handed_over' ? <WithdrawnTag e={e} /> : <DateStatusTag status={e.date_status} daysLate={e.days_late} />}
                        </td>
                        <td className="px-3 py-2 tabular-nums" style={{ color: e.days_late == null || e.date_status === 'handed_over' ? MUTE : e.date_status === 'overdue' ? pendingAgeColor(e.days_late) : completedDelayColor(e.days_late) }}>{daysLateCell(e)}</td>
                        {!pendingView && <td className="px-3 py-2 text-text-secondary">{fmt(e.completion_date)}</td>}
                        {!pendingView && <td className="px-3 py-2 text-center font-medium" style={{ color: e.on_time === 'Yes' ? 'var(--success)' : e.on_time === 'No' ? RED : MUTE }}>{e.on_time || '—'}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
