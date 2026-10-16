'use client'

import React, { useState } from 'react'
import { X, Calendar as CalendarIcon } from 'lucide-react'
import type { RecurringScheduleType, RecurringEndCondition, YearlyDate } from '@/lib/types/tasks'
import DatePicker from '@/components/ui/DatePicker'
import TimeField from '@/components/ui/TimeField'
import Tooltip from '@/components/ui/tooltip'
import { getNow } from '@/lib/clock'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** A leap year, so 29 Feb is pickable. Only month/day are read back; the year is discarded. */
const MONTH_DAY_YEAR = 2000

/**
 * Migrated directly onto the kit's calendar.tsx (section 4 rule 4; no
 * separate MonthDayPicker.tsx any more - its one call site was here).
 * The month and day of a yearly recurrence, with no year of its own.
 */
function MonthDayPicker({
  value,
  onChange,
}: {
  value: YearlyDate
  onChange: (value: YearlyDate) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = value.month && value.day ? new Date(MONTH_DAY_YEAR, value.month - 1, value.day) : undefined
  const label = selected ? `${selected.getDate()} ${MONTHS_SHORT[selected.getMonth()]}` : 'Select date'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="secondary" className={cn('w-full justify-start', !selected && 'text-text-muted')} />}
      >
        <CalendarIcon className="size-4 text-text-muted" />
        <span className="flex-1 truncate text-left">{label}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(date) => {
            if (!date) return
            onChange({ month: date.getMonth() + 1, day: date.getDate() })
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const TYPES: { value: RecurringScheduleType; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
]

export interface ScheduleEntryDraft {
  schedule_type: RecurringScheduleType
  every: number
  days: number[]
  month_days: number[]
  yearly_dates: YearlyDate[]
  time: string
  start_date: string
  end_condition: RecurringEndCondition
  end_date: string
  end_after: number
}

interface Props {
  entry: ScheduleEntryDraft
  index: number
  onUpdate: (patch: Partial<ScheduleEntryDraft>) => void
  onDelete: () => void
  canDelete: boolean
}

const inputCls = 'border border-border rounded-lg px-3 py-[8px] text-sm text-text-primary bg-surface focus:border-2 focus:border-primary focus:outline-hidden'
const labelCls = 'text-sm font-medium text-text-secondary'

export default function ScheduleEntryRow({ entry, index, onUpdate, onDelete, canDelete }: Props) {
  const [isCustom, setIsCustom] = useState(() => entry.every > 1)

  function toggleDow(d: number) {
    const next = entry.days.includes(d) ? entry.days.filter((x) => x !== d) : [...entry.days, d]
    onUpdate({ days: next })
  }

  function isMonthDaySelected(d: number) {
    return entry.month_days.includes(d) || entry.month_days.includes(-d)
  }

  function toggleMonthDay(d: number) {
    const isSelected = entry.month_days.includes(d) || entry.month_days.includes(-d)
    let next: number[]
    if (isSelected) {
      next = entry.month_days.filter((x) => x !== d && x !== -d)
    } else {
      next = [...entry.month_days, d]
    }
    onUpdate({ month_days: next })
  }

  function toggleFallback(d: number, enable: boolean) {
    const next = entry.month_days.map((x) => {
      if (Math.abs(x) === d) {
        return enable ? -d : d
      }
      return x
    })
    onUpdate({ month_days: next })
  }

  function addYearlyDate() {
    onUpdate({ yearly_dates: [...entry.yearly_dates, { month: 1, day: 1 }] })
  }

  function updateYearlyDate(i: number, patch: Partial<YearlyDate>) {
    const next = entry.yearly_dates.map((d, idx) => idx === i ? { ...d, ...patch } : d)
    onUpdate({ yearly_dates: next })
  }

  function removeYearlyDate(i: number) {
    onUpdate({ yearly_dates: entry.yearly_dates.filter((_, idx) => idx !== i) })
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text-muted uppercase tracking-wider">Entry #{index + 1}</span>
        <Tooltip label={canDelete ? 'Remove entry' : 'Cannot remove last entry'}>
        <button
          type="button"
          onClick={onDelete}
          disabled={!canDelete}
          aria-label={canDelete ? 'Remove entry' : 'Cannot remove last entry'}
          className={[
            'w-7 h-7 rounded-[6px] flex items-center justify-center transition-colors',
            canDelete
              ? 'text-text-muted hover:text-danger hover:bg-danger-bg'
              : 'text-text-muted cursor-not-allowed',
          ].join(' ')}
        >
          <X size={14} />
        </button>
        </Tooltip>
      </div>

      {/* Type tabs */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className={labelCls}>Repeat</label>
          <button
            type="button"
            onClick={() => {
              const nextIsCustom = !isCustom
              setIsCustom(nextIsCustom)
              if (!nextIsCustom) {
                onUpdate({ every: 1 })
              }
            }}
            className="text-xs font-medium text-primary-text hover:underline"
          >
            {isCustom ? 'Use standard interval' : 'Set custom interval...'}
          </button>
        </div>
        <div className="flex items-center border border-border-light rounded-lg p-0.5 gap-0.5">
          {TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => {
                const patch: Partial<ScheduleEntryDraft> = {
                  schedule_type: t.value,
                  every: 1,
                  days: [],
                  month_days: [],
                  yearly_dates: [],
                }
                if (t.value === 'yearly') {
                  const now = getNow()
                  patch.yearly_dates = [{ month: now.getMonth() + 1, day: now.getDate() }]
                }
                setIsCustom(false)
                onUpdate(patch)
              }}
              className={[
                'flex-1 py-1.5 text-sm font-medium rounded-[6px] transition-colors',
                entry.schedule_type === t.value
                  ? 'bg-primary text-white'
                  : 'text-text-secondary hover:bg-surface-control',
              ].join(' ')}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Daily config */}
      {entry.schedule_type === 'daily' && isCustom && (
        <div className="flex items-center gap-3">
          <span className={labelCls}>Every</span>
          <input
            type="number"
            min={1}
            max={365}
            value={entry.every}
            onChange={(e) => onUpdate({ every: Math.max(1, Number(e.target.value)) })}
            className={`w-20 text-center ${inputCls}`}
          />
          <span className="text-sm text-text-secondary">day{entry.every !== 1 ? 's' : ''}</span>
        </div>
      )}

      {/* Weekly config */}
      {entry.schedule_type === 'weekly' && (
        <div className="space-y-3">
          {isCustom && (
            <div className="flex items-center gap-3">
              <span className={labelCls}>Every</span>
              <input
                type="number"
                min={1}
                max={52}
                value={entry.every}
                onChange={(e) => onUpdate({ every: Math.max(1, Number(e.target.value)) })}
                className={`w-20 text-center ${inputCls}`}
              />
              <span className="text-sm text-text-secondary">week{entry.every !== 1 ? 's' : ''} on</span>
            </div>
          )}
          {!isCustom && (
            <span className={`${labelCls} block`}>Repeats weekly on</span>
          )}
          <div className="flex gap-1.5 flex-wrap">
            {DOW_LABELS.map((label, d) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleDow(d)}
                className={[
                  'px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors',
                  entry.days.includes(d)
                    ? 'bg-primary text-white border-primary'
                    : 'bg-surface text-text-secondary border-border hover:border-primary hover:text-primary-text',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Monthly config */}
      {entry.schedule_type === 'monthly' && (
        <div className="space-y-3">
          {isCustom && (
            <div className="flex items-center gap-3">
              <span className={labelCls}>Every</span>
              <input
                type="number"
                min={1}
                max={12}
                value={entry.every}
                onChange={(e) => onUpdate({ every: Math.max(1, Number(e.target.value)) })}
                className={`w-20 text-center ${inputCls}`}
              />
              <span className="text-sm text-text-secondary">month{entry.every !== 1 ? 's' : ''} on day(s)</span>
            </div>
          )}
          {!isCustom && (
            <span className={`${labelCls} block`}>Repeats monthly on day(s)</span>
          )}
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleMonthDay(d)}
                className={[
                  'h-8 w-full text-xs font-medium rounded-[6px] border transition-colors',
                  isMonthDaySelected(d)
                    ? 'bg-primary text-white border-primary'
                    : 'bg-surface text-text-secondary border-border hover:border-primary hover:text-primary-text',
                ].join(' ')}
              >
                {d}
              </button>
            ))}
          </div>

          {/* Monthly warnings/prompts */}
          {(isMonthDaySelected(29) || isMonthDaySelected(30) || isMonthDaySelected(31)) && (() => {
            const show31 = isMonthDaySelected(31)
            const show30 = isMonthDaySelected(30) && !show31
            const show29 = isMonthDaySelected(29) && !show31 && !show30

            return (
              <div className="p-3 bg-surface-sunken border border-border-light rounded-lg text-[12px] text-text-secondary space-y-3">
                <p className="font-medium text-text-primary flex items-center gap-1">
                  <span>📅</span> Month-End Adjustment Options:
                </p>
                
                <div className="space-y-3">
                  {show29 && (
                    <div className="space-y-1">
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={entry.month_days.includes(-29)}
                          onChange={(e) => toggleFallback(29, e.target.checked)}
                          className="mt-0.5 accent-primary"
                        />
                        <div>
                          <span className="font-medium text-text-primary">Automatically run on February 28th in non-leap years</span>
                        </div>
                      </label>
                      {!entry.month_days.includes(-29) && (
                        <p className="text-[11px] text-danger pl-4">
                          ⚠️ Note: If not selected, this task will be missed in February during non-leap years.
                        </p>
                      )}
                    </div>
                  )}

                  {show30 && (
                    <div className="space-y-1">
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={entry.month_days.includes(-30)}
                          onChange={(e) => toggleFallback(30, e.target.checked)}
                          className="mt-0.5 accent-primary"
                        />
                        <div>
                          <span className="font-medium text-text-primary">Automatically run on the last day of February</span>
                        </div>
                      </label>
                      {!entry.month_days.includes(-30) && (
                        <p className="text-[11px] text-danger pl-4">
                          ⚠️ Note: If not selected, this task will be missed in February.
                        </p>
                      )}
                    </div>
                  )}

                  {show31 && (
                    <div className="space-y-1">
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={entry.month_days.includes(-31)}
                          onChange={(e) => toggleFallback(31, e.target.checked)}
                          className="mt-0.5 accent-primary"
                        />
                        <div>
                          <span className="font-medium text-text-primary">Automatically run on the last day of shorter months</span>
                          <p className="text-[10px] text-text-muted mt-0.5">
                            (Applies to February, April, June, September, and November)
                          </p>
                        </div>
                      </label>
                      {!entry.month_days.includes(-31) && (
                        <p className="text-[11px] text-danger pl-4">
                          ⚠️ Note: If not selected, this task will be missed in February, April, June, September, and November.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* Yearly config */}
      {entry.schedule_type === 'yearly' && (
        <div className="space-y-3">
          {isCustom && (
            <div className="flex items-center gap-3">
              <span className={labelCls}>Every</span>
              <input
                type="number"
                min={1}
                max={10}
                value={entry.every}
                onChange={(e) => onUpdate({ every: Math.max(1, Number(e.target.value)) })}
                className={`w-20 text-center ${inputCls}`}
              />
              <span className="text-sm text-text-secondary">year{entry.every !== 1 ? 's' : ''} on date(s)</span>
            </div>
          )}
          {!isCustom && (
            <span className={`${labelCls} block`}>Repeats yearly on date(s)</span>
          )}
          <div className="space-y-2">
            {entry.yearly_dates.map((yd, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="flex-1">
                  <MonthDayPicker
                    value={yd}
                    onChange={(v) => updateYearlyDate(i, v)}
                  />
                </div>
                {entry.yearly_dates.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeYearlyDate(i)}
                    className="w-7 h-7 rounded-[6px] flex items-center justify-center text-text-muted hover:text-danger hover:bg-danger-bg transition-colors"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={addYearlyDate}
              className="text-sm text-primary-text hover:underline font-medium"
            >
              + Add date
            </button>
          </div>
        </div>
      )}

      {/* Time + Start date */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={`${labelCls} block mb-1.5`}>Time</label>
          <div className="w-full">
            <TimeField value={entry.time} onChange={(v) => onUpdate({ time: v })} />
          </div>
        </div>
        <div>
          <label className={`${labelCls} block mb-1.5`}>Starting</label>
          <DatePicker
            value={entry.start_date}
            onChange={(iso) => onUpdate({ start_date: iso })}
            placeholder="Select date"
          />
        </div>
      </div>

      {/* End condition */}
      <div>
        <label className={`${labelCls} block mb-1.5`}>Ends</label>
        <div className="flex items-center border border-border-light rounded-lg p-0.5 gap-0.5 mb-3">
          {(['never', 'on_date', 'after_n'] as RecurringEndCondition[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onUpdate({ end_condition: v })}
              className={[
                'flex-1 py-1.5 text-sm font-medium rounded-[6px] transition-colors',
                entry.end_condition === v
                  ? 'bg-primary text-white'
                  : 'text-text-secondary hover:bg-surface-control',
              ].join(' ')}
            >
              {v === 'never' ? 'Never' : v === 'on_date' ? 'On date' : 'After N'}
            </button>
          ))}
        </div>
        {entry.end_condition === 'on_date' && (
          <DatePicker
            value={entry.end_date}
            onChange={(iso) => onUpdate({ end_date: iso })}
            placeholder="Select date"
          />
        )}
        {entry.end_condition === 'after_n' && (
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={1}
              value={entry.end_after}
              onChange={(e) => onUpdate({ end_after: Math.max(1, Number(e.target.value)) })}
              className={`w-24 text-center ${inputCls}`}
            />
            <span className="text-sm text-text-secondary">occurrences</span>
          </div>
        )}
      </div>
    </div>
  )
}
