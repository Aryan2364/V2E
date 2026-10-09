'use client'

import React, { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import MonthDayPicker from '@/components/ui/MonthDayPicker'
import StyledSelect from '@/components/ui/StyledSelect'
import TimeField from '@/components/ui/TimeField'
import type { DueRule, DueRuleKind, RuleMonthDay, StartRule, StartRuleKind } from '@/lib/types/workflows'
import { InfoTip, WEEKDAYS_LONG, WEEKDAYS_SHORT } from './shared'
import {
  DEFAULT_DUE_TIME,
  DEFAULT_START_TIME,
  MAX_RULE_DAYS,
  allowedDueKinds,
  allowedStartKinds,
  cycleLabel,
  dueKindLabel,
  dueRuleOfKind,
  frequencyNote,
  isCycleKind,
  startKindLabel,
  startRuleOfKind,
  type Frequency,
  type ScheduleShape,
  type TimingProblem,
} from './timing'

const LABEL = 'block text-sm font-medium text-[#374151] mb-2'
const SUB = 'block text-[13px] font-medium text-[#374151] mb-1.5'
const INPUT =
  'px-3 py-2.5 text-base sm:text-sm border border-[#CBD5E1] rounded-[8px] bg-white text-[#0F172A] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] disabled:bg-[#F8FAFC] disabled:text-[#334155] disabled:cursor-not-allowed'
const CHIP_BASE =
  'min-h-[44px] sm:min-h-[36px] rounded-[8px] border text-sm font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-1 disabled:cursor-not-allowed'
const chipCls = (on: boolean) =>
  `${CHIP_BASE} ${
    on
      ? 'bg-[#2563EB] text-white border-[#2563EB] disabled:bg-[#94A3B8] disabled:border-[#94A3B8]'
      : 'bg-white text-[#334155] border-[#CBD5E1] hover:border-[#2563EB] hover:text-[#1D4ED8] disabled:hover:border-[#CBD5E1] disabled:hover:text-[#334155] disabled:bg-[#F8FAFC]'
  }`

// ─── Pickers ─────────────────────────────────────────────────────────────────

/** One day of the week, as chips (single choice). */
function WeekdayChips({ value, onChange, disabled, label }: { value: number; onChange: (d: number) => void; disabled?: boolean; label: string }) {
  // Monday first, as the working week reads.
  const order = [1, 2, 3, 4, 5, 6, 0]
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-7 gap-1.5">
      {order.map((d) => (
        <button
          key={d}
          type="button"
          role="radio"
          aria-checked={value === d}
          aria-label={WEEKDAYS_LONG[d]}
          disabled={disabled}
          onClick={() => onChange(d)}
          className={`${chipCls(value === d)} px-0`}
        >
          {WEEKDAYS_SHORT[d]}
        </button>
      ))}
    </div>
  )
}

/** One day of the month — 1 to 31, or the last day (single choice). */
function MonthDayGrid({ value, onChange, disabled, label }: { value: RuleMonthDay | undefined; onChange: (d: RuleMonthDay) => void; disabled?: boolean; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-7 gap-1">
      {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
        <button
          key={d}
          type="button"
          role="radio"
          aria-checked={value === d}
          disabled={disabled}
          onClick={() => onChange(d)}
          className={`${chipCls(value === d)} !min-h-[36px] sm:!min-h-[32px] text-[13px] tabular-nums px-0`}
        >
          {d}
        </button>
      ))}
      <button
        type="button"
        role="radio"
        aria-checked={value === 'last'}
        disabled={disabled}
        onClick={() => onChange('last')}
        className={`${chipCls(value === 'last')} !min-h-[36px] sm:!min-h-[32px] text-[13px] col-span-4 px-2`}
      >
        Last day
      </button>
    </div>
  )
}

/** Which week / month / year of the cycle: chips up to 6, a list beyond. */
function CycleSelector({ f, value, onChange, disabled }: { f: Frequency; value: number; onChange: (n: number) => void; disabled?: boolean }) {
  const every = 'every' in f ? f.every : 1
  const options = Array.from({ length: Math.max(1, every) }, (_, i) => i + 1)
  const invalid = value > every
  if (every > 6) {
    return (
      <StyledSelect
        value={invalid ? '' : String(value)}
        onChange={(v) => onChange(Number(v))}
        options={options.map((n) => ({ value: String(n), label: cycleLabel(f, n) }))}
        placeholder={`Choose ${cycleLabel(f, 1).split(' ')[0].toLowerCase()}`}
        disabled={disabled}
        wrapperClassName="w-full sm:w-[200px]"
      />
    )
  }
  return (
    <div role="radiogroup" aria-label="Which cycle" className="flex flex-wrap gap-1.5">
      {options.map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          disabled={disabled}
          onClick={() => onChange(n)}
          className={`${chipCls(value === n)} px-3`}
        >
          {cycleLabel(f, n)}
        </button>
      ))}
    </div>
  )
}

/** A whole number of days, typed; applied once it is valid, put back on leave if not. */
function DaysInput({
  value,
  min,
  onChange,
  disabled,
  label,
  invalid,
}: {
  value: number | undefined
  min: number
  onChange: (n: number) => void
  disabled?: boolean
  label: string
  invalid?: boolean
}) {
  const [text, setText] = useState(String(value ?? min))
  const [error, setError] = useState(false)
  useEffect(() => {
    setText((cur) => (Number(cur) === value && cur !== '' ? cur : String(value ?? min)))
  }, [value, min])
  const parse = (v: string) => (/^\d{1,3}$/.test(v) && Number(v) >= min && Number(v) <= MAX_RULE_DAYS ? Number(v) : null)
  return (
    <input
      inputMode="numeric"
      aria-label={label}
      aria-invalid={error || invalid}
      value={text}
      disabled={disabled}
      onChange={(e) => {
        const v = e.target.value.replace(/[^\d]/g, '').slice(0, 3)
        setText(v)
        setError(false)
        const n = parse(v)
        if (n !== null && n !== value) onChange(n)
      }}
      onBlur={() => {
        if (parse(text) !== null) return
        setError(true)
        setText(String(value ?? min))
      }}
      className={`${INPUT} w-20 text-right tabular-nums ${error || invalid ? '!border-[#DC2626]' : ''}`}
    />
  )
}

function TimeAt({ value, onChange, disabled, label, fallback }: { value?: string; onChange: (t: string) => void; disabled?: boolean; label: string; fallback: string }) {
  return (
    <div className="w-[150px]">
      <TimeField value={value || fallback} label={label} disabled={disabled} onChange={(t) => t && onChange(t)} />
    </div>
  )
}

// ─── One rule ────────────────────────────────────────────────────────────────

/** The params of a rule (everything but its kind), laid out for its kind. */
function RuleParams<R extends StartRule | DueRule>({
  rule,
  f,
  onChange,
  disabled,
  which,
  hasPredecessors,
  invalid,
}: {
  rule: R
  f: Frequency
  onChange: (next: R) => void
  disabled?: boolean
  which: 'start' | 'due'
  hasPredecessors: boolean
  invalid?: boolean
}) {
  const set = (patch: Partial<StartRule>) => onChange({ ...rule, ...patch })
  const word = which === 'start' ? 'Start' : 'Due'
  const fallback = which === 'start' ? DEFAULT_START_TIME : DEFAULT_DUE_TIME
  const time = <TimeAt value={rule.time} onChange={(t) => set({ time: t })} disabled={disabled} label={`${word} time`} fallback={fallback} />

  switch (rule.kind) {
    case 'immediate':
      return null
    case 'days_after_previous':
    case 'days_after_run_start':
    case 'days_after_start': {
      const min = rule.kind === 'days_after_previous' ? 1 : 0
      const n = rule.days ?? min
      const tail = rule.kind === 'days_after_previous' && hasPredecessors ? 'after previous step, at' : 'after start, at'
      return (
        <div className="flex flex-wrap items-center gap-2">
          <DaysInput value={rule.days} min={min} onChange={(d) => set({ days: d })} disabled={disabled} label={`${word}: number of days`} invalid={invalid} />
          <span className="text-sm text-[#1E293B]">
            {n === 1 ? 'day' : 'days'} {tail}
          </span>
          {time}
        </div>
      )
    }
    case 'time_of_day':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-[#1E293B]">At</span>
          {time}
        </div>
      )
    default: {
      const cycle = isCycleKind(rule.kind)
      const isWeekday = rule.kind === 'weekday' || rule.kind === 'cycle_weekday'
      const isMonthDay = rule.kind === 'month_day' || rule.kind === 'cycle_month_day'
      return (
        <div className="flex flex-col gap-3">
          {cycle && (
            <div>
              <span className={SUB}>Which {cycleLabel(f, 1).split(' ')[0].toLowerCase()}</span>
              <CycleSelector f={f} value={rule.cycle ?? 1} onChange={(n) => set({ cycle: n })} disabled={disabled} />
            </div>
          )}
          {isWeekday && (
            <div>
              <span className={SUB}>Day of the week</span>
              <WeekdayChips value={rule.weekday ?? 1} onChange={(d) => set({ weekday: d })} disabled={disabled} label={`${word}: day of the week`} />
            </div>
          )}
          {isMonthDay && (
            <div className="max-w-[340px]">
              <span className={SUB}>
                Day of the month <InfoTip label="Day of the month" text="Shorter months use their last day instead." />
              </span>
              <MonthDayGrid value={rule.day} onChange={(d) => set({ day: d })} disabled={disabled} label={`${word}: day of the month`} />
            </div>
          )}
          {!isWeekday && !isMonthDay && (
            <div className="max-w-[240px]">
              <span className={SUB}>Date</span>
              <MonthDayPicker
                value={{ month: rule.month ?? 1, day: typeof rule.day === 'number' ? rule.day : 1 }}
                onChange={(v) => set({ month: v.month, day: v.day })}
                disabled={disabled}
              />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-[#1E293B]">At</span>
            {time}
          </div>
        </div>
      )
    }
  }
}

function ProblemLine({ message }: { message: string }) {
  return (
    <p className="mt-1.5 flex items-start gap-1.5 text-[13px] text-[#B91C1C]" role="alert">
      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
      <span>{message.charAt(0).toUpperCase() + message.slice(1)}</span>
    </p>
  )
}

// ─── The Timing block ────────────────────────────────────────────────────────

/**
 * A step's timing: when it starts (beside "Starts after") and when it is due. Only the
 * kinds the workflow's current frequency allows are offered; a choice the frequency no
 * longer allows is kept as it is and flagged, so nothing changes behind anyone's back.
 */
export default function StepTiming({
  idPrefix,
  start,
  due,
  frequency: f,
  schedules,
  hasPredecessors,
  disabled,
  onChange,
  problems,
  startsAfter,
}: {
  idPrefix: string
  start: StartRule
  due: DueRule
  frequency: Frequency
  /** The schedules being edited (calendar defaults follow them). */
  schedules: ScheduleShape[]
  hasPredecessors: boolean
  disabled?: boolean
  onChange: (patch: { start_rule?: StartRule; due_rule?: DueRule }) => void
  problems: TimingProblem[]
  /** The "Starts after" control, shown first under Starts. */
  startsAfter: React.ReactNode
}) {
  const startProblem = problems.find((p) => p.part === 'start')
  const dueProblem = problems.find((p) => p.part === 'due')

  const startKinds = allowedStartKinds(f).filter((k) => k !== 'days_after_previous' || hasPredecessors || start.kind === k)
  const startOptions: { value: string; label: string }[] = startKinds.map((k) => ({ value: k, label: startKindLabel(k, f, hasPredecessors) }))
  if (!startKinds.includes(start.kind)) {
    startOptions.push({ value: start.kind, label: `${startKindLabel(start.kind, f, hasPredecessors)} (not available)` })
  }
  const dueKinds = allowedDueKinds(f)
  const dueOptions: { value: string; label: string }[] = dueKinds.map((k) => ({ value: k, label: dueKindLabel(k, f) }))
  if (!dueKinds.includes(due.kind)) dueOptions.push({ value: due.kind, label: `${dueKindLabel(due.kind, f)} (not available)` })

  return (
    <div className="flex flex-col gap-4">
      <h3 className="flex items-center gap-1 text-sm font-semibold text-[#0F172A]">
        Timing <InfoTip label="Timing" text={frequencyNote(f)} />
      </h3>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-6">
        {/* Starts */}
        <div className="flex flex-col gap-4 min-w-0">
          {startsAfter}
          <div>
            <span className={LABEL}>
              <span id={`${idPrefix}-starts-label`}>Starts</span>{' '}
              <InfoTip
                label="Starts"
                text={hasPredecessors ? 'Waits for previous steps. Holidays shift it to the next working day.' : 'Holidays shift it to the next working day.'}
              />
            </span>
            <div aria-labelledby={`${idPrefix}-starts-label`} className={startProblem && !startKinds.includes(start.kind) ? 'rounded-[8px] ring-1 ring-[#DC2626]' : ''}>
              <StyledSelect
                value={start.kind}
                onChange={(v) => onChange({ start_rule: startRuleOfKind(v as StartRuleKind, start, schedules) })}
                options={startOptions}
                disabled={disabled}
              />
            </div>
            {start.kind !== 'immediate' && (
              <div className="mt-3">
                <RuleParams rule={start} f={f} which="start" hasPredecessors={hasPredecessors} disabled={disabled} invalid={!!startProblem} onChange={(r) => onChange({ start_rule: r })} />
              </div>
            )}
            {startProblem && <ProblemLine message={startProblem.message} />}
          </div>
        </div>

        {/* Due */}
        <div className="min-w-0">
          <span className={LABEL}>
            <span id={`${idPrefix}-due-label`}>Due</span>{' '}
            <InfoTip
              label="Due"
              text={due.kind === 'days_after_start' ? 'Days count from this step’s start, skipping holidays and weekly offs.' : 'The next matching date after this step starts.'}
            />
          </span>
          <div aria-labelledby={`${idPrefix}-due-label`} className={dueProblem && !dueKinds.includes(due.kind) ? 'rounded-[8px] ring-1 ring-[#DC2626]' : ''}>
            <StyledSelect
              value={due.kind}
              onChange={(v) => onChange({ due_rule: dueRuleOfKind(v as DueRuleKind, due, schedules, start) })}
              options={dueOptions}
              disabled={disabled}
            />
          </div>
          <div className="mt-3">
            <RuleParams rule={due} f={f} which="due" hasPredecessors={hasPredecessors} disabled={disabled} invalid={!!dueProblem} onChange={(r) => onChange({ due_rule: r })} />
          </div>
          {dueProblem && <ProblemLine message={dueProblem.message} />}
        </div>
      </div>
    </div>
  )
}
