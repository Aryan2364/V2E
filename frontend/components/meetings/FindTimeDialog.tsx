'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Info, Loader2, Check, Sparkles } from 'lucide-react'
import { meetingsApi } from '@/lib/api/meetings'
import type { BusyView } from '@/lib/types/meetings'
import DatePicker from '@/components/ui/DatePicker'
import MeetingAttendeeSelector, { type PersonOption } from './MeetingAttendeeSelector'
import Tooltip from '@/components/ui/tooltip'
import { DurationField } from './shared'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody } from '@/components/ui/dialog'

// geometry
const START_HOUR = 6
const END_HOUR = 22
const PX_PER_HOUR = 44
const RANGE_MIN = (END_HOUR - START_HOUR) * 60
const GRID_PX = (END_HOUR - START_HOUR) * PX_PER_HOUR
const SNAP = 15
// Above this many participants, per-person columns get unreadable — switch to an
// aggregate busy-density heatmap + a vertical who's-free list instead.
const AGG_LIMIT = 8
const BUCKET = 15 // minutes per heatmap cell

/** Shade a heatmap cell: 0 busy = light green (free), scaling to red as more are busy. */
function densityColor(busy: number, total: number): string {
  if (total === 0) return 'transparent'
  if (busy === 0) return 'color-mix(in srgb, var(--success) 12%, transparent)'
  const f = busy / total
  return `color-mix(in srgb, var(--danger) ${Math.round((0.14 + f * 0.5) * 100)}%, transparent)`
}

function pad(n: number) { return String(n).padStart(2, '0') }
const todayStr = () => new Date().toISOString().slice(0, 10)
function minLabel(min: number): string {
  const h = Math.floor(min / 60), m = min % 60
  const ap = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${pad(m)} ${ap}`
}
function topFor(min: number) { return ((min - START_HOUR * 60) / 60) * PX_PER_HOUR }
function overlaps(aS: number, aE: number, bS: number, bE: number) { return aS < bE && bS < aE }

interface Props {
  orgId: string
  people: PersonOption[]
  attendees: string[]
  optional: string[]
  date: string // yyyy-mm-dd
  durationMin: number
  initialStartMin?: number
  onChangeAttendees: (ids: string[]) => void
  onChangeOptional: (ids: string[]) => void
  onChangeDate: (date: string) => void
  onChangeDuration: (min: number) => void
  onConfirm: (startIso: string, endIso: string) => void
  onClose: () => void
}


export default function FindTimeDialog({
  orgId, people, attendees, optional, date, durationMin, initialStartMin,
  onChangeAttendees, onChangeOptional, onChangeDate, onChangeDuration, onConfirm, onClose,
}: Props) {
  const [data, setData] = useState<BusyView | null>(null)
  const [loading, setLoading] = useState(false)
  const [cand, setCand] = useState<number>(() => initialStartMin ?? 10 * 60)
  const colsRef = useRef<HTMLDivElement>(null)

  useEffect(() => { const t = setTimeout(() => scrollToMin(cand), 80); return () => clearTimeout(t) }, [])

  const requiredIds = useMemo(() => attendees.filter((a) => !optional.includes(a)), [attendees, optional])
  const dayStartMs = useMemo(() => new Date(`${date}T00:00`).getTime(), [date])

  // fetch busy for the day whenever the inputs change
  useEffect(() => {
    if (!orgId || attendees.length === 0 || !date) { setData(null); return }
    let active = true
    setLoading(true)
    meetingsApi
      .busy(orgId, {
        user_ids: attendees,
        required_user_ids: requiredIds,
        from: new Date(`${date}T00:00`).toISOString(),
        to: new Date(`${date}T23:59`).toISOString(),
        duration_min: durationMin,
      })
      .then((r) => { if (active) setData(r) })
      .catch(() => { if (active) setData(null) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [orgId, attendees.join(','), requiredIds.join(','), date, durationMin])

  const candEnd = Math.min(END_HOUR * 60, cand + durationMin)

  // per-person busy blocks (in minutes of the day) + conflict flags at candidate slot
  const perPerson = useMemo(() => {
    if (!data) return []
    return data.people.map((p) => {
      const blocks = p.busy.map((b) => {
        const s = Math.max(0, Math.round((new Date(b.start).getTime() - dayStartMs) / 60000))
        const e = Math.min(24 * 60, Math.round((new Date(b.end).getTime() - dayStartMs) / 60000))
        return { s, e, kind: b.kind, label: b.label }
      })
      const conflict = blocks.some((b) => overlaps(cand, candEnd, b.s, b.e))
      return { ...p, blocks, conflict }
    })
  }, [data, dayStartMs, cand, candEnd])

  const clashes = useMemo(() => {
    const hard = perPerson.filter((p) => p.required && p.conflict).map((p) => p.name)
    const soft = perPerson.filter((p) => !p.required && p.conflict).map((p) => p.name)
    return { hard, soft }
  }, [perPerson])

  // Aggregate view kicks in for large groups: per 15-min cell, how many are busy.
  const useAgg = perPerson.length > AGG_LIMIT
  const buckets = useMemo(() => {
    if (!useAgg) return []
    const n = Math.ceil(RANGE_MIN / BUCKET)
    return Array.from({ length: n }, (_, i) => {
      const min = START_HOUR * 60 + i * BUCKET
      const end = min + BUCKET
      let busy = 0
      for (const p of perPerson) if (p.blocks.some((b) => overlaps(min, end, b.s, b.e))) busy++
      return { min, busy }
    })
  }, [useAgg, perPerson])

  function toggleOptional(id: string) {
    onChangeOptional(optional.includes(id) ? optional.filter((x) => x !== id) : [...optional, id])
  }
  function setCandFromY(clientY: number) {
    const el = colsRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const y = clientY - rect.top + el.scrollTop
    let mins = START_HOUR * 60 + Math.round((y / PX_PER_HOUR) * 60 / SNAP) * SNAP
    mins = Math.max(START_HOUR * 60, Math.min(END_HOUR * 60 - durationMin, mins))
    setCand(mins)
  }
  // Scroll the grid so the given minute sits vertically centered (e.g. after
  // picking a best-time that's off-screen from the current view).
  function scrollToMin(min: number) {
    const el = colsRef.current
    if (!el) return
    const target = topFor(min) - el.clientHeight / 2 + (durationMin / 60) * PX_PER_HOUR / 2
    el.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
  }

  function shiftDay(dir: -1 | 1) {
    const d = new Date(`${date}T00:00`); d.setDate(d.getDate() + dir)
    onChangeDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
  }
  function confirm() {
    const d = new Date(`${date}T00:00`); d.setMinutes(cand)
    const end = new Date(d.getTime() + durationMin * 60000)
    onConfirm(d.toISOString(), end.toISOString())
  }

  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i)
  const cols = perPerson.length || 1

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent
        size="lg"
        className="h-dvh max-h-dvh w-screen max-w-none rounded-none data-[size=lg]:max-w-none"
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Sparkles size={18} />
            <DialogTitle>Find a time</DialogTitle>
          </div>
        </DialogHeader>
        <DialogBody className="flex flex-col overflow-hidden p-0">
      <div className="w-full flex-1 min-h-0 bg-surface flex flex-col overflow-hidden">
        {/* day navigation */}
        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border-light">
          <Tooltip label="Previous day">
            <Button variant="ghost" size="icon" aria-label="Previous day" onClick={() => shiftDay(-1)}><ChevronLeft size={18} /></Button>
          </Tooltip>
          <DatePicker value={date} onChange={onChangeDate} min={todayStr()} placeholder="Pick a date" bare hideClear />
          <Tooltip label="Next day">
            <Button variant="ghost" size="icon" aria-label="Next day" onClick={() => shiftDay(1)}><ChevronRight size={18} /></Button>
          </Tooltip>
          <Button variant="secondary" size="sm" onClick={() => onChangeDate(todayStr())}>Today</Button>
        </div>

        {/* duration */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border-light">
          <DurationField value={durationMin} onChange={onChangeDuration} label="Duration" inline />
          {loading && <Loader2 size={15} className="animate-spin text-text-muted ml-1" />}
        </div>

        <div className="flex flex-1 min-h-0">
          {/* left rail */}
          <aside className="w-[300px] shrink-0 border-r border-border-light overflow-y-auto p-4 flex flex-col gap-4">
            <div>
              <Label className="mb-2">Participants</Label>
              <MeetingAttendeeSelector options={people} value={attendees} onChange={onChangeAttendees} optional={optional} onToggleOptional={toggleOptional} />
            </div>

            {/* best times */}
            <div>
              <p className="text-meta font-medium text-text-secondary mb-2">Best times</p>
              {!data || data.suggestions.length === 0 ? (
                <p className="text-body text-text-muted">{attendees.length === 0 ? 'Add people to see suggestions.' : 'No clear slot on this day — try another day or trim the guest list.'}</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {data.suggestions.slice(0, 6).map((s, i) => {
                    const clean = s.hard_conflicts.length === 0
                    const sMin = Math.round((new Date(s.start).getTime() - dayStartMs) / 60000)
                    return (
                      <button
                        key={i}
                        onClick={() => { const c = Math.max(START_HOUR * 60, Math.min(END_HOUR * 60 - durationMin, sMin)); setCand(c); scrollToMin(c) }}
                        className="flex items-center justify-between gap-2 text-left border rounded-lg px-3 py-2 hover:border-primary"
                        style={{ borderColor: clean ? 'var(--success-bg)' : 'var(--warning-bg)', background: clean ? 'var(--success-bg)' : 'var(--warning-bg)' }}
                      >
                        <span className="text-body text-text-primary">{minLabel(sMin)}</span>
                        <span className="text-meta" style={{ color: clean ? 'var(--success)' : 'var(--warning)' }}>
                          {clean ? 'No required clashes' : `${s.hard_conflicts.length} required`}
                          {s.soft_conflicts.length > 0 ? ` · ${s.soft_conflicts.length} optional` : ''}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Who's free at the selected slot — vertical list scales to any headcount */}
            {useAgg && perPerson.length > 0 && (
              <div>
                <p className="text-meta font-medium text-text-secondary mb-2">At {minLabel(cand)} – {minLabel(candEnd)}</p>
                <div className="flex flex-col gap-1 max-h-[240px] overflow-y-auto pr-1">
                  {[...perPerson].sort((a, b) => Number(b.conflict) - Number(a.conflict)).map((p) => (
                    <div key={p.user_id} className="flex items-center gap-2 text-body">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.conflict ? 'var(--danger)' : 'var(--success)' }} />
                      <span className="text-text-primary truncate">{p.name}</span>
                      {!p.required && <span className="text-meta text-text-muted">optional</span>}
                      <span className="ml-auto text-meta shrink-0" style={{ color: p.conflict ? 'var(--danger)' : 'var(--success)' }}>{p.conflict ? 'Busy' : 'Free'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-start gap-2 text-meta text-text-secondary bg-surface-sunken border border-border-light rounded-lg px-3 py-2">
              <Info size={14} className="mt-0.5 shrink-0 text-text-muted" />
              <span>{data?.caveat ?? 'Shows only meetings, leave and holidays this app knows about — not a guarantee someone is free.'}</span>
            </div>
          </aside>

          {/* grid */}
          <div className="flex-1 min-w-0 flex flex-col p-4 gap-3">
            {/* candidate summary + confirm */}
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 border border-border-light rounded-[10px] bg-surface-sunken shrink-0">
              <div className="text-body">
                <span className="font-medium text-text-primary">{minLabel(cand)} – {minLabel(candEnd)}</span>
                {clashes.hard.length === 0 && clashes.soft.length === 0 ? (
                  <span className="ml-2 text-success">Everyone’s free</span>
                ) : (
                  <span className="ml-2 text-text-secondary">
                    {clashes.hard.length > 0 && <span className="text-warning font-medium">Clashes: {clashes.hard.join(', ')}</span>}
                    {clashes.hard.length > 0 && clashes.soft.length > 0 && ' · '}
                    {clashes.soft.length > 0 && <span className="text-text-muted">optional: {clashes.soft.join(', ')}</span>}
                  </span>
                )}
              </div>
              <Button variant="primary" onClick={confirm}>
                <Check size={15} /> Use this time
              </Button>
            </div>

            {/* calendar card — rounded like the week view; header + body reserve a stable
                scrollbar gutter so columns align and the scrollbar sits below the header */}
            <div className="flex-1 min-h-0 flex flex-col border border-border-light rounded-xl overflow-hidden">
            {/* column headers */}
            <div className="flex border-b border-primary-hover bg-primary overflow-hidden" style={{ scrollbarGutter: 'stable' }}>
              <div className="w-[54px] shrink-0 border-r border-white/20" />
              <div className="flex-1 min-w-0">
                {perPerson.length === 0 ? (
                  <div className="py-2 text-center text-body text-primary-foreground">Add participants to see availability</div>
                ) : useAgg ? (
                  <div className="py-2.5 px-3 flex items-center justify-center gap-4 text-primary-foreground flex-wrap">
                    <span className="text-[13px] font-medium">Team availability · {perPerson.length} people</span>
                    <span className="flex items-center gap-3 text-meta">
                      <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: 'color-mix(in srgb, var(--success) 50%, transparent)' }} /> all free</span>
                      <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: 'color-mix(in srgb, var(--danger) 60%, transparent)' }} /> most busy</span>
                    </span>
                  </div>
                ) : (
                  <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(80px,1fr))` }}>
                    {perPerson.map((p) => (
                      <div key={p.user_id} className="py-1.5 px-2 text-center border-r border-white/20 last:border-r-0">
                        <div className="text-[13px] font-medium text-primary-foreground truncate">{p.name.split(' ')[0]}</div>
                        <div className="flex items-center justify-center gap-1 mt-0.5">
                          <span className="text-meta text-primary-foreground">{p.required ? 'Required' : 'Optional'}</span>
                          {p.conflict && <span className="w-1.5 h-1.5 rounded-full" style={{ background: p.required ? 'var(--warning-border)' : 'color-mix(in srgb, white 60%, transparent)' }} />}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* scrollable grid body */}
            <div ref={colsRef} className="flex-1 overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
              <div className="flex relative" style={{ height: GRID_PX }}>
                {/* time rail */}
                <div className="w-[54px] shrink-0 border-r border-border-light relative">
                  {hours.map((h) => (
                    <div key={h} className="absolute right-1.5 -translate-y-1/2 text-meta font-medium text-text-secondary" style={{ top: topFor(h * 60) }}>
                      {h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h - 12} PM`}
                    </div>
                  ))}
                </div>
                {/* person columns */}
                <div
                  className="flex-1 relative cursor-pointer"
                  onClick={(e) => setCandFromY(e.clientY)}
                >
                  {/* hour lines */}
                  {hours.map((h) => (
                    <div key={h} className="absolute left-0 right-0 border-t border-border pointer-events-none" style={{ top: topFor(h * 60) }} />
                  ))}
                  {useAgg ? (
                    /* Large group → busy-density heatmap: darker = more people busy */
                    buckets.map((b) => (
                      <Tooltip key={b.min} label={`${b.busy} of ${perPerson.length} busy`}>
                      <div
                        className="absolute left-0 right-0 pointer-events-none"
                        style={{ top: topFor(b.min), height: (BUCKET / 60) * PX_PER_HOUR, background: densityColor(b.busy, perPerson.length) }}
                      />
                      </Tooltip>
                    ))
                  ) : (
                    <div className="grid absolute inset-0" style={{ gridTemplateColumns: `repeat(${cols}, minmax(80px,1fr))` }}>
                      {perPerson.map((p) => (
                        <div key={p.user_id} className="relative border-r border-border-light last:border-r-0">
                          {p.blocks.map((b, i) => {
                            const isOOO = b.kind === 'leave' || b.kind === 'holiday'
                            const bg = isOOO ? 'color-mix(in srgb, var(--text-muted) 16%, transparent)' : p.required ? 'color-mix(in srgb, var(--danger) 14%, transparent)' : 'color-mix(in srgb, var(--warning) 14%, transparent)'
                            const bd = isOOO ? 'var(--text-muted)' : p.required ? 'var(--danger)' : 'var(--warning)'
                            return (
                              <Tooltip key={i} label={`${p.name} · busy`}>
                              <div
                                className="absolute left-0.5 right-0.5 rounded-[4px] border-l-2 pointer-events-none overflow-hidden"
                                style={{ top: topFor(b.s), height: Math.max(6, ((b.e - b.s) / 60) * PX_PER_HOUR), background: bg, borderLeftColor: bd }}
                              >
                                {isOOO && <span className="text-meta text-text-secondary px-1 leading-tight">{b.kind === 'leave' ? 'Leave' : 'Holiday'}</span>}
                              </div>
                              </Tooltip>
                            )
                          })}
                        </div>
                      ))}
                    </div>
                  )}
                  {/* candidate band across all columns — min height so a 15-min slot stays readable */}
                  <div
                    className="absolute left-0 right-0 pointer-events-none z-10"
                    style={{ top: topFor(cand), height: Math.max(20, (durationMin / 60) * PX_PER_HOUR) }}
                  >
                    <div className="h-full mx-0.5 rounded-[6px] border-2 border-primary bg-primary/15 flex items-center justify-center">
                      <span className="text-meta font-medium text-primary-text whitespace-nowrap">{minLabel(cand)} – {minLabel(candEnd)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            </div>
          </div>
        </div>
      </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
