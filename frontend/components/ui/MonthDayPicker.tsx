'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react'
import Tooltip from './Tooltip'

/**
 * What a day means to the caller: `blocked` = it can't be picked (faded; the reason is
 * its tooltip, which also opens on tap); `note` = pickable but worth a word (dashed
 * outline; the note is its tooltip and its accessible name).
 */
export interface MonthDayState {
  blocked?: string | null
  note?: string | null
}

interface MonthDayPickerProps {
  value: { month: number; day: number }
  onChange: (value: { month: number; day: number }) => void
  disabled?: boolean
  id?: string
  dayState?: (month: number, day: number) => MonthDayState | null
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function MonthDayPicker({
  value,
  onChange,
  disabled = false,
  id,
  dayState,
}: MonthDayPickerProps) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'days' | 'months'>('days')

  // Keep track of the currently viewed month and day in the picker
  const [viewMonth, setViewMonth] = useState(() => value.month || 1)
  const [viewDay, setViewDay] = useState(() => value.day || 1)

  useEffect(() => {
    if (open) {
      setViewMonth(value.month || 1)
      setViewDay(value.day || 1)
      setMode('days')
    }
  }, [open, value])

  const daysInMonth = useMemo(() => {
    // 31 days: Jan, Mar, May, Jul, Aug, Oct, Dec
    // 30 days: Apr, Jun, Sep, Nov
    // 29 days: Feb (default to 29 to allow leap years)
    if (viewMonth === 2) return 29
    if ([4, 6, 9, 11].includes(viewMonth)) return 30
    return 31
  }, [viewMonth])

  // Handle month shifts
  const shiftMonth = (delta: number) => {
    setViewMonth((prev) => {
      let next = prev + delta
      if (next < 1) next = 12
      if (next > 12) next = 1
      return next
    })
  }

  const pickDay = (day: number) => {
    onChange({ month: viewMonth, day })
    setOpen(false)
  }

  // Formatting display value
  const displayValue = useMemo(() => {
    if (!value.month || !value.day) return 'Select date'
    return `${value.day} ${MONTHS_SHORT[value.month - 1]}`
  }, [value])

  const triggerCls = `w-full flex items-center gap-0 rounded-[8px] border bg-[#F8FAFC] text-left text-sm transition-colors ${
    disabled
      ? 'border-[#E2E8F0] cursor-not-allowed opacity-70'
      : 'border-[#CBD5E1] cursor-pointer hover:bg-white hover:border-[#94A3B8]'
  } ${open ? '!bg-white !border-[#2563EB] ring-1 ring-[#2563EB]' : ''}`

  return (
    <div>
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={triggerCls}
      >
        <span className="flex items-center px-2.5 py-1.5 border-r border-[#E2E8F0] rounded-l-[8px] text-[#64748B]">
          <Calendar size={15} />
        </span>
        <span className={`flex-1 px-3 py-1.5 truncate ${value.month ? 'text-[#0F172A]' : 'text-[#94A3B8]'}`}>
          {displayValue}
        </span>
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
        >
          <div
            className="w-[300px] max-w-full rounded-[12px] border border-[#E2E8F0] bg-white shadow-[0_12px_40px_rgba(0,0,0,0.20)] p-3"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
              {mode === 'days' ? (
                <>
                  <button
                    type="button"
                    onClick={() => shiftMonth(-1)}
                    className="w-8 h-8 rounded-[8px] flex items-center justify-center text-[#475569] hover:bg-[#F1F5F9]"
                    aria-label="Previous Month"
                  >
                    <ChevronLeft size={17} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('months')}
                    className="px-3 py-1.5 rounded-[8px] text-sm font-semibold text-[#0F172A] hover:bg-[#F1F5F9]"
                  >
                    {MONTHS[viewMonth - 1]}
                  </button>
                  <button
                    type="button"
                    onClick={() => shiftMonth(1)}
                    className="w-8 h-8 rounded-[8px] flex items-center justify-center text-[#475569] hover:bg-[#F1F5F9]"
                    aria-label="Next Month"
                  >
                    <ChevronRight size={17} />
                  </button>
                </>
              ) : (
                <div className="w-full flex items-center justify-between px-1">
                  <span className="text-sm font-semibold text-[#0F172A]">Select Month</span>
                  <button
                    type="button"
                    onClick={() => setMode('days')}
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[#94A3B8] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>

            {mode === 'days' ? (
              <div>
                {/* Days numbers only (without days of the week headers) */}
                <div className="grid grid-cols-7 gap-1 mt-2">
                  {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
                    const isSel = value.month === viewMonth && value.day === d
                    const st = dayState?.(viewMonth, d) ?? null
                    const blocked = !!st?.blocked
                    const note = !blocked && st?.note ? st.note : null
                    const btn = (
                      <button
                        key={d}
                        type="button"
                        aria-disabled={blocked || undefined}
                        aria-label={blocked ? `${d} ${MONTHS_SHORT[viewMonth - 1]}: ${st!.blocked}` : note ?? undefined}
                        onClick={() => {
                          if (!blocked) pickDay(d)
                        }}
                        className={[
                          'h-9 rounded-[8px] text-sm flex items-center justify-center transition-colors border focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]',
                          isSel
                            ? `bg-[#2563EB] text-white font-semibold ${blocked ? 'border-[#DC2626] ring-1 ring-[#DC2626]' : 'border-[#2563EB]'}`
                            : blocked
                              ? 'border-transparent bg-[#F1F5F9] text-[#64748B] line-through decoration-[#94A3B8] cursor-not-allowed'
                              : `text-[#0F172A] hover:bg-[#EFF6FF] ${note ? 'border-dashed border-[#94A3B8]' : 'border-transparent'}`,
                        ].join(' ')}
                      >
                        {d}
                      </button>
                    )
                    if (blocked) return <Tooltip key={d} label={st!.blocked} openOnTap>{btn}</Tooltip>
                    if (note) return <Tooltip key={d} label={note}>{btn}</Tooltip>
                    return btn
                  })}
                </div>
              </div>
            ) : (
              /* Month picker grid */
              <div className="grid grid-cols-3 gap-1.5 py-1">
                {MONTHS_SHORT.map((m, idx) => {
                  const isSel = viewMonth === idx + 1
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setViewMonth(idx + 1)
                        setMode('days')
                      }}
                      className={[
                        'h-10 rounded-[8px] text-sm flex items-center justify-center transition-colors',
                        isSel
                          ? 'bg-[#2563EB] text-white font-semibold'
                          : 'text-[#0F172A] hover:bg-[#EFF6FF]',
                      ].join(' ')}
                    >
                      {m}
                    </button>
                  )
                })}
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-end mt-2 pt-2 border-t border-[#F1F5F9]">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-xs font-semibold text-[#64748B] hover:text-[#0F172A] px-2 py-1"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
