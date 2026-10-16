'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  ListChecks,
  Ticket as TicketIcon,
  Lightbulb,
  CalendarClock,
  Inbox,
  Send,
  Save,
  CheckCircle2,
} from 'lucide-react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth/context'
import { workLogApi, type UpsertDailyPayload } from '@/lib/api/workLogs'
import type { DailyUpdateView, DayContext } from '@/lib/types/workLogs'
import DatePicker from '@/components/ui/DatePicker'

// Local YYYY-MM-DD (avoids UTC drift from toISOString).
function localDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  return localDate(dt)
}
function prettyDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

interface NoteDraft {
  title: string
  description: string
}

const cardCls = 'bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)]'
const inputCls =
  'w-full border border-[#CBD5E1] rounded-[8px] px-3 py-2 text-sm text-[#0F172A] bg-white placeholder:text-[#94A3B8] focus:border-2 focus:border-[#2563EB] focus:outline-hidden'
const labelCls = 'text-sm font-medium text-[#374151]'

export default function DailyUpdatePage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const today = useMemo(() => localDate(new Date()), [])
  const [date, setDate] = useState(today)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState<DailyUpdateView | null>(null)
  const [context, setContext] = useState<DayContext | null>(null)

  // Form state
  const [notes, setNotes] = useState<NoteDraft[]>([{ title: '', description: '' }])
  const [stuck, setStuck] = useState('')
  const [decisions, setDecisions] = useState('')
  const [daySummary, setDaySummary] = useState('')
  const [planning, setPlanning] = useState('')
  const [foldedBodies, setFoldedBodies] = useState<Record<string, string>>({})
  const [savedFlash, setSavedFlash] = useState(false)

  const hydrate = useCallback((v: DailyUpdateView) => {
    const du = v.daily_update
    const loadedNotes = du?.notes?.length
      ? du.notes.map((n) => ({ title: n.title, description: n.description ?? '' }))
      : [{ title: '', description: '' }]
    setNotes(loadedNotes)
    setStuck(du?.stuck ?? '')
    setDecisions(du?.decisions ?? '')
    setDaySummary(du?.day_summary ?? '')
    setPlanning(du?.planning_tomorrow ?? '')
    const fb: Record<string, string> = {}
    for (const f of v.folded_demands) fb[f.submission_id] = f.body ?? ''
    setFoldedBodies(fb)
  }, [])

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const [v, ctx] = await Promise.all([
        workLogApi.getDay(orgId, date),
        workLogApi.getDayContext(orgId, date),
      ])
      setView(v)
      setContext(ctx)
      hydrate(v)
    } finally {
      setLoading(false)
    }
  }, [orgId, date, hydrate])

  useEffect(() => {
    load()
  }, [load])

  async function save(submit: boolean) {
    if (!orgId) return
    setSaving(true)
    try {
      const payload: UpsertDailyPayload = {
        notes: notes
          .filter((n) => n.title.trim() || n.description.trim())
          .map((n, i) => ({ title: n.title.trim() || 'Untitled', description: n.description.trim(), order_index: i })),
        stuck,
        decisions,
        day_summary: daySummary,
        planning_tomorrow: planning,
        folded_submissions: Object.entries(foldedBodies).map(([id, body]) => ({ id, body })),
        submit,
      }
      const v = await workLogApi.upsertDay(orgId, payload, date)
      setView(v)
      hydrate(v)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  const isSubmitted = !!view?.daily_update?.submitted_at

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-[28px] font-bold text-[#0F172A]">Daily Update</h1>
          <p className="text-sm text-[#475569] mt-0.5">Log your work, blockers, decisions, and tomorrow&apos;s plan.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDate((d) => shiftDate(d, -1))}
            className="w-9 h-9 flex items-center justify-center rounded-[8px] border border-[#E2E8F0] text-[#475569] hover:bg-[#F1F5F9]"
            aria-label="Previous day"
          >
            <ChevronLeft size={18} />
          </button>
          <DatePicker value={date} max={today} onChange={(v) => setDate(v || today)} placeholder="Select date" />
          <button
            type="button"
            onClick={() => setDate((d) => (d < today ? shiftDate(d, 1) : d))}
            disabled={date >= today}
            className="w-9 h-9 flex items-center justify-center rounded-[8px] border border-[#E2E8F0] text-[#475569] hover:bg-[#F1F5F9] disabled:text-[#CBD5E1] disabled:cursor-not-allowed"
            aria-label="Next day"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="flex flex-col-reverse lg:flex-row gap-6">
        {/* ─── Sidebar: day context ─── */}
        <aside className="lg:w-72 shrink-0 space-y-4">
          <div className={`${cardCls} p-4`}>
            <h3 className="text-sm font-semibold text-[#0F172A] flex items-center gap-2 mb-3">
              <ListChecks size={15} className="text-[#2563EB]" /> Tasks due {date === today ? 'today' : 'this day'}
            </h3>
            {context && context.tasks.length > 0 ? (
              <ul className="space-y-2">
                {context.tasks.map((t) => (
                  <li key={t.id} className="text-sm">
                    <Link href={`/dashboard/tasks/${t.id}`} className="text-[#1E293B] hover:text-[#2563EB] line-clamp-2">
                      {t.title}
                    </Link>
                    {t.status && <span className="block text-xs text-[#64748B]">{t.status.label}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-[#94A3B8]">No tasks due.</p>
            )}
          </div>

          <div className={`${cardCls} p-4`}>
            <h3 className="text-sm font-semibold text-[#0F172A] flex items-center gap-2 mb-3">
              <TicketIcon size={15} className="text-[#2563EB]" /> Tickets this day
            </h3>
            {context && context.tickets.length > 0 ? (
              <ul className="space-y-2">
                {context.tickets.map((t) => (
                  <li key={t.id} className="text-sm flex items-start gap-1.5">
                    <span
                      className={`mt-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${
                        t.direction === 'by_me'
                          ? 'bg-[#EFF6FF] text-[#2563EB] border border-[#BFDBFE]'
                          : 'bg-[#FEF9C3] text-[#CA8A04] border border-[#FDE68A]'
                      }`}
                    >
                      {t.direction === 'by_me' ? 'By me' : 'To me'}
                    </span>
                    <Link href={`/dashboard/tickets/${t.id}`} className="text-[#1E293B] hover:text-[#2563EB] line-clamp-2">
                      {t.title}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-[#94A3B8]">No tickets.</p>
            )}
          </div>
        </aside>

        {/* ─── Main body ─── */}
        <div className="flex-1 min-w-0 space-y-5">
          {loading ? (
            <div className={`${cardCls} p-8 text-center text-sm text-[#94A3B8]`}>Loading…</div>
          ) : (
            <>
              <p className="text-sm font-medium text-[#475569]">{prettyDate(date)}</p>

              {/* Carry-forward */}
              {view?.previous_planning_tomorrow && (
                <div className="border border-[#BAE6FD] bg-[#E0F2FE] rounded-[12px] p-4">
                  <h3 className="text-sm font-semibold text-[#0369A1] flex items-center gap-2 mb-1">
                    <CalendarClock size={15} /> Yesterday&apos;s plan for today
                  </h3>
                  <p className="text-sm text-[#0F172A] whitespace-pre-wrap">{view.previous_planning_tomorrow}</p>
                </div>
              )}

              {isSubmitted && (
                <div className="flex items-center gap-2 text-sm text-[#16A34A] font-medium">
                  <CheckCircle2 size={16} /> Submitted{view?.daily_update?.submitted_at ? ` · still editable` : ''}
                </div>
              )}

              {/* Notes */}
              <div className={`${cardCls} p-6`}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-[18px] font-semibold text-[#0F172A]">Work notes</h2>
                  <button
                    type="button"
                    onClick={() => setNotes((n) => [...n, { title: '', description: '' }])}
                    className="flex items-center gap-1.5 text-sm font-medium text-[#2563EB] hover:text-[#1D4ED8]"
                  >
                    <Plus size={15} /> Add note
                  </button>
                </div>
                <div className="space-y-4">
                  {notes.map((note, i) => (
                    <div key={i} className="border border-[#E2E8F0] rounded-[10px] p-4 bg-[#F8FAFC] space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          value={note.title}
                          onChange={(e) =>
                            setNotes((n) => n.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
                          }
                          placeholder={`Note ${i + 1} title`}
                          className={inputCls}
                        />
                        {notes.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setNotes((n) => n.filter((_, j) => j !== i))}
                            className="w-9 h-9 shrink-0 flex items-center justify-center rounded-[8px] text-[#94A3B8] hover:text-[#DC2626] hover:bg-[#FEE2E2]"
                            aria-label="Remove note"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                      <textarea
                        value={note.description}
                        onChange={(e) =>
                          setNotes((n) => n.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))
                        }
                        placeholder="What did you do?"
                        rows={2}
                        className={inputCls}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Folded daily demands */}
              {view && view.folded_demands.length > 0 && (
                <div className={`${cardCls} p-6`}>
                  <h2 className="text-[18px] font-semibold text-[#0F172A] flex items-center gap-2 mb-1">
                    <Inbox size={17} className="text-[#2563EB]" /> Demanded daily logs
                  </h2>
                  <p className="text-sm text-[#475569] mb-4">These were demanded from you — submit them with your update.</p>
                  <div className="space-y-4">
                    {view.folded_demands.map((f) => (
                      <div key={f.submission_id} className="border border-[#E2E8F0] rounded-[10px] p-4 bg-[#F8FAFC]">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-sm font-semibold text-[#0F172A]">{f.title}</span>
                          {f.status === 'submitted' && (
                            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#DCFCE7] text-[#16A34A] border border-[#BBF7D0]">
                              Submitted
                            </span>
                          )}
                        </div>
                        {f.description && <p className="text-xs text-[#475569] mb-2">{f.description}</p>}
                        <textarea
                          value={foldedBodies[f.submission_id] ?? ''}
                          onChange={(e) =>
                            setFoldedBodies((m) => ({ ...m, [f.submission_id]: e.target.value }))
                          }
                          placeholder="Your update…"
                          rows={2}
                          className={inputCls}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Reflection fields */}
              <div className={`${cardCls} p-6 space-y-5`}>
                <div>
                  <label className={labelCls}>Where I was stuck today</label>
                  <textarea value={stuck} onChange={(e) => setStuck(e.target.value)} rows={2} className={`${inputCls} mt-1.5`} />
                </div>
                <div>
                  <label className={`${labelCls} flex items-center gap-1.5`}>
                    <Lightbulb size={14} className="text-[#D97706]" /> Decisions I took today
                  </label>
                  <textarea value={decisions} onChange={(e) => setDecisions(e.target.value)} rows={2} className={`${inputCls} mt-1.5`} />
                </div>
                <div>
                  <label className={labelCls}>How the overall day was</label>
                  <textarea value={daySummary} onChange={(e) => setDaySummary(e.target.value)} rows={2} className={`${inputCls} mt-1.5`} />
                </div>
                <div>
                  <label className={`${labelCls} flex items-center gap-1.5`}>
                    <CalendarClock size={14} className="text-[#2563EB]" /> Planning for tomorrow
                  </label>
                  <textarea value={planning} onChange={(e) => setPlanning(e.target.value)} rows={2} className={`${inputCls} mt-1.5`} />
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3">
                {savedFlash && <span className="text-sm text-[#16A34A] font-medium">Saved</span>}
                <button
                  type="button"
                  onClick={() => save(false)}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-5 py-2.5 rounded-[8px] text-sm font-semibold text-[#2563EB] bg-white border-2 border-[#2563EB] hover:bg-[#EFF6FF] disabled:opacity-60"
                >
                  <Save size={15} /> Save draft
                </button>
                <button
                  type="button"
                  onClick={() => save(true)}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-5 py-2.5 rounded-[8px] text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] disabled:bg-[#E2E8F0] disabled:text-[#94A3B8]"
                >
                  <Send size={15} /> {isSubmitted ? 'Update' : 'Submit'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
