'use client'

import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Play } from 'lucide-react'
import { WEEKDAYS_SHORT, fmtTime } from './format'
import { weekPosition } from './timing'
import { dateOfDayNumber, dayNumber, eventsOn, type CalendarSpan, type DayEvent, type PlanContext } from './timingPlan'

// The timing calendar: where a step's day is picked, with the whole sample run on view —
// the run start (▶), every other step's planned start → due as a light band (the steps
// this one waits for striped and named), what each day holds on hover / focus / tap, and
// the days it may not use greyed out with the reason. ◀ ▶ step through the run's weeks /
// months; a day picked in Month 2 is stored as Month 2 (an explicit cycle).

/** Band colours — the kit's categorical chart sequence (positions 2–6; position 1 is
 * the brand, which here means "selected"). Cycled when there are more steps. */
export const BAND_COLORS = ['#C2841D', '#3B5A9A', '#A34A5E', '#6FA8A4', '#7A7268']
export const bandColor = (i: number) => BAND_COLORS[((i % BAND_COLORS.length) + BAND_COLORS.length) % BAND_COLORS.length]

/** A band's fill: light for a step, striped for one this step waits for (never colour alone). */
export function bandFill(i: number, waitsFor: boolean): string {
  const c = bandColor(i)
  return waitsFor ? `repeating-linear-gradient(135deg, ${c} 0 3px, ${c}66 3px 6px)` : `${c}5c`
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MAX_BARS = 3

type Unit = 'Week' | 'Month' | 'Year'

const monthIdxOf = (dayNo: number) => {
  const d = dateOfDayNumber(dayNo)
  return d.getUTCFullYear() * 12 + d.getUTCMonth()
}
const firstDayOfMonth = (idx: number) => dayNumber(new Date(Date.UTC(Math.floor(idx / 12), idx % 12, 1)))
const daysInMonthIdx = (idx: number) => new Date(Date.UTC(Math.floor(idx / 12), (idx % 12) + 1, 0)).getUTCDate()
const dow = (dayNo: number) => dateOfDayNumber(dayNo).getUTCDay()

/** "Thu 5 Nov" (+ year when it isn't the run's). */
export function dayWords(dayNo: number, refYear: number): string {
  const d = dateOfDayNumber(dayNo)
  const y = d.getUTCFullYear()
  return `${WEEKDAYS_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}${y !== refYear ? ` ${y}` : ''}`
}

/** "1 Collect documents — due 6:00 PM", "▶ Run starts — 9:00 AM". */
export function eventText(e: DayEvent, runTime: string): string {
  if (!e.span) return `▶ Run starts — ${runTime}`
  const name = `${e.span.label} ${e.span.title.trim() || 'Untitled step'}`
  const t = (d: Date) => fmtTime(`${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`)
  switch (e.what) {
    case 'start':
      return `${name} — starts ${t(e.span.start)}`
    case 'due':
      return `${name} — due ${t(e.span.due)}`
    case 'start_due':
      return `${name} — starts ${t(e.span.start)}, due ${t(e.span.due)}`
    default:
      return `${name} — under way`
  }
}

export interface TimingCalendarProps {
  /** Its accessible name ("Start day", "Due day"). */
  label: string
  /** How it pages: Week (a week strip), Month (one month per page), Year (months across years). */
  unit: Unit
  ctx: PlanContext
  /** The furthest cycle it reaches (8 weeks, 12 months, 3 years — or the interval). */
  maxCycle: number
  /** The day the rule stands on (floating day number), or null. */
  selected: number | null
  /** Days before this one are greyed out (`minReason` says why). */
  minDay: number | null
  minReason: string | null
  /** The other steps' planned spans. */
  spans: CalendarSpan[]
  onPick: (dayNo: number) => void
  disabled?: boolean
  /** Monthly: "Last day" — the month's last day, whatever its length. */
  lastDay?: { selected: boolean; onPick: (cycle: number) => void } | null
  /** This step on its own day, for the details ("This step — starts 9:00 AM"). */
  selfText?: string | null
}

export default function TimingCalendar({
  label,
  unit,
  ctx,
  maxCycle,
  selected,
  minDay,
  minReason,
  spans,
  onPick,
  disabled,
  lastDay,
  selfText,
}: TimingCalendarProps) {
  const uid = useId()
  const run = ctx.runStart
  const runDay = dayNumber(run)
  const runYear = run.getUTCFullYear()
  const runTime = fmtTime(`${String(run.getUTCHours()).padStart(2, '0')}:${String(run.getUTCMinutes()).padStart(2, '0')}`)
  const runWeekStart = runDay - weekPosition(dow(runDay))
  const runMonth = monthIdxOf(runDay)
  const cycles = Math.max(1, maxCycle)

  // Pages: week offsets (Week), or absolute month indexes (Month: the run's month on;
  // Year: January of the run's year to December of its last year).
  const [minPage, maxPage] =
    unit === 'Week' ? [0, cycles - 1] : unit === 'Month' ? [runMonth, runMonth + cycles - 1] : [runYear * 12, (runYear + cycles - 1) * 12 + 11]
  const pageOf = (dayNo: number) => (unit === 'Week' ? Math.floor((dayNo - runWeekStart) / 7) : monthIdxOf(dayNo))
  const clampPage = (p: number) => Math.min(maxPage, Math.max(minPage, p))
  const firstDay = unit === 'Week' ? runWeekStart : firstDayOfMonth(minPage)
  const lastDayNo = unit === 'Week' ? runWeekStart + 7 * cycles - 1 : firstDayOfMonth(maxPage) + daysInMonthIdx(maxPage) - 1
  const inRange = (dayNo: number) => dayNo >= firstDay && dayNo <= lastDayNo

  const home = selected !== null && inRange(selected) ? selected : minDay !== null && inRange(minDay) ? minDay : runDay
  const [page, setPage] = useState(() => clampPage(pageOf(home)))
  // A day picked elsewhere (a kind switched, a schedule changed) is brought into view.
  useEffect(() => {
    if (selected !== null && inRange(selected)) setPage((p) => (pageOf(selected) === p ? p : clampPage(pageOf(selected))))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, unit, runDay, cycles])

  const [inspect, setInspect] = useState<number | null>(null)
  const [focusDay, setFocusDay] = useState<number | null>(null)
  const wantFocus = useRef(false)
  const gridRef = useRef<HTMLDivElement | null>(null)

  // The page's days (null = a blank before the 1st).
  const cells = useMemo<(number | null)[]>(() => {
    if (unit === 'Week') {
      const start = runWeekStart + 7 * page
      return Array.from({ length: 7 }, (_, i) => start + i)
    }
    const first = firstDayOfMonth(page)
    const lead = weekPosition(dow(first))
    return [...Array.from({ length: lead }, () => null), ...Array.from({ length: daysInMonthIdx(page) }, (_, i) => first + i)]
  }, [unit, page, runWeekStart])
  const days = cells.filter((c): c is number => c !== null)

  const greyed = (dayNo: number) => minDay !== null && dayNo < minDay
  const tabDay = focusDay !== null && days.includes(focusDay) ? focusDay : selected !== null && days.includes(selected) ? selected : (days.find((d) => !greyed(d)) ?? days[0])

  useEffect(() => {
    if (!wantFocus.current || focusDay === null) return
    wantFocus.current = false
    gridRef.current?.querySelector<HTMLElement>(`[data-day="${focusDay}"]`)?.focus()
  }, [focusDay, page])

  const cycleOfPage = (p: number) =>
    unit === 'Week' ? p + 1 : unit === 'Month' ? p - runMonth + 1 : Math.floor(p / 12) - runYear + 1
  const title = (() => {
    if (unit === 'Week') {
      const a = dateOfDayNumber(runWeekStart + 7 * page)
      const b = dateOfDayNumber(runWeekStart + 7 * page + 6)
      const span =
        a.getUTCMonth() === b.getUTCMonth()
          ? `${a.getUTCDate()}–${b.getUTCDate()} ${MONTHS_SHORT[b.getUTCMonth()]}`
          : `${a.getUTCDate()} ${MONTHS_SHORT[a.getUTCMonth()]} – ${b.getUTCDate()} ${MONTHS_SHORT[b.getUTCMonth()]}`
      return `Week ${page + 1} · ${span}${b.getUTCFullYear() !== runYear ? ` ${b.getUTCFullYear()}` : ''}`
    }
    const y = Math.floor(page / 12)
    const m = MONTHS_SHORT[page % 12]
    return `${unit} ${cycleOfPage(page)} · ${m}${unit === 'Year' || y !== runYear ? ` ${y}` : ''}`
  })()
  const noun = unit === 'Week' ? 'week' : 'month'

  const go = (delta: number) => setPage((p) => clampPage(p + delta))

  /** Move the keyboard focus to `dayNo` (turning the page when it is on another one). */
  const moveTo = (dayNo: number) => {
    if (!inRange(dayNo)) return
    wantFocus.current = true
    setFocusDay(dayNo)
    setInspect(dayNo)
    const p = pageOf(dayNo)
    if (p !== page) setPage(clampPage(p))
  }

  const pick = (dayNo: number) => {
    if (disabled) return
    if (greyed(dayNo)) {
      setInspect(dayNo)
      return
    }
    onPick(dayNo)
  }

  const onKey = (e: React.KeyboardEvent, dayNo: number) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
    if (e.key in step) {
      e.preventDefault()
      moveTo(dayNo + step[e.key])
    } else if (e.key === 'Home') {
      e.preventDefault()
      moveTo(dayNo - weekPosition(dow(dayNo)))
    } else if (e.key === 'End') {
      e.preventDefault()
      moveTo(dayNo + 6 - weekPosition(dow(dayNo)))
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault()
      const target = unit === 'Week' ? dayNo + (e.key === 'PageUp' ? -7 : 7) : (() => {
        const d = dateOfDayNumber(dayNo)
        const idx = d.getUTCFullYear() * 12 + d.getUTCMonth() + (e.key === 'PageUp' ? -1 : 1)
        return firstDayOfMonth(idx) + Math.min(d.getUTCDate(), daysInMonthIdx(idx)) - 1
      })()
      moveTo(target)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      pick(dayNo)
    }
  }

  // What the details line shows: the day under the pointer / focus, else the picked day.
  const shown = inspect ?? (selected !== null && inRange(selected) ? selected : null)
  const shownEvents = shown !== null ? eventsOn(shown, spans, run) : []

  const rows: (number | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))
  if (rows.length) while (rows[rows.length - 1].length < 7) rows[rows.length - 1].push(null)

  const navBtn =
    'inline-flex items-center justify-center w-11 h-11 rounded-[8px] text-[#334155] hover:bg-[#F1F5F9] hover:text-[#0F172A] transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] disabled:text-[#CBD5E1] disabled:hover:bg-transparent disabled:cursor-not-allowed'

  const cellFor = (dayNo: number) => {
    const isSel = selected === dayNo
    const grey = greyed(dayNo)
    const evs = eventsOn(dayNo, spans, run)
    const bars = evs.filter((e) => e.span) as (DayEvent & { span: CalendarSpan })[]
    const isRun = dayNo === runDay
    const d = dateOfDayNumber(dayNo)
    const name = `${dayWords(dayNo, runYear)}${isSel ? ', selected' : ''}${grey && minReason ? `. ${minReason}` : ''}${
      evs.length ? `. ${evs.map((e) => eventText(e, runTime)).join('. ')}` : ''
    }`
    return (
      <div
        key={dayNo}
        role="gridcell"
        data-day={dayNo}
        tabIndex={dayNo === tabDay ? 0 : -1}
        aria-selected={isSel}
        aria-disabled={grey || disabled || undefined}
        aria-label={name}
        onClick={() => pick(dayNo)}
        onKeyDown={(e) => onKey(e, dayNo)}
        onMouseEnter={() => setInspect(dayNo)}
        onFocus={() => {
          setFocusDay(dayNo)
          setInspect(dayNo)
        }}
        className={`relative flex flex-col items-stretch ${unit === 'Week' ? 'min-h-[52px]' : 'min-h-[46px]'} pt-1 pb-1 select-none outline-none rounded-[6px] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2563EB] ${
          grey ? 'cursor-not-allowed bg-[#F8FAFC]' : disabled ? 'cursor-default' : 'cursor-pointer hover:bg-[#EFF6FF]'
        } ${inspect === dayNo && !isSel ? 'bg-[#F1F5F9]' : ''}`}
      >
        {isRun && (
          <Play
            size={9}
            aria-hidden
            className="absolute top-1 left-1 text-[#0F172A] fill-[#0F172A]"
          />
        )}
        <span className="flex justify-center">
          <span
            className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-[13px] tabular-nums ${
              isSel
                ? 'bg-[#2563EB] text-white font-semibold'
                : grey
                  ? 'text-[#64748B] line-through decoration-[#94A3B8]'
                  : 'text-[#0F172A] font-medium'
            }`}
          >
            {d.getUTCDate()}
          </span>
        </span>
        <span aria-hidden className="mt-auto flex flex-col gap-[2px]">
          {bars.slice(0, MAX_BARS).map((b) => {
            const startHere = dayNumber(b.span.start) === dayNo
            const dueHere = dayNumber(b.span.due) === dayNo
            return (
              <span
                key={b.span.id}
                className={`block h-[4px] ${startHere ? 'ml-1 rounded-l-full' : ''} ${dueHere ? 'mr-1 rounded-r-full' : ''}`}
                style={{ background: bandFill(b.span.color, b.span.waitsFor) }}
              />
            )
          })}
          {bars.length > MAX_BARS && <span className="block h-[4px] mx-auto w-1 rounded-full bg-[#475569]" />}
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div className="rounded-[10px] border border-[#E2E8F0] bg-white p-1.5 sm:p-2">
        {/* Header: ◀ Month 2 · Dec ▶ */}
        <div className="flex items-center justify-between gap-1 mb-1">
          <button type="button" aria-label={`Previous ${noun}`} onClick={() => go(-1)} disabled={page <= minPage} className={navBtn}>
            <ChevronLeft size={18} />
          </button>
          <span id={`${uid}-title`} aria-live="polite" className="text-sm font-semibold text-[#0F172A] tabular-nums text-center">
            {title}
          </span>
          <button type="button" aria-label={`Next ${noun}`} onClick={() => go(1)} disabled={page >= maxPage} className={navBtn}>
            <ChevronRight size={18} />
          </button>
        </div>

        <div
          ref={gridRef}
          role="grid"
          aria-label={`${label}, ${title}`}
          aria-describedby={`${uid}-details`}
          onMouseLeave={() => setInspect(null)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setInspect(null)
          }}
        >
          <div role="row" className="grid grid-cols-7">
            {[1, 2, 3, 4, 5, 6, 0].map((w) => (
              <span key={w} role="columnheader" aria-label={WEEKDAYS_SHORT[w]} className="text-center text-[12px] font-medium text-[#475569] py-1">
                {WEEKDAYS_SHORT[w].slice(0, 2)}
              </span>
            ))}
          </div>
          {rows.map((r, i) => (
            <div key={i} role="row" className="grid grid-cols-7">
              {r.map((c, j) => (c === null ? <span key={`b${j}`} role="gridcell" aria-hidden className="min-h-[46px]" /> : cellFor(c)))}
            </div>
          ))}
        </div>

        {lastDay && unit === 'Month' && (
          <div className="mt-1.5 flex">
            <button
              type="button"
              aria-pressed={lastDay.selected && selected !== null && pageOf(selected) === page}
              disabled={disabled || (minDay !== null && firstDayOfMonth(page) + daysInMonthIdx(page) - 1 < minDay)}
              onClick={() => lastDay.onPick(cycleOfPage(page))}
              className={`min-h-[44px] sm:min-h-[36px] px-3 rounded-[8px] border text-[13px] font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] disabled:cursor-not-allowed disabled:bg-[#F8FAFC] disabled:text-[#64748B] disabled:border-[#E2E8F0] ${
                lastDay.selected && selected !== null && pageOf(selected) === page
                  ? 'bg-[#2563EB] border-[#2563EB] text-white'
                  : 'bg-white border-[#CBD5E1] text-[#334155] hover:border-[#2563EB] hover:text-[#1D4ED8]'
              }`}
            >
              Last day of {MONTHS_SHORT[page % 12]}
            </button>
          </div>
        )}
      </div>

      {/* What happens on the day under the pointer / focus (else the picked day). */}
      <div id={`${uid}-details`} aria-live="polite" className="min-h-[44px] rounded-[8px] bg-[#F8FAFC] border border-[#E2E8F0] px-3 py-2 text-[13px] text-[#1E293B]">
        {shown === null ? (
          <span className="text-[#475569]">Point at a day to see what happens then.</span>
        ) : (
          <>
            <span className="font-semibold text-[#0F172A]">{dayWords(shown, runYear)}</span>
            {greyed(shown) && minReason && <span className="text-[#475569]"> · {minReason}</span>}
            <ul className="mt-0.5 flex flex-col gap-0.5">
              {shown === selected && selfText && <li className="font-medium text-[#1D4ED8]">{selfText}</li>}
              {shownEvents.map((e, i) => (
                <li key={i} className="flex items-center gap-1.5 min-w-0">
                  {e.span ? (
                    <span aria-hidden className="w-2.5 h-2.5 rounded-[2px] shrink-0" style={{ background: bandFill(e.span.color, e.span.waitsFor) }} />
                  ) : null}
                  <span className="min-w-0 break-words">{eventText(e, runTime)}</span>
                </li>
              ))}
              {shownEvents.length === 0 && !(shown === selected && selfText) && <li className="text-[#475569]">Nothing else planned.</li>}
            </ul>
          </>
        )}
      </div>

      {/* Legend */}
      <ul aria-label="Legend" className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-[#334155]">
        <li className="inline-flex items-center gap-1">
          <Play size={9} aria-hidden className="text-[#0F172A] fill-[#0F172A]" /> Run starts
        </li>
        {spans.map((s) => (
          <li key={s.id} className="inline-flex items-center gap-1 min-w-0 max-w-full">
            <span aria-hidden className="w-3 h-2.5 rounded-[2px] shrink-0" style={{ background: bandFill(s.color, s.waitsFor) }} />
            <span className={`truncate ${s.waitsFor ? 'font-semibold text-[#0F172A]' : ''}`}>
              {s.label} {s.title.trim() || 'Untitled step'}
              {s.waitsFor ? ' (waits for)' : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
