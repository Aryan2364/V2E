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
import { format as formatDateFns } from 'date-fns'
import { Label } from '@/components/ui/label'

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
  return formatDateFns(new Date(y, m - 1, d), 'EEEE, d MMM yyyy')
}

interface NoteDraft {
  title: string
  description: string
}

const cardCls = 'bg-surface border border-border-light rounded-xl shadow-card'
const inputCls =
  'w-full border border-border rounded-lg px-3 py-2 text-body text-text-primary bg-surface placeholder:text-text-muted focus:border-2 focus:border-primary focus:outline-hidden'
const labelCls = 'text-body font-medium text-text-secondary'

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
          <h1 className="text-[28px] font-medium text-text-primary">Daily Update</h1>
          <p className="text-body text-text-secondary mt-0.5">Log your work, blockers, decisions, and tomorrow&apos;s plan.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDate((d) => shiftDate(d, -1))}
            className="w-9 h-9 flex items-center justify-center rounded-lg border border-border-light text-text-secondary hover:bg-surface-control"
            aria-label="Previous day"
          >
            <ChevronLeft size={18} />
          </button>
          <DatePicker value={date} max={today} onChange={(v) => setDate(v || today)} placeholder="Select date" />
          <button
            type="button"
            onClick={() => setDate((d) => (d < today ? shiftDate(d, 1) : d))}
            disabled={date >= today}
            className="w-9 h-9 flex items-center justify-center rounded-lg border border-border-light text-text-secondary hover:bg-surface-control disabled:text-muted disabled:cursor-not-allowed"
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
            <h3 className="text-body font-medium text-text-primary flex items-center gap-2 mb-3">
              <ListChecks size={15} className="text-primary-text" /> Tasks due {date === today ? 'today' : 'this day'}
            </h3>
            {context && context.tasks.length > 0 ? (
              <ul className="space-y-2">
                {context.tasks.map((t) => (
                  <li key={t.id} className="text-body">
                    <Link href={`/dashboard/tasks/${t.id}`} className="text-text-primary hover:text-primary-text line-clamp-2">
                      {t.title}
                    </Link>
                    {t.status && <span className="block text-meta text-text-muted">{t.status.label}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-meta text-text-muted">No tasks due.</p>
            )}
          </div>

          <div className={`${cardCls} p-4`}>
            <h3 className="text-body font-medium text-text-primary flex items-center gap-2 mb-3">
              <TicketIcon size={15} className="text-primary-text" /> Tickets this day
            </h3>
            {context && context.tickets.length > 0 ? (
              <ul className="space-y-2">
                {context.tickets.map((t) => (
                  <li key={t.id} className="text-body flex items-start gap-1.5">
                    <span
                      className={`mt-0.5 text-meta font-medium px-1.5 py-0.5 rounded-full shrink-0 ${
                        t.direction === 'by_me'
                          ? 'bg-primary-subtle text-primary-text border border-primary-border'
                          : 'bg-warning-bg text-warning border border-warning-border'
                      }`}
                    >
                      {t.direction === 'by_me' ? 'By me' : 'To me'}
                    </span>
                    <Link href={`/dashboard/tickets/${t.id}`} className="text-text-primary hover:text-primary-text line-clamp-2">
                      {t.title}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-meta text-text-muted">No tickets.</p>
            )}
          </div>
        </aside>

        {/* ─── Main body ─── */}
        <div className="flex-1 min-w-0 space-y-4">
          {loading ? (
            <div className={`${cardCls} p-8 text-center text-body text-text-muted`}>Loading…</div>
          ) : (
            <>
              <p className="text-body font-medium text-text-secondary">{prettyDate(date)}</p>

              {/* Carry-forward */}
              {view?.previous_planning_tomorrow && (
                <div className="border border-border-light bg-surface-control rounded-xl p-4">
                  <h3 className="text-body font-medium text-text-secondary flex items-center gap-2 mb-1">
                    <CalendarClock size={15} /> Yesterday&apos;s plan for today
                  </h3>
                  <p className="text-body text-text-primary whitespace-pre-wrap">{view.previous_planning_tomorrow}</p>
                </div>
              )}

              {isSubmitted && (
                <div className="flex items-center gap-2 text-body text-success font-medium">
                  <CheckCircle2 size={16} /> Submitted{view?.daily_update?.submitted_at ? ` · still editable` : ''}
                </div>
              )}

              {/* Notes */}
              <div className={`${cardCls} p-6`}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-[18px] font-medium text-text-primary">Work notes</h2>
                  <button
                    type="button"
                    onClick={() => setNotes((n) => [...n, { title: '', description: '' }])}
                    className="flex items-center gap-1.5 text-body font-medium text-primary-text hover:text-primary-text"
                  >
                    <Plus size={15} /> Add note
                  </button>
                </div>
                <div className="space-y-4">
                  {notes.map((note, i) => (
                    <div key={i} className="border border-border-light rounded-[10px] p-4 bg-surface-sunken space-y-2">
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
                            className="w-9 h-9 shrink-0 flex items-center justify-center rounded-lg text-text-muted hover:text-danger hover:bg-danger-bg"
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
                  <h2 className="text-[18px] font-medium text-text-primary flex items-center gap-2 mb-1">
                    <Inbox size={17} className="text-primary-text" /> Demanded daily logs
                  </h2>
                  <p className="text-body text-text-secondary mb-4">These were demanded from you — submit them with your update.</p>
                  <div className="space-y-4">
                    {view.folded_demands.map((f) => (
                      <div key={f.submission_id} className="border border-border-light rounded-[10px] p-4 bg-surface-sunken">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-body font-medium text-text-primary">{f.title}</span>
                          {f.status === 'submitted' && (
                            <span className="text-meta font-medium px-2 py-0.5 rounded-full bg-success-bg text-success border border-success-border">
                              Submitted
                            </span>
                          )}
                        </div>
                        {f.description && <p className="text-meta text-text-secondary mb-2">{f.description}</p>}
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
              <div className={`${cardCls} p-6 space-y-4`}>
                <div>
                  <Label className="mb-2">Where I was stuck today</Label>
                  <textarea value={stuck} onChange={(e) => setStuck(e.target.value)} rows={2} className={inputCls} />
                </div>
                <div>
                  <Label className="mb-2 gap-1.5">
                    <Lightbulb size={14} className="text-warning" /> Decisions I took today
                  </Label>
                  <textarea value={decisions} onChange={(e) => setDecisions(e.target.value)} rows={2} className={inputCls} />
                </div>
                <div>
                  <Label className="mb-2">How the overall day was</Label>
                  <textarea value={daySummary} onChange={(e) => setDaySummary(e.target.value)} rows={2} className={inputCls} />
                </div>
                <div>
                  <Label className="mb-2 gap-1.5">
                    <CalendarClock size={14} className="text-primary-text" /> Planning for tomorrow
                  </Label>
                  <textarea value={planning} onChange={(e) => setPlanning(e.target.value)} rows={2} className={inputCls} />
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3">
                {savedFlash && <span className="text-body text-success font-medium">Saved</span>}
                <button
                  type="button"
                  onClick={() => save(false)}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-body font-medium text-primary-text bg-surface border-2 border-primary hover:bg-primary-subtle disabled:opacity-60"
                >
                  <Save size={15} /> Save draft
                </button>
                <button
                  type="button"
                  onClick={() => save(true)}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-body font-medium text-primary-foreground bg-primary hover:bg-primary-hover disabled:bg-surface-control-pressed disabled:text-text-muted"
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
