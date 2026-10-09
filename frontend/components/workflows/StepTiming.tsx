'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import StyledSelect from '@/components/ui/StyledSelect'
import TimeField from '@/components/ui/TimeField'
import type { DueRule, DueRuleKind, StartRule, StartRuleKind } from '@/lib/types/workflows'
import { InfoTip, fmtTime } from './shared'
import TimingCalendar from './TimingCalendar'
import {
  DEFAULT_DUE_TIME,
  DEFAULT_START_TIME,
  EXPLICIT_CYCLE_LIMIT,
  MAX_RULE_DAYS,
  allowedStartKinds,
  beforeRunStartText,
  dayKindOf,
  dayMonthWords,
  dueKindLabel,
  dueKindsFor,
  dueRuleOfKind,
  frequencyNote,
  isExplicitRule,
  maxCycleOf,
  predecessorName,
  runStartShort,
  startKindLabel,
  startKindsFor,
  startRuleOfKind,
  type DaySeed,
  type Frequency,
  type RunStart,
  type ScheduleShape,
  type TimingProblem,
} from './timing'
import {
  calendarOccurrence,
  calendarSpans,
  cycleOfDay,
  dateOfDayNumber,
  dayNumber,
  dayOf,
  dueBeforeStartSameDay,
  dueMinDay,
  latestPredecessor,
  nextCycleWord,
  plannableRules,
  resolveStart,
  ruleDay,
  startMinDay,
  startsBeforePredecessorDue,
  type CalendarSpan,
  type NamedStep,
  type PlanContext,
  type PlannedDates,
} from './timingPlan'

const LABEL = 'block text-sm font-medium text-[#374151] mb-2'
const SUB = 'block text-[13px] font-medium text-[#374151] mb-1.5'
const NOTE = 'mt-1.5 flex flex-wrap items-center gap-1 text-[13px] text-[#334155]'
const INPUT =
  'px-3 py-2.5 text-base sm:text-sm border border-[#CBD5E1] rounded-[8px] bg-white text-[#0F172A] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] disabled:bg-[#F8FAFC] disabled:text-[#334155] disabled:cursor-not-allowed'

// ─── Small fields ────────────────────────────────────────────────────────────

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

/** A soft note under a pick: worth knowing, never an error. */
function SoftNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1.5 flex items-start gap-1.5 rounded-[8px] border border-[#BFDBFE] bg-[#EFF6FF] px-2.5 py-1.5 text-[13px] text-[#1E3A8A]" role="status">
      <Info size={14} className="shrink-0 mt-0.5" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

// ─── One rule ────────────────────────────────────────────────────────────────

/** The day kind a calendar pages by: Week strip, Month, or months across Years. */
const unitOf = (kind: string): 'Week' | 'Month' | 'Year' =>
  dayKindOf(kind as StartRuleKind) === 'weekday' ? 'Week' : dayKindOf(kind as StartRuleKind) === 'month_day' ? 'Month' : 'Year'

/** Where the calendar stands for one rule (see `StepTiming`). */
interface CalendarContext {
  ctx: PlanContext
  spans: CalendarSpan[]
  /** What the rule resolves from: when the step may start (start) / its planned start (due). */
  anchor: Date
  /** Days before it are greyed, with the reason. */
  minDay: number | null
  minReason: string | null
  /** The same-day note under the pick, or null. */
  note: React.ReactNode
}

/**
 * Where this rule's options land for this step: `nextOf` (time of day) says whether a
 * time falls on the next day; `runStart` (first steps) is the run start; `cal` is the
 * calendar's view of the sample run.
 */
interface RuleContext {
  nextOf?: (candidate: StartRule | DueRule) => boolean
  runStart: RunStart | null
  cal: CalendarContext | null
}

/** A rule picked on a calendar day: the day kind, with its explicit cycle (Week / Month / Year N). */
function ruleAtDay<R extends StartRule | DueRule>(rule: R, dayNo: number, ctx: PlanContext, lastDay = false): R {
  const kind = dayKindOf(rule.kind) as 'weekday' | 'month_day' | 'year_date'
  const d = dateOfDayNumber(dayNo)
  const cycle = cycleOfDay(kind, dayNo, ctx)
  const time = rule.time
  switch (kind) {
    case 'weekday':
      return { kind, cycle, weekday: d.getUTCDay(), time } as R
    case 'month_day':
      return { kind, cycle, day: lastDay ? 'last' : d.getUTCDate(), time } as R
    default:
      return { kind, cycle, month: d.getUTCMonth() + 1, day: d.getUTCDate(), time } as R
  }
}

/** The params of a rule (everything but its kind), laid out for its kind. */
function RuleParams<R extends StartRule | DueRule>({
  rule,
  f,
  onChange,
  disabled,
  which,
  hasPredecessors,
  invalid,
  ctx,
}: {
  rule: R
  f: Frequency
  onChange: (next: R) => void
  disabled?: boolean
  which: 'start' | 'due'
  hasPredecessors: boolean
  invalid?: boolean
  ctx: RuleContext
}) {
  const set = (patch: Partial<StartRule>) => onChange({ ...rule, ...patch })
  const word = which === 'start' ? 'Start' : 'Due'
  const fallback = which === 'start' ? DEFAULT_START_TIME : DEFAULT_DUE_TIME
  const time = <TimeAt value={rule.time} onChange={(t) => set({ time: t })} disabled={disabled} label={`${word} time`} fallback={fallback} />
  const rs = ctx.runStart

  switch (rule.kind) {
    case 'immediate':
      return null
    case 'days_after_previous':
    case 'days_after_run_start':
    case 'days_after_start': {
      const min = rule.kind === 'days_after_previous' ? 1 : 0
      const n = rule.days ?? min
      const tail =
        rule.kind === 'days_after_start'
          ? 'after step starts, at'
          : rule.kind === 'days_after_run_start'
            ? 'after trigger, at'
            : hasPredecessors
              ? 'after previous step, at'
              : 'after start, at'
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
    case 'time_of_day': {
      const nextWord = nextCycleWord(rule.kind)
      const previous = which === 'start' ? 'the previous step is due' : 'this step starts'
      const landsNext = !!ctx.nextOf?.(rule)
      return (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-[#1E293B]">At</span>
            {time}
            {rs?.type === 'daily' && <InfoTip label="Time" text={`Not before the run starts (${runStartShort(rs)}).`} />}
          </div>
          {landsNext && (
            <p className={NOTE}>
              <span>
                Lands on <span className="font-semibold text-[#0F172A]">{`${fmtTime(rule.time)} (${nextWord})`}</span>
              </span>
              <InfoTip label="Next cycle" text={`It’s before ${previous}, so it moves to the ${nextWord}.`} />
            </p>
          )}
        </div>
      )
    }
    default: {
      const cal = ctx.cal
      if (!cal) return <div className="flex flex-wrap items-center gap-2"><span className="text-sm text-[#1E293B]">At</span>{time}</div>
      const unit = unitOf(rule.kind)
      const sameUnit = (f.type === 'weekly' && unit === 'Week') || (f.type === 'monthly' && unit === 'Month') || (f.type === 'yearly' && unit === 'Year')
      const maxCycle = sameUnit ? maxCycleOf(f) : EXPLICIT_CYCLE_LIMIT[unit === 'Week' ? 'weekly' : unit === 'Month' ? 'monthly' : 'yearly']
      const selected = ruleDay(rule, cal.anchor, cal.ctx, which === 'due')
      const verb = which === 'start' ? 'starts' : 'due'
      return (
        <div className="flex flex-col gap-3">
          <div>
            <span className={SUB}>
              {unit === 'Week' ? 'Day' : 'Date'}{' '}
              <InfoTip
                label={`${word} day`}
                text={`Sample run — holidays may shift dates. Bands are the other steps; striped ones are steps this waits for.${
                  unit === 'Month' ? ' Shorter months use their last day instead.' : ''
                }`}
              />
            </span>
            <TimingCalendar
              label={`${word} day`}
              unit={unit}
              ctx={cal.ctx}
              maxCycle={maxCycle}
              selected={selected}
              minDay={cal.minDay}
              minReason={cal.minReason}
              spans={cal.spans}
              disabled={disabled}
              onPick={(dayNo) => onChange(ruleAtDay(rule, dayNo, cal.ctx))}
              lastDay={
                unit === 'Month'
                  ? {
                      selected: rule.day === 'last',
                      onPick: (cycle) => onChange({ kind: 'month_day', cycle, day: 'last', time: rule.time } as R),
                    }
                  : null
              }
              selfText={`This step — ${verb} ${fmtTime(rule.time || fallback)}`}
            />
            {cal.note}
          </div>
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
 * Where this step sits in the SAMPLE RUN (see timingPlan.ts): when it may start (the run
 * start, or the latest due of the steps before it), every step's planned dates, their
 * names, and which steps it waits for.
 */
export interface StepPlanPosition {
  ctx: PlanContext
  anchor: Date
  planned: Map<string, PlannedDates>
  /** Every step, in display order (bands and their names). */
  names: NamedStep[]
  /** The steps it waits for (its path and "Also waits for"). */
  deps: string[]
  /** Its own id (null for a step being added). */
  selfId: string | null
}

/**
 * A step's timing: when it starts (beside "Starts after") and when it is due. Only the
 * kinds the workflow's current frequency allows are offered; a choice the frequency no
 * longer allows is kept as it is and flagged, so nothing changes behind anyone's back.
 * Days are picked on a calendar of the sample run (`TimingCalendar`): a first step can't
 * use days before the run starts, a later step days before the step it waits for is due,
 * a due date days before the step starts — all greyed out with the reason.
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
  runStart = null,
  position = null,
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
  /** First steps only: where the run starts (days before it are greyed out). */
  runStart?: RunStart | null
  /** Where the step sits in the sample run (the calendar and its greyed days). */
  position?: StepPlanPosition | null
}) {
  const startProblem = problems.find((p) => p.part === 'start')
  const dueProblem = problems.find((p) => p.part === 'due')

  const plannedStart = useMemo(
    () => (position ? resolveStart(plannableRules(start, due, f).start, position.anchor, position.ctx) : null),
    [position, start, due, f],
  )
  const spans = useMemo(
    () => (position ? calendarSpans(position.names, position.planned, position.selfId, position.deps) : []),
    [position],
  )
  // The step it waits for that is due last: its due day is the first day it may use.
  const pred = useMemo(() => {
    if (!position) return null
    const latest = latestPredecessor(position.deps, position.planned, position.selfId)
    if (!latest) return null
    const n = position.names.find((x) => x.id === latest.id)
    return { label: n?.label ?? '?', name: predecessorName(n?.label ?? '?', n?.title), due: latest.due }
  }, [position])

  const startCal: CalendarContext | null = position
    ? (() => {
        const ctx = position.ctx
        const runText = runStart
          ? beforeRunStartText(runStart)
          : `Before the run starts (${dayMonthWords(dayOf(ctx.runStart), ctx.runStart.getUTCFullYear())})`
        const { minDay, reason } = startMinDay(ctx, pred, runText)
        // Same day as the step before is due, at an earlier hour: fine — it waits for it.
        const note =
          pred && startsBeforePredecessorDue(start, ctx, pred.due) ? (
            <SoftNote>{`Starts before ${pred.label} is due. It begins once ${pred.label} is done.`}</SoftNote>
          ) : null
        return { ctx, spans, anchor: position.anchor, minDay, minReason: reason, note }
      })()
    : null
  const dueCal: CalendarContext | null =
    position && plannedStart
      ? (() => {
          const ctx = position.ctx
          const { minDay, reason } = dueMinDay(ctx, plannedStart)
          const note = dueBeforeStartSameDay(due, ctx, plannedStart) ? (
            <SoftNote>{`Due before it starts that day, so it’s due ${fmtTime(due.time)} the next day.`}</SoftNote>
          ) : null
          return { ctx, spans, anchor: plannedStart, minDay, minReason: reason, note }
        })()
      : null

  const startCtx: RuleContext = {
    runStart,
    cal: startCal,
    nextOf: position ? (cand) => calendarOccurrence(cand, position.anchor, position.ctx, false).next : undefined,
  }
  const dueCtx: RuleContext = {
    runStart,
    cal: dueCal,
    nextOf: position && plannedStart ? (cand) => calendarOccurrence(cand, plannedStart, position.ctx, true).next : undefined,
  }

  /** A new day rule starts where it may: the day it may start (start) / its start day (due). */
  const seedFor = (kind: string, at: Date | null | undefined): DaySeed | null => {
    if (!position || !at || (kind !== 'weekday' && kind !== 'month_day' && kind !== 'year_date')) return null
    const dayNo = dayNumber(at)
    const d = dateOfDayNumber(dayNo)
    return { cycle: cycleOfDay(kind, dayNo, position.ctx), weekday: d.getUTCDay(), day: d.getUTCDate(), month: d.getUTCMonth() + 1 }
  }

  // First steps: Immediately / Days after workflow is triggered / the calendar kind; later
  // steps: When previous step is done / Days after previous step / the calendar kind. A
  // first step saved with "Days after previous step" keeps it (it counts from the trigger).
  // A legacy every-2+ rule (cycle_*) shows as its day kind.
  const offered = startKindsFor(f, hasPredecessors)
  const startKinds = !hasPredecessors && start.kind === 'days_after_previous' ? [...offered, start.kind] : offered
  const startValue = startKinds.includes(dayKindOf(start.kind) as StartRuleKind) ? dayKindOf(start.kind) : start.kind
  const startOptions: { value: string; label: string }[] = startKinds.map((k) => ({ value: k, label: startKindLabel(k, f, hasPredecessors) }))
  if (!startKinds.includes(startValue as StartRuleKind)) {
    // Kept as chosen, never changed behind anyone's back; Save says what to do.
    const why = start.kind === 'days_after_run_start' && allowedStartKinds(f).includes(start.kind) ? 'no longer available — pick another' : 'not available'
    startOptions.push({ value: start.kind, label: `${startKindLabel(start.kind, f, hasPredecessors)} (${why})` })
  }
  const dueKinds = dueKindsFor(f)
  const dueValue = dueKinds.includes(dayKindOf(due.kind) as DueRuleKind) ? dayKindOf(due.kind) : due.kind
  const dueOptions: { value: string; label: string }[] = dueKinds.map((k) => ({ value: k, label: dueKindLabel(k, f) }))
  if (!dueKinds.includes(dueValue as DueRuleKind)) dueOptions.push({ value: due.kind, label: `${dueKindLabel(due.kind, f)} (not available)` })

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
                text={
                  start.kind === 'days_after_run_start'
                    ? 'Counts from the day the run is triggered. Holidays shift it to the next working day.'
                    : hasPredecessors
                      ? 'Waits for previous steps. Holidays shift it to the next working day.'
                      : 'Holidays shift it to the next working day.'
                }
              />
            </span>
            <div aria-labelledby={`${idPrefix}-starts-label`} className={startProblem && !startKinds.includes(startValue as StartRuleKind) ? 'rounded-[8px] ring-1 ring-[#DC2626]' : ''}>
              <StyledSelect
                value={startValue}
                onChange={(v) => {
                  if (v === startValue) return
                  onChange({ start_rule: startRuleOfKind(v as StartRuleKind, start, schedules, seedFor(v, position?.anchor)) })
                }}
                options={startOptions}
                disabled={disabled}
              />
            </div>
            {start.kind !== 'immediate' && (
              <div className="mt-3">
                <RuleParams
                  rule={start}
                  f={f}
                  which="start"
                  hasPredecessors={hasPredecessors}
                  disabled={disabled}
                  invalid={!!startProblem}
                  ctx={startCtx}
                  onChange={(r) => onChange({ start_rule: r })}
                />
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
              text={
                due.kind === 'days_after_start'
                  ? 'Days count from this step’s start, skipping holidays and weekly offs.'
                  : isExplicitRule(due)
                    ? 'The day picked. Holidays move it to the next working day.'
                    : 'The next matching date after this step starts.'
              }
            />
          </span>
          <div aria-labelledby={`${idPrefix}-due-label`} className={dueProblem && !dueKinds.includes(dueValue as DueRuleKind) ? 'rounded-[8px] ring-1 ring-[#DC2626]' : ''}>
            <StyledSelect
              value={dueValue}
              onChange={(v) => {
                if (v === dueValue) return
                onChange({ due_rule: dueRuleOfKind(v as DueRuleKind, due, schedules, start, seedFor(v, plannedStart)) })
              }}
              options={dueOptions}
              disabled={disabled}
            />
          </div>
          <div className="mt-3">
            <RuleParams
              rule={due}
              f={f}
              which="due"
              hasPredecessors={hasPredecessors}
              disabled={disabled}
              invalid={!!dueProblem}
              ctx={dueCtx}
              onChange={(r) => onChange({ due_rule: r })}
            />
          </div>
          {dueProblem && <ProblemLine message={dueProblem.message} />}
        </div>
      </div>
    </div>
  )
}
