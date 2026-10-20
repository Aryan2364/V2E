'use client'

import React from 'react'
import { getNow } from '@/lib/clock'
import type { ScheduleEntryDraft } from '@/components/tasks/ScheduleEntryRow'
import type { RecurringEndCondition, RecurringScheduleType } from '@/lib/types/tasks'
import { defaultScheduleEntry, scheduleEntryError } from '@/lib/tasks/recurring-payload'
import { PhoneDateField, PhoneTimeField } from './PhoneDateTimeField'
import { cx } from './primitives'

/*
 * The "Repeat" part of the phone Create Task form (kit 41.7: one column, 44px
 * controls, full width). The same fields, defaults and rules as the desktop's
 * ScheduleEntryRow - frequency, interval, days of the week or month, time,
 * start, end - for ONE schedule entry; extra entries stay on a computer.
 * Validation messages come from lib/tasks/recurring-payload.ts, the same
 * function the desktop uses.
 */

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const FREQUENCIES: { value: RecurringScheduleType; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
]
const ENDS: { value: RecurringEndCondition; label: string }[] = [
  { value: 'never', label: 'Never' },
  { value: 'on_date', label: 'On date' },
  { value: 'after_n', label: 'After' },
]
const EVERY_MAX: Record<RecurringScheduleType, number> = { daily: 365, weekly: 52, monthly: 12, yearly: 10 }
const EVERY_UNIT: Record<RecurringScheduleType, string> = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }

const CONTROL =
  'min-h-(--h-control) w-full rounded-[8px] border border-border-strong bg-surface px-[12px] text-[16px] text-text-primary outline-hidden focus-visible:border-primary'

/** The entry after switching frequency: the desktop's reset (interval 1, no picks; yearly starts on today). */
export function entryForFrequency(prev: ScheduleEntryDraft | null, type: RecurringScheduleType): ScheduleEntryDraft {
  const base = prev ?? defaultScheduleEntry()
  const now = getNow()
  return {
    ...base,
    schedule_type: type,
    every: 1,
    days: [],
    month_days: [],
    yearly_dates: type === 'yearly' ? [{ month: now.getMonth() + 1, day: now.getDate() }] : [],
  }
}

function Chip({
  selected,
  onClick,
  children,
  className,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        'inline-flex min-h-(--h-control) min-w-[44px] items-center justify-center rounded-[8px] border px-[12px] text-body font-medium',
        'outline-hidden transition-[background-color,border-color] duration-(--duration-fast) focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-ring',
        selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border-strong bg-surface text-text-primary active:bg-surface-control',
        className,
      )}
    >
      {children}
    </button>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-label font-medium text-text-secondary">{children}</span>
}

function FieldError({ children }: { children?: React.ReactNode }) {
  return children ? <span className="text-meta text-danger">{children}</span> : null
}

export function RepeatFields({
  entry,
  onChange,
  showErrors,
}: {
  entry: ScheduleEntryDraft
  onChange: (next: ScheduleEntryDraft) => void
  showErrors: boolean
}) {
  const patch = (p: Partial<ScheduleEntryDraft>) => onChange({ ...entry, ...p })
  const type = entry.schedule_type
  const err = showErrors ? scheduleEntryError(entry) : null
  const daysError = err && type === 'weekly' && entry.days.length === 0 ? err : null
  const monthError = err && type === 'monthly' && entry.month_days.length === 0 ? err : null
  const endError = err && entry.end_condition === 'on_date' && !entry.end_date ? err : null

  const isDaySelected = (d: number) => entry.month_days.includes(d) || entry.month_days.includes(-d)
  function toggleMonthDay(d: number) {
    patch({ month_days: isDaySelected(d) ? entry.month_days.filter((x) => x !== d && x !== -d) : [...entry.month_days, d] })
  }
  function setFallback(d: number, on: boolean) {
    patch({ month_days: entry.month_days.map((x) => (Math.abs(x) === d ? (on ? -d : d) : x)) })
  }
  // Same month-end adjustments as the desktop: only the highest of 29/30/31 picked is offered.
  const fallback = isDaySelected(31)
    ? { d: 31, label: 'Also run on the last day of shorter months', miss: 'Without this, the task is missed in February, April, June, September and November.' }
    : isDaySelected(30)
      ? { d: 30, label: 'Also run on the last day of February', miss: 'Without this, the task is missed in February.' }
      : isDaySelected(29)
        ? { d: 29, label: 'Also run on 28 February when it is not a leap year', miss: 'Without this, the task is missed in February when it is not a leap year.' }
        : null

  const yd = entry.yearly_dates[0]
  const ydYear = yd && yd.month === 2 && yd.day === 29 ? 2024 : getNow().getFullYear()
  const ydValue = yd ? `${ydYear}-${String(yd.month).padStart(2, '0')}-${String(yd.day).padStart(2, '0')}` : ''

  return (
    <div className="flex flex-col gap-[16px] rounded-[12px] border border-border-light bg-surface-sunken p-[16px]">
      <div className="flex flex-col gap-[6px]">
        <Label>Repeats</Label>
        <div className="flex flex-wrap gap-[8px]">
          {FREQUENCIES.map((f) => (
            <Chip key={f.value} selected={type === f.value} onClick={() => onChange(entryForFrequency(entry, f.value))} className="flex-1">
              {f.label}
            </Chip>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-[6px]">
        <label htmlFor="repeat-every" className="text-label font-medium text-text-secondary">
          Every how many {EVERY_UNIT[type]}s
        </label>
        <input
          id="repeat-every"
          type="number"
          inputMode="numeric"
          min={1}
          max={EVERY_MAX[type]}
          value={entry.every}
          enterKeyHint="next"
          onChange={(e) => patch({ every: Math.min(EVERY_MAX[type], Math.max(1, Number(e.target.value) || 1)) })}
          className={CONTROL}
        />
      </div>

      {type === 'weekly' ? (
        <div className="flex flex-col gap-[6px]">
          <Label>On</Label>
          <div className="flex flex-wrap gap-[8px]">
            {DOW.map((label, d) => (
              <Chip
                key={d}
                selected={entry.days.includes(d)}
                onClick={() => patch({ days: entry.days.includes(d) ? entry.days.filter((x) => x !== d) : [...entry.days, d] })}
              >
                {label}
              </Chip>
            ))}
          </div>
          <FieldError>{daysError}</FieldError>
        </div>
      ) : null}

      {type === 'monthly' ? (
        <div className="flex flex-col gap-[6px]">
          <Label>On day(s) of the month</Label>
          <div className="grid grid-cols-7 gap-[4px]">
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <Chip key={d} selected={isDaySelected(d)} onClick={() => toggleMonthDay(d)} className="min-w-0 px-0">
                {d}
              </Chip>
            ))}
          </div>
          <FieldError>{monthError}</FieldError>
          {fallback ? (
            <label className="mt-[8px] flex min-h-[48px] items-start gap-[12px] py-[8px] text-body text-text-primary">
              <input
                type="checkbox"
                checked={entry.month_days.includes(-fallback.d)}
                onChange={(e) => setFallback(fallback.d, e.target.checked)}
                className="mt-[2px] size-[20px] shrink-0 accent-primary"
              />
              <span className="flex flex-col">
                <span>{fallback.label}</span>
                {!entry.month_days.includes(-fallback.d) ? <span className="text-meta text-text-secondary">{fallback.miss}</span> : null}
              </span>
            </label>
          ) : null}
        </div>
      ) : null}

      {type === 'yearly' ? (
        <PhoneDateField
          id="repeat-yearly"
          label="On (day and month)"
          value={ydValue}
          onChange={(v) => {
            const [, m, d] = v.split('-').map(Number)
            if (m && d) patch({ yearly_dates: [{ month: m, day: d }] })
          }}
        />
      ) : null}

      <PhoneTimeField id="repeat-time" label="Time" value={entry.time} onChange={(v) => patch({ time: v })} />
      <PhoneDateField id="repeat-start" label="Starting" value={entry.start_date} onChange={(v) => patch({ start_date: v })} />

      <div className="flex flex-col gap-[6px]">
        <Label>Ends</Label>
        <div className="flex gap-[8px]">
          {ENDS.map((o) => (
            <Chip key={o.value} selected={entry.end_condition === o.value} onClick={() => patch({ end_condition: o.value })} className="flex-1">
              {o.label}
            </Chip>
          ))}
        </div>
        {entry.end_condition === 'on_date' ? (
          <>
            <PhoneDateField id="repeat-end" label="End date" value={entry.end_date} onChange={(v) => patch({ end_date: v })} />
            <FieldError>{endError}</FieldError>
          </>
        ) : null}
        {entry.end_condition === 'after_n' ? (
          <div className="flex flex-col gap-[6px]">
            <label htmlFor="repeat-after" className="text-label font-medium text-text-secondary">
              Number of times
            </label>
            <input
              id="repeat-after"
              type="number"
              inputMode="numeric"
              min={1}
              value={entry.end_after}
              enterKeyHint="done"
              onChange={(e) => patch({ end_after: Math.max(1, Number(e.target.value) || 1) })}
              className={CONTROL}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
