'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react'

interface DateRangePickerProps {
  from: string // ISO yyyy-mm-dd, '' = unset
  to: string // ISO yyyy-mm-dd, '' = unset
  onChange: (from: string, to: string) => void
  max?: string // ISO yyyy-mm-dd — caps selectable days (e.g. today)
  placeholder?: string
  wrapperClassName?: string
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

// ─── Local-date helpers (avoid UTC off-by-one from toISOString) ─────────────────

function toIso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseIso(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

const fmt = (d: Date, withYear = true) =>
  `${String(d.getDate()).padStart(2, '0')} ${MONTHS_SHORT[d.getMonth()]}${withYear ? ` ${d.getFullYear()}` : ''}`

const addDays = (d: Date, n: number) => {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** Compare by day only; negative if a < b. */
const dayDiff = (a: Date, b: Date) =>
  new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime() -
  new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()

export default function DateRangePicker({
  from,
  to,
  onChange,
  max,
  placeholder = 'Date range',
  wrapperClassName = 'w-full',
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState<Date | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const fromD = useMemo(() => parseIso(from), [from])
  const toD = useMemo(() => parseIso(to), [to])
  const maxD = useMemo(() => (max ? parseIso(max) : null), [max])

  const [view, setView] = useState(() => fromD ?? new Date())
  useEffect(() => {
    if (open) setView(fromD ?? new Date())
  }, [open, fromD])

  const isDisabledDay = (d: Date): boolean => !!(maxD && dayDiff(d, maxD) > 0)

  // Opens as a centered dialog over the page (own backdrop). Being centered &
  // fixed, it never drifts on scroll nor escapes a parent. Close on Escape;
  // outside-click is handled by the backdrop below.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // ── Day grid (6 weeks) ───────────────────────────────────────────────────────
  const grid = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1)
    const start = new Date(first)
    start.setDate(1 - first.getDay())
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      return d
    })
  }, [view])

  const today = new Date()

  // Clicking a day either starts a fresh range or completes the open one.
  const pick = (d: Date) => {
    if (isDisabledDay(d)) return
    if (!fromD || (fromD && toD)) {
      onChange(toIso(d), '')
      setHover(null)
    } else {
      if (dayDiff(d, fromD) < 0) onChange(toIso(d), toIso(fromD))
      else onChange(toIso(fromD), toIso(d))
      setOpen(false)
    }
  }

  // Range highlight follows the committed `to`, or the hovered day while picking.
  const rangeBounds = useMemo(() => {
    if (!fromD) return null
    const end = toD ?? hover
    if (!end) return null
    const lo = dayDiff(fromD, end) <= 0 ? fromD : end
    const hi = dayDiff(fromD, end) <= 0 ? end : fromD
    return { lo, hi }
  }, [fromD, toD, hover])

  const inRange = (d: Date) =>
    !!rangeBounds && dayDiff(d, rangeBounds.lo) >= 0 && dayDiff(d, rangeBounds.hi) <= 0

  const shiftMonth = (delta: number) =>
    setView((v) => new Date(v.getFullYear(), v.getMonth() + delta, 1))

  const presets: { label: string; range: () => [string, string] }[] = [
    { label: 'Today', range: () => [toIso(today), toIso(today)] },
    { label: 'Last 7 days', range: () => [toIso(addDays(today, -6)), toIso(today)] },
    { label: 'Last 30 days', range: () => [toIso(addDays(today, -29)), toIso(today)] },
    { label: 'This month', range: () => [toIso(new Date(today.getFullYear(), today.getMonth(), 1)), toIso(today)] },
    { label: 'This year', range: () => [toIso(new Date(today.getFullYear(), 0, 1)), toIso(today)] },
  ]

  const label = useMemo(() => {
    if (fromD && toD) {
      const sameYear = fromD.getFullYear() === toD.getFullYear()
      return `${fmt(fromD, !sameYear)} – ${fmt(toD)}`
    }
    if (fromD) return `From ${fmt(fromD)}`
    if (toD) return `Until ${fmt(toD)}`
    return placeholder
  }, [fromD, toD, placeholder])

  const hasValue = !!(fromD || toD)

  const triggerCls = `w-full flex items-center gap-0 rounded-[8px] border border-border bg-surface-sunken text-left text-[15px] cursor-pointer transition-colors hover:bg-white hover:border-border-strong ${
    open ? 'bg-white! border-primary! ring-1 ring-primary' : ''
  }`

  return (
    <div ref={wrapRef} className={wrapperClassName}>
      <button type="button" onClick={() => setOpen((o) => !o)} className={triggerCls}>
        <span className="flex items-center px-2.5 py-2.5 border-r border-border-light rounded-l-[8px] text-text-muted">
          <Calendar size={15} />
        </span>
        <span className={`flex-1 px-3 py-2.5 truncate ${hasValue ? 'text-text-primary' : 'text-text-muted'}`}>
          {label}
        </span>
        {hasValue && (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Clear date range"
            onClick={(e) => {
              e.stopPropagation()
              onChange('', '')
            }}
            className="flex items-center px-2.5 text-text-muted hover:text-danger"
          >
            <X size={14} />
          </span>
        )}
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-black/40"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
        >
          <div
            className="w-[340px] max-w-full rounded-[12px] border border-border-light bg-white shadow-[0_12px_40px_rgba(0,0,0,0.20)] p-3"
          >
            {/* Quick presets */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    const [f, t] = p.range()
                    onChange(f, t)
                    setOpen(false)
                  }}
                  className="px-2.5 py-1 rounded-[999px] text-xs font-medium text-text-secondary bg-surface-control hover:bg-primary-subtle hover:text-primary-text transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Month header */}
            <div className="flex items-center justify-between mb-2">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                className="w-8 h-8 rounded-[8px] flex items-center justify-center text-text-secondary hover:bg-surface-control"
                aria-label="Previous month"
              >
                <ChevronLeft size={17} />
              </button>
              <span className="text-sm font-semibold text-text-primary">
                {MONTHS[view.getMonth()]} {view.getFullYear()}
              </span>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                className="w-8 h-8 rounded-[8px] flex items-center justify-center text-text-secondary hover:bg-surface-control"
                aria-label="Next month"
              >
                <ChevronRight size={17} />
              </button>
            </div>

            {/* Weekday labels */}
            <div className="grid grid-cols-7 mb-1">
              {WEEKDAYS.map((w) => (
                <div key={w} className="text-center text-[11px] font-semibold text-text-muted py-1">
                  {w}
                </div>
              ))}
            </div>

            {/* Days */}
            <div className="grid grid-cols-7 gap-y-0.5">
              {grid.map((d, i) => {
                const inMonth = d.getMonth() === view.getMonth()
                const isStart = fromD && sameDay(d, fromD)
                const isEnd = toD && sameDay(d, toD)
                const isEndpoint = isStart || isEnd
                const isToday = sameDay(d, today)
                const off = isDisabledDay(d)
                const within = inRange(d) && !isEndpoint
                return (
                  <div
                    key={i}
                    className={[
                      'h-9 flex items-center justify-center',
                      within ? 'bg-primary-subtle' : '',
                      // Round the band ends.
                      isStart ? 'rounded-l-[8px] bg-primary-subtle' : '',
                      isEnd ? 'rounded-r-[8px] bg-primary-subtle' : '',
                      isStart && isEnd ? 'bg-transparent' : '',
                    ].join(' ')}
                  >
                    <button
                      type="button"
                      disabled={!!off}
                      onClick={() => pick(d)}
                      onMouseEnter={() => fromD && !toD && setHover(d)}
                      className={[
                        'w-9 h-9 rounded-[8px] text-sm flex items-center justify-center transition-colors',
                        off
                          ? 'text-[#CBD5E1] cursor-not-allowed'
                          : isEndpoint
                            ? 'bg-primary text-white font-semibold'
                            : within
                              ? 'text-text-primary'
                              : inMonth
                                ? 'text-text-primary hover:bg-primary-subtle'
                                : 'text-[#CBD5E1] hover:bg-surface-control',
                        !isEndpoint && isToday && !off ? 'ring-1 ring-inset ring-primary' : '',
                      ].join(' ')}
                    >
                      {d.getDate()}
                    </button>
                  </div>
                )
              })}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-border-light">
              <button
                type="button"
                onClick={() => {
                  onChange('', '')
                  setOpen(false)
                }}
                className="text-xs font-semibold text-text-muted hover:text-text-primary px-2 py-1"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-xs font-semibold text-primary-text hover:text-primary-text px-2 py-1"
              >
                Done
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
