'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react'
import Tooltip from '@/components/ui/Tooltip'

interface DatePickerProps {
  value: string // ISO yyyy-mm-dd, '' = empty
  onChange: (iso: string) => void
  placeholder?: string
  min?: string // ISO yyyy-mm-dd
  max?: string // ISO yyyy-mm-dd
  disabled?: boolean
  id?: string
  /** ISO yyyy-mm-dd days to flag with an amber dot (e.g. a selected assignee is on leave). */
  markedDates?: string[]
  /** Tooltip shown on marked days. */
  markedHint?: string
  /** Tighter vertical padding + smaller font for dense inline rows. */
  compact?: boolean
  /** Hide the inline clear (✕) button even when a date is selected. */
  hideClear?: boolean
  /** Borderless toolbar-style trigger (no box/fill) — just calendar icon + date text. */
  bare?: boolean
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

/** Parse 'yyyy-mm-dd' into a LOCAL Date (midnight), or null. */
function parseIso(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

function formatDisplay(iso: string): string {
  const d = parseIso(iso)
  if (!d) return ''
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** Compare by day only; returns negative if a < b. */
const dayDiff = (a: Date, b: Date) =>
  new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime() -
  new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()

export default function DatePicker({
  value,
  onChange,
  placeholder = 'Select date',
  min,
  max,
  disabled,
  id,
  markedDates,
  markedHint,
  compact = false,
  hideClear = false,
  bare = false,
}: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const markedSet = useMemo(() => new Set(markedDates ?? []), [markedDates])
  const [mode, setMode] = useState<'days' | 'years'>('days')
  const wrapRef = useRef<HTMLDivElement>(null)

  const selected = useMemo(() => parseIso(value), [value])
  const minD = useMemo(() => (min ? parseIso(min) : null), [min])
  const maxD = useMemo(() => (max ? parseIso(max) : null), [max])

  // The month currently shown in the grid.
  const [view, setView] = useState(() => selected ?? new Date())
  useEffect(() => {
    if (open) {
      setView(selected ?? new Date())
      setMode('days')
    }
  }, [open, selected])

  const isDisabledDay = (d: Date): boolean =>
    !!((minD && dayDiff(d, minD) < 0) || (maxD && dayDiff(d, maxD) > 0))

  // The calendar opens as a centered dialog over the page (own backdrop). Being
  // centered & fixed, it never drifts on scroll nor escapes a parent. Close on
  // Escape; outside-click is handled by the backdrop below.
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
    start.setDate(1 - first.getDay()) // back up to the Sunday on/before the 1st
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      return d
    })
  }, [view])

  const today = new Date()

  const pick = (d: Date) => {
    if (isDisabledDay(d)) return
    onChange(toIso(d))
    setOpen(false)
  }

  const shiftMonth = (delta: number) =>
    setView((v) => new Date(v.getFullYear(), v.getMonth() + delta, 1))

  // Year grid range (12 years around the view year)
  const yearBase = view.getFullYear() - (view.getFullYear() % 12)

  const vpad = compact ? 'py-1.5' : 'py-2.5'
  const fsize = compact ? 'text-[13px]' : 'text-[15px]'
  const triggerCls = bare
    ? `inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1 ${fsize} font-semibold transition-colors ${
        disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:bg-[#F1F5F9]'
      }`
    : `w-full flex items-center gap-0 rounded-[8px] border bg-[#F8FAFC] text-left ${fsize} transition-colors ${
        disabled
          ? 'border-[#E2E8F0] cursor-not-allowed opacity-70'
          : 'border-[#CBD5E1] cursor-pointer hover:bg-white hover:border-[#94A3B8]'
      } ${open ? 'bg-white! border-[#2563EB]! ring-1 ring-[#2563EB]' : ''}`

  return (
    <div ref={wrapRef}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={triggerCls}
      >
        {bare ? (
          <>
            <Calendar size={15} className="text-[#64748B]" />
            <span className={`truncate ${selected ? 'text-[#0F172A]' : 'text-[#94A3B8]'}`}>
              {selected ? formatDisplay(value) : placeholder}
            </span>
          </>
        ) : (
          <>
            <span className={`flex items-center px-2.5 ${vpad} border-r border-[#E2E8F0] rounded-l-[8px] text-[#64748B]`}>
              <Calendar size={15} />
            </span>
            <span className={`flex-1 px-3 ${vpad} truncate ${selected ? 'text-[#0F172A]' : 'text-[#94A3B8]'}`}>
              {selected ? formatDisplay(value) : placeholder}
            </span>
            {selected && !disabled && !hideClear && (
              <span
                role="button"
                tabIndex={-1}
                aria-label="Clear date"
                onClick={(e) => {
                  e.stopPropagation()
                  onChange('')
                }}
                className="flex items-center px-2.5 text-[#94A3B8] hover:text-[#DC2626]"
              >
                <X size={14} />
              </span>
            )}
          </>
        )}
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-black/40"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
        >
          <div
            className="w-[320px] max-w-full rounded-[12px] border border-[#E2E8F0] bg-white shadow-[0_12px_40px_rgba(0,0,0,0.20)] p-3"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
              <button
                type="button"
                onClick={() => (mode === 'days' ? shiftMonth(-1) : setView((v) => new Date(v.getFullYear() - 12, v.getMonth(), 1)))}
                className="w-8 h-8 rounded-[8px] flex items-center justify-center text-[#475569] hover:bg-[#F1F5F9]"
                aria-label="Previous"
              >
                <ChevronLeft size={17} />
              </button>
              <button
                type="button"
                onClick={() => setMode((m) => (m === 'days' ? 'years' : 'days'))}
                className="px-3 py-1.5 rounded-[8px] text-sm font-semibold text-[#0F172A] hover:bg-[#F1F5F9]"
              >
                {mode === 'days' ? `${MONTHS[view.getMonth()]} ${view.getFullYear()}` : `${yearBase} – ${yearBase + 11}`}
              </button>
              <button
                type="button"
                onClick={() => (mode === 'days' ? shiftMonth(1) : setView((v) => new Date(v.getFullYear() + 12, v.getMonth(), 1)))}
                className="w-8 h-8 rounded-[8px] flex items-center justify-center text-[#475569] hover:bg-[#F1F5F9]"
                aria-label="Next"
              >
                <ChevronRight size={17} />
              </button>
            </div>

            {mode === 'days' ? (
              <>
                {/* Weekday labels */}
                <div className="grid grid-cols-7 mb-1">
                  {WEEKDAYS.map((w) => (
                    <div key={w} className="text-center text-[11px] font-semibold text-[#94A3B8] py-1">
                      {w}
                    </div>
                  ))}
                </div>
                {/* Days */}
                <div className="grid grid-cols-7 gap-0.5">
                  {grid.map((d, i) => {
                    const inMonth = d.getMonth() === view.getMonth()
                    const isSel = selected && sameDay(d, selected)
                    const isToday = sameDay(d, today)
                    const off = isDisabledDay(d)
                    const marked = markedSet.has(toIso(d))
                    return (
                      <Tooltip key={i} label={marked ? (markedHint ?? 'On leave') : undefined}>
                      <button
                        type="button"
                        disabled={!!off}
                        onClick={() => pick(d)}
                        className={[
                          'relative h-9 rounded-[8px] text-sm flex items-center justify-center transition-colors',
                          off
                            ? 'text-[#CBD5E1] cursor-not-allowed'
                            : isSel
                              ? 'bg-[#2563EB] text-white font-semibold'
                              : inMonth
                                ? 'text-[#0F172A] hover:bg-[#EFF6FF]'
                                : 'text-[#CBD5E1] hover:bg-[#F1F5F9]',
                          !isSel && isToday && !off ? 'ring-1 ring-inset ring-[#2563EB]' : '',
                        ].join(' ')}
                      >
                        {d.getDate()}
                        {marked && (
                          <span
                            className={`absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${isSel ? 'bg-white' : 'bg-[#D97706]'}`}
                          />
                        )}
                      </button>
                      </Tooltip>
                    )
                  })}
                </div>
              </>
            ) : (
              /* Year picker */
              <div className="grid grid-cols-3 gap-1.5 py-1">
                {Array.from({ length: 12 }, (_, i) => yearBase + i).map((yr) => {
                  const isSel = selected?.getFullYear() === yr
                  return (
                    <button
                      key={yr}
                      type="button"
                      onClick={() => {
                        setView((v) => new Date(yr, v.getMonth(), 1))
                        setMode('days')
                      }}
                      className={[
                        'h-10 rounded-[8px] text-sm flex items-center justify-center transition-colors',
                        isSel
                          ? 'bg-[#2563EB] text-white font-semibold'
                          : 'text-[#0F172A] hover:bg-[#EFF6FF]',
                      ].join(' ')}
                    >
                      {yr}
                    </button>
                  )
                })}
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-[#F1F5F9]">
              <button
                type="button"
                onClick={() => {
                  if (isDisabledDay(today)) return
                  onChange(toIso(today))
                  setOpen(false)
                }}
                disabled={isDisabledDay(today)}
                className="text-xs font-semibold text-[#2563EB] hover:text-[#1D4ED8] disabled:text-[#CBD5E1] disabled:cursor-not-allowed px-2 py-1"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => {
                  onChange('')
                  setOpen(false)
                }}
                className="text-xs font-semibold text-[#64748B] hover:text-[#0F172A] px-2 py-1"
              >
                Clear
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
