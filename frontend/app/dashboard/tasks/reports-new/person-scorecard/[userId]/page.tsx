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
import { ArrowLeft, Download, Lock, RotateCcw, ListChecks, AlertTriangle, ChevronRight, ChevronDown } from 'lucide-react'

function initials(name: string) {
  return name.split(' ').filter(Boolean).map((n) => n[0]).join('').slice(0, 2).toUpperCase() || '?'
}

function fmt(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
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
    <span className="block text-[11px] font-medium text-[#B45309]" title={`Graded against the original due date, ${fmt(e.original_deadline)}`}>
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
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium bg-[#F1F5F9] text-[#475569]"
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
    <div className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-4">
      <p className="text-[12px] font-medium text-[#64748B] uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-[22px] font-bold tabular-nums leading-tight" style={{ color: accent }}>{value}</p>
      {sub && <p className="mt-0.5 text-[12px] text-[#94A3B8]">{sub}</p>}
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
      <p className="text-[12px] font-medium text-[#64748B]">{label}</p>
      <p className="mt-0.5 text-[20px] font-bold tabular-nums leading-tight" style={{ color }}>
        {big}{unit && <span className="text-[13px] font-semibold ml-1">{unit}</span>}
      </p>
      {days !== null && <p className="text-[11px] text-[#94A3B8]">{phrase}</p>}
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
        <div className="w-14 h-14 rounded-full bg-[#FEE2E2] flex items-center justify-center mb-4"><Lock size={24} className="text-[#DC2626]" /></div>
        <p className="font-semibold text-[#0F172A] text-base">This person is outside your scope</p>
        <p className="text-[#475569] text-sm mt-1 max-w-sm">You can only open scorecards for people within your visibility.</p>
        <button onClick={() => router.push('/dashboard/tasks/reports-new/person-scorecard')} className="mt-4 px-4 py-2 rounded-[8px] border border-[#E2E8F0] text-sm font-medium text-[#475569] hover:bg-[#F1F5F9]">Back to roster</button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <button onClick={() => router.back()} className="inline-flex items-center gap-1.5 text-sm text-[#475569] hover:text-[#0F172A] transition-colors">
        <ArrowLeft size={15} /> Back
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-14 h-14 rounded-full bg-[#2563EB] text-white text-lg font-bold flex items-center justify-center shrink-0">
            {card ? initials(card.employee.name) : '…'}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-[24px] font-bold text-[#0F172A] leading-tight truncate">{card?.employee.name ?? 'Loading…'}</h1>
              {m && <GradePill grade={m.grade} />}
            </div>
            <p className="text-[14px] text-[#475569] truncate">
              {[card?.employee.role_title, card?.employee.department_name].filter(Boolean).join(' · ') || card?.employee.email || ''}
            </p>
            {m && <p className="mt-1 text-[13px] text-[#334155]">{gradeReason(m)}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <DateRangePicker from={fromDate} to={toDate} onChange={(f, t) => { setFromDate(f); setToDate(t) }} placeholder="All time" />
          <button onClick={download} disabled={!card} className="flex items-center gap-1.5 px-3.5 py-[7px] bg-[#2563EB] text-white rounded-[8px] text-sm font-semibold hover:bg-[#1D4ED8] disabled:opacity-60 transition-colors">
            <Download size={15} /> Download
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48"><div className="w-7 h-7 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" /></div>
      ) : !card || !m ? (
        <div className="bg-white border border-[#E2E8F0] rounded-[12px] py-14 text-center text-[#94A3B8]">Could not load this scorecard.</div>
      ) : (
        <>
          {/* Warning strip — recurring tasks never once completed since they started */}
          {neverCompleted.length > 0 && (
            <div className="flex items-start gap-3 bg-[#FFFBEB] border border-[#FDE68A] rounded-[12px] px-4 py-3">
              <AlertTriangle size={18} className="text-[#B45309] shrink-0 mt-0.5" />
              <p className="text-[13.5px] text-[#92400E] leading-relaxed">
                <span className="font-semibold">{neverCompleted.length} recurring {neverCompleted.length === 1 ? 'task has' : 'tasks have'} never been completed</span>
                {earliestNeverStart ? ` since ${neverCompleted.length === 1 ? 'it' : 'the earliest one'} started on ${fmt(earliestNeverStart)}` : ''}
                {` (${neverCompleted.map((r) => r.title).slice(0, 3).join(', ')}${neverCompleted.length > 3 ? '…' : ''}). `}
                A recurring task that has run many times and never once been completed is usually set up wrongly — please check whether its cadence and owner are correct.
              </p>
            </div>
          )}

          {/* KPI tiles — colour only where it carries meaning */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <Tile label="Different tasks" value={m.different_tasks} />
            <Tile label="Total entries" value={m.total_given.toLocaleString()} />
            <Tile label="Completion rate" value={m.completion_pct === null ? '—' : `${m.completion_pct}%`} accent={completionColor(m.completion_pct)} sub={`${m.completed.toLocaleString()} completed`} />
            <Tile label="On-time rate" value={m.on_time_pct === null ? '—' : `${m.on_time_pct}%`} accent={onTimeColor(m.on_time_pct)} sub={m.completed_with_date > 0 ? `${m.completed_on_time} of ${m.completed_with_date} on time` : 'nothing completed yet'} />
            <Tile label="Pending" value={m.pending.toLocaleString()} accent={m.overdue > 0 ? RED : INK} sub={m.overdue > 0 ? `${m.overdue.toLocaleString()} overdue` : m.pending > 0 ? 'none overdue yet' : 'nothing pending'} />
          </div>

          {/* Timing — completed delay and pending age kept strictly separate */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-4">
              <p className="text-[13px] font-semibold text-[#0F172A] mb-3">Completed work — how late it finished</p>
              <div className="flex gap-4">
                <TimingFigure label="Average delay" days={m.avg_delay_days} color={completedDelayColor(m.avg_delay_days)} />
                <TimingFigure label="Longest delay" days={m.longest_delay_days} color={completedDelayColor(m.longest_delay_days)} />
              </div>
            </div>
            <div className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-4">
              <p className="text-[13px] font-semibold text-[#0F172A] mb-3">Pending work — how old it is now</p>
              <div className="flex gap-4">
                <TimingFigure label="Average age" days={m.avg_pending_age_days} color={pendingAgeColor(m.avg_pending_age_days)} />
                <TimingFigure label="Oldest pending" days={m.longest_pending_age_days} color={pendingAgeColor(m.longest_pending_age_days)} />
              </div>
            </div>
          </div>

          {/* Period line */}
          <p className="text-[13px] text-[#64748B]">
            Showing {m.total_given.toLocaleString()} {m.total_given === 1 ? 'entry' : 'entries'}, {windowLabel(fromDate, toDate)}, {m.different_tasks} different {m.different_tasks === 1 ? 'task' : 'tasks'}.
            {m.completed_no_date > 0 && ` ${m.completed_no_date.toLocaleString()} completed ${m.completed_no_date === 1 ? 'task has' : 'tasks have'} no completion date entered, so ${m.completed_no_date === 1 ? 'it is' : 'they are'} kept out of the on-time and delay figures.`}
            {/* Say plainly what the numbers above did and did not count. Withdrawn work is
                excluded from every figure, and every on-time/late/delay figure was measured
                against the ORIGINAL due date — both facts change how the score reads. */}
            {m.withdrawn > 0 && ` ${m.withdrawn.toLocaleString()} ${m.withdrawn === 1 ? 'entry was' : 'entries were'} withdrawn — taken off this person before the original due date without finishing — so ${m.withdrawn === 1 ? 'it is' : 'they are'} listed below but kept out of every figure above, including the grade.`}
            {m.handed_over > 0 && ` ${m.handed_over.toLocaleString()} ${m.handed_over === 1 ? 'entry was' : 'entries were'} handed over to someone else after already running late. The delay ${m.handed_over === 1 ? 'stays' : 'stay'} on this person's record, frozen at the day ${m.handed_over === 1 ? 'it' : 'they'} left them — but ${m.handed_over === 1 ? 'it is' : 'they are'} NOT counted as pending or overdue here, because the work is not theirs to finish any more. Each row below names who holds it now.`}
            {m.revised_entries > 0 && ` ${m.revised_entries.toLocaleString()} ${m.revised_entries === 1 ? 'entry has' : 'entries have'} had the due date changed at least once; on-time and delay are always measured against the original due date.`}
          </p>

          {/* Recurring tasks held */}
          <section className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[#E2E8F0]">
              <RotateCcw size={16} className="text-[#7C3AED]" />
              <h2 className="text-[15px] font-semibold text-[#0F172A]">Recurring tasks held</h2>
              <span className="text-[12px] text-[#94A3B8]">({card.recurring_tasks.length})</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[#475569] text-left">
                    <th className="px-4 py-2.5 font-semibold">Task</th>
                    <th className="px-4 py-2.5 font-semibold">Cadence</th>
                    <th className="px-4 py-2.5 font-semibold">Start</th>
                    <th className="px-4 py-2.5 font-semibold">Next run</th>
                    <th className="px-4 py-2.5 font-semibold text-center">Fired</th>
                    <th className="px-4 py-2.5 font-semibold text-center">Done</th>
                    <th className="px-4 py-2.5 font-semibold text-center">On time</th>
                    <th className="px-4 py-2.5 font-semibold text-center" title="Occurrences of this task the person was taken off before their due date — kept out of Fired, Done and On time.">Withdrawn</th>
                    <th className="px-4 py-2.5 font-semibold text-center" title="Occurrences already late when they were taken off and given to someone else. Kept out of Fired, Done, On time and the behind-count — the work is no longer theirs to close.">Handed over</th>
                    <th className="px-4 py-2.5 font-semibold">Freshness</th>
                  </tr>
                </thead>
                <tbody>
                  {card.recurring_tasks.map((r) => (
                    <tr key={r.template_id} className="border-b border-[#F1F5F9] last:border-0">
                      <td className="px-4 py-2.5 font-medium text-[#0F172A]">{r.title}</td>
                      <td className="px-4 py-2.5 text-[#475569]">{r.cadence_label}</td>
                      <td className="px-4 py-2.5 text-[#475569]">{fmt(r.start_date)}</td>
                      <td className="px-4 py-2.5 text-[#475569]">{fmt(r.next_run)}</td>
                      <td className="px-4 py-2.5 text-center tabular-nums text-[#475569]">{r.fired}</td>
                      <td className="px-4 py-2.5 text-center tabular-nums" style={{ color: r.fired > 0 && r.done === 0 ? RED : INK }}>{r.done}</td>
                      <td className="px-4 py-2.5 text-center tabular-nums">{r.on_time_rate === null ? <span className="text-[#94A3B8]">—</span> : `${r.on_time_rate}%`}</td>
                      <td className="px-4 py-2.5 text-center tabular-nums" style={{ color: r.withdrawn ? '#64748B' : '#CBD5E1' }}>{r.withdrawn}</td>
                    <td className="px-4 py-2.5 text-center tabular-nums" style={{ color: r.handed_over ? '#475569' : '#CBD5E1' }}>{r.handed_over}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className="inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium"
                          style={
                            r.freshness_state === 'behind'
                              ? { backgroundColor: '#FEE2E2', color: '#B91C1C' }
                              : r.freshness_state === 'current'
                              ? { backgroundColor: '#DCFCE7', color: '#15803D' }
                              : { backgroundColor: '#F1F5F9', color: '#94A3B8' }
                          }
                        >
                          {r.freshness_label}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {card.recurring_tasks.length === 0 && (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-[#94A3B8]">No recurring tasks held.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Task entries — grouped by task by default, with a flat toggle + filter */}
          <section className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[#E2E8F0] flex-wrap">
              <ListChecks size={16} className="text-[#0891B2]" />
              <h2 className="text-[15px] font-semibold text-[#0F172A]">Task entries</h2>
              <span className="text-[12px] text-[#94A3B8]">({filtered.length})</span>
              <div className="ml-auto flex items-center gap-2 flex-wrap">
                {/* Filter */}
                <div className="inline-flex rounded-[8px] border border-[#E2E8F0] overflow-hidden text-[13px]">
                  {(['all', 'pending', 'completed'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setListFilter(f)}
                      className={`px-3 py-1.5 font-medium capitalize transition-colors ${listFilter === f ? 'bg-[#2563EB] text-white' : 'bg-white text-[#475569] hover:bg-[#F1F5F9]'}`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                {/* View */}
                <div className="inline-flex rounded-[8px] border border-[#E2E8F0] overflow-hidden text-[13px]">
                  {(['grouped', 'flat'] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setListView(v)}
                      className={`px-3 py-1.5 font-medium capitalize transition-colors ${listView === v ? 'bg-[#0F172A] text-white' : 'bg-white text-[#475569] hover:bg-[#F1F5F9]'}`}
                    >
                      {v === 'grouped' ? 'Grouped by task' : 'Flat list'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="px-4 py-10 text-center text-[#94A3B8]">No task entries in this view.</div>
            ) : listView === 'grouped' ? (
              /* ── Grouped view ─────────────────────────────────────────────── */
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[#475569] text-left whitespace-nowrap">
                      <th className="px-4 py-2.5 font-semibold">Task name</th>
                      <th className="px-3 py-2.5 font-semibold">Frequency</th>
                      <th className="px-3 py-2.5 font-semibold text-center">Total entries</th>
                      <th className="px-3 py-2.5 font-semibold text-center">Completed</th>
                      <th className="px-3 py-2.5 font-semibold text-center">Pending</th>
                      <th className="px-3 py-2.5 font-semibold text-center">Oldest days late</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => {
                      const open = expanded.has(g.title)
                      return (
                        <React.Fragment key={g.title}>
                          <tr onClick={() => toggle(g.title)} className="border-b border-[#F1F5F9] hover:bg-[#F8FAFC] cursor-pointer whitespace-nowrap">
                            <td className="px-4 py-2.5 font-medium text-[#0F172A]">
                              <span className="inline-flex items-center gap-1.5">
                                {open ? <ChevronDown size={15} className="text-[#94A3B8]" /> : <ChevronRight size={15} className="text-[#94A3B8]" />}
                                {g.title}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-[#475569]">{g.frequency}</td>
                            <td className="px-3 py-2.5 text-center tabular-nums text-[#0F172A] font-semibold">{g.total}</td>
                            <td className="px-3 py-2.5 text-center tabular-nums text-[#475569]">{g.completed}</td>
                            <td className="px-3 py-2.5 text-center tabular-nums" style={{ color: g.pending > 0 ? RED : MUTE }}>{g.pending}</td>
                            <td className="px-3 py-2.5 text-center tabular-nums font-semibold" style={{ color: g.oldest === null ? MUTE : pendingAgeColor(g.oldest) }}>
                              {g.oldest === null ? '—' : `${g.oldest}`}
                            </td>
                          </tr>
                          {open && (
                            <tr className="bg-[#FBFCFE]">
                              <td colSpan={6} className="px-4 py-2">
                                <table className="w-full text-[13px]">
                                  <thead>
                                    <tr className="text-[#94A3B8] text-left whitespace-nowrap">
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
                                      <tr key={`${e.task_id}-${i}`} className="border-t border-[#EEF2F7] whitespace-nowrap">
                                        <td className="px-2 py-1.5 text-[#475569]">{fmt(e.due_date)}<DueDateNote e={e} /></td>
                                        <td className="px-2 py-1.5 text-[#475569]">{e.status ?? '—'}</td>
                                        <td className="px-2 py-1.5">
                                          {e.date_status === 'handed_over' ? <WithdrawnTag e={e} /> : <DateStatusTag status={e.date_status} daysLate={e.days_late} />}
                                        </td>
                                        <td className="px-2 py-1.5 tabular-nums" style={{ color: e.days_late == null || e.date_status === 'handed_over' ? MUTE : e.date_status === 'overdue' ? pendingAgeColor(e.days_late) : completedDelayColor(e.days_late) }}>{daysLateCell(e)}</td>
                                        {!pendingView && <td className="px-2 py-1.5 text-[#475569]">{fmt(e.completion_date)}</td>}
                                        {!pendingView && <td className="px-2 py-1.5 font-medium" style={{ color: e.on_time === 'Yes' ? '#15803D' : e.on_time === 'No' ? RED : MUTE }}>{e.on_time || '—'}</td>}
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
                    <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[#475569] text-left">
                      <th className="px-4 py-2.5 font-semibold">Task</th>
                      <th className="px-3 py-2.5 font-semibold">Frequency</th>
                      <th className="px-3 py-2.5 font-semibold">Due date</th>
                      <th className="px-3 py-2.5 font-semibold">Stage</th>
                      <th className="px-3 py-2.5 font-semibold">Standing</th>
                      <th className="px-3 py-2.5 font-semibold">Days late</th>
                      {!pendingView && <th className="px-3 py-2.5 font-semibold">Completed date</th>}
                      {!pendingView && <th className="px-3 py-2.5 font-semibold text-center">On time</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((e, i) => (
                      <tr key={`${e.task_id}-${i}`} className="border-b border-[#F1F5F9] last:border-0">
                        <td className="px-4 py-2 font-medium text-[#0F172A]">{e.title}</td>
                        <td className="px-3 py-2 text-[#475569]">{e.frequency}</td>
                        <td className="px-3 py-2 text-[#475569]">{fmt(e.due_date)}<DueDateNote e={e} /></td>
                        <td className="px-3 py-2 text-[#475569]">{e.status ?? '—'}</td>
                        <td className="px-3 py-2">
                          {e.date_status === 'handed_over' ? <WithdrawnTag e={e} /> : <DateStatusTag status={e.date_status} daysLate={e.days_late} />}
                        </td>
                        <td className="px-3 py-2 tabular-nums" style={{ color: e.days_late == null || e.date_status === 'handed_over' ? MUTE : e.date_status === 'overdue' ? pendingAgeColor(e.days_late) : completedDelayColor(e.days_late) }}>{daysLateCell(e)}</td>
                        {!pendingView && <td className="px-3 py-2 text-[#475569]">{fmt(e.completion_date)}</td>}
                        {!pendingView && <td className="px-3 py-2 text-center font-medium" style={{ color: e.on_time === 'Yes' ? '#15803D' : e.on_time === 'No' ? RED : MUTE }}>{e.on_time || '—'}</td>}
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
