'use client'

import React from 'react'
import { X, Plus, ChevronDown, ChevronUp } from 'lucide-react'
import DatePicker from '@/components/ui/DatePicker'
import TimeField from '@/components/ui/TimeField'
import type { ReminderSpec, ReminderRecipient } from '@/lib/types/tasks'

// A reminder being edited in a task/recurring form. The assignee is always
// notified; the assigner / CC toggles add extra recipients.
export interface ReminderRow {
  key: string
  kind: 'relative' | 'absolute'
  offsetDays: number // relative: days before deadline
  date: string // absolute: yyyy-mm-dd
  time: string // HH:mm — fire time (relative) / time on the date (absolute)
  toAssigner: boolean
  toCc: boolean
}

/**
 * Small number field for "days before" that stays editable. It keeps its own
 * raw string so the box can be EMPTY while typing (you can clear the 0 and type
 * a new number) — the parent only ever receives a coerced non-negative integer,
 * and an empty box reads as 0 on blur.
 */
function OffsetDaysInput({
  value,
  onChange,
  className,
}: {
  value: number
  onChange: (n: number) => void
  className?: string
}) {
  const [raw, setRaw] = React.useState(String(value))

  // Re-sync only when the external value no longer matches what's typed (e.g. a
  // form reset) — never mid-typing, so it can't stomp an in-progress edit.
  React.useEffect(() => {
    if (parseInt(raw || '0', 10) !== value) setRaw(String(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <input
      type="text"
      inputMode="numeric"
      value={raw}
      onChange={(e) => {
        const v = e.target.value.replace(/^0+(?=\d)/, '') // drop leading zeros
        if (!/^\d*$/.test(v)) return // digits only; allow empty
        setRaw(v)
        onChange(v === '' ? 0 : Math.max(0, parseInt(v, 10)))
      }}
      onBlur={() => { if (raw === '') setRaw('0') }}
      className={className}
    />
  )
}

let reminderSeq = 0
export function makeReminderRow(partial?: Partial<ReminderRow>): ReminderRow {
  return {
    key: `r${(reminderSeq += 1)}`,
    kind: 'relative',
    offsetDays: 1,
    date: '',
    time: '09:00',
    toAssigner: false,
    toCc: false,
    ...partial,
  }
}

// Short read-only label for a reminder, shown in the collapsed summary.
export function reminderLabel(r: ReminderRow): string {
  const extra = [r.toAssigner && 'assigner', r.toCc && 'CC'].filter(Boolean).join(' + ')
  const who = extra ? ` → +${extra}` : ''
  if (r.kind === 'relative') {
    const d = r.offsetDays === 0 ? 'On the day' : `${r.offsetDays} day${r.offsetDays !== 1 ? 's' : ''} before`
    return `${d} · ${r.time || '09:00'}${who}`
  }
  const date = r.date ? new Date(`${r.date}T00:00`).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: '2-digit' }) : 'no date'
  return `On ${date} · ${r.time || '09:00'}${who}`
}

// Convert the rows into ReminderSpecs for the API. For one-time tasks
// (resolveRelative), relative reminders are precomputed to an absolute instant in
// the user's local timezone; for recurring templates they stay relative so each
// spawned instance recomputes against its own deadline.
export function buildReminderSpecs(
  rows: ReminderRow[],
  resolveRelative: boolean,
  deadlineDate?: string,
): ReminderSpec[] {
  const now = Date.now()
  return rows.flatMap((r) => {
    const recipients: ReminderRecipient[] = [
      'assignee',
      ...(r.toAssigner ? (['assigner'] as const) : []),
      ...(r.toCc ? (['cc'] as const) : []),
    ]
    if (r.kind === 'relative') {
      const spec: ReminderSpec = { kind: 'relative', offset_days: r.offsetDays, time: r.time || '09:00', recipients }
      if (resolveRelative && deadlineDate) {
        // One-time: resolve to an absolute instant. If that instant is already
        // in the past (e.g. "1 day before" on a same-day task) it can never
        // fire, so drop it rather than blocking the save.
        const d = new Date(`${deadlineDate}T${r.time || '09:00'}`)
        d.setDate(d.getDate() - r.offsetDays)
        if (d.getTime() <= now) return []
        spec.remind_at = d.toISOString()
      }
      // Recurring keeps it relative (no remind_at) so each instance recomputes it.
      return [spec]
    }
    if (!r.date) return []
    const at = new Date(`${r.date}T${r.time || '09:00'}`)
    if (at.getTime() <= now) return [] // an absolute reminder in the past never fires
    const spec: ReminderSpec = { kind: 'absolute', remind_at: at.toISOString(), recipients }
    return [spec]
  })
}

// Rebuild editable rows from stored specs (edit-recurring prefill).
export function rowsFromReminderSpecs(specs: ReminderSpec[] | undefined | null): ReminderRow[] {
  if (!Array.isArray(specs)) return []
  return specs.map((s) => {
    const recipients = s.recipients ?? []
    if (s.kind === 'relative') {
      return makeReminderRow({
        kind: 'relative',
        offsetDays: s.offset_days ?? 1,
        time: s.time || '09:00',
        toAssigner: recipients.includes('assigner'),
        toCc: recipients.includes('cc'),
      })
    }
    const at = s.remind_at ? new Date(s.remind_at) : null
    return makeReminderRow({
      kind: 'absolute',
      date: at ? `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}` : '',
      time: at ? `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}` : '09:00',
      toAssigner: recipients.includes('assigner'),
      toCc: recipients.includes('cc'),
    })
  })
}

// The absolute moment a reminder would fire (given a one-time deadline date).
function reminderInstant(r: ReminderRow, deadlineDate?: string): Date | null {
  if (r.kind === 'relative') {
    if (!deadlineDate) return null
    const d = new Date(`${deadlineDate}T${r.time || '09:00'}`)
    d.setDate(d.getDate() - r.offsetDays)
    return d
  }
  return r.date ? new Date(`${r.date}T${r.time || '09:00'}`) : null
}

/** True if this reminder would fire in the past (given a one-time deadline). */
export function reminderIsPast(r: ReminderRow, deadlineDate?: string): boolean {
  const at = reminderInstant(r, deadlineDate)
  return !!at && at.getTime() <= Date.now()
}

/**
 * Validate reminders for a one-time task. Only genuine INPUT mistakes block the
 * save (an "on a date" reminder with no date, or one set after the deadline).
 * A reminder that lands in the PAST does NOT block — it simply won't be
 * scheduled (buildReminderSpecs drops it) and the row shows an inline warning —
 * so, e.g., the default "1 day before" reminder never stops a same-day task.
 * Returns an error string, or null if valid.
 */
export function validateRemindersAgainstDeadline(
  rows: ReminderRow[],
  deadlineISO: string | null,
  deadlineDate?: string,
): string | null {
  if (rows.some((r) => r.kind === 'absolute' && !r.date)) return 'Pick a date for each “on a date” reminder.'
  const deadlineInstant = deadlineISO ? new Date(deadlineISO) : null
  for (const r of rows) {
    const at = reminderInstant(r, deadlineDate)
    if (!at) continue
    if (deadlineInstant && at.getTime() > deadlineInstant.getTime()) {
      return `A reminder (${reminderLabel(r)}) is after the deadline. Reminders must be on or before the due date.`
    }
  }
  return null
}

interface Props {
  reminders: ReminderRow[]
  onChange: (rows: ReminderRow[]) => void
  /** 'one_time' gates on a deadline and shows fire-date hints; 'recurring' is always available. */
  mode: 'one_time' | 'recurring'
  /** Selected one-time deadline date (yyyy-mm-dd) — drives hints and the date cap. */
  deadlineDate?: string
  todayStr: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Collapsible "Reminders" card shared by the Create Task modal (both modes) and
 * the Edit Recurring modal. Collapsed it shows a read-only summary; expanded it
 * edits multiple relative/absolute reminder rows with recipient toggles.
 */
export default function RemindersField({ reminders, onChange, mode, deadlineDate, todayStr, open, onOpenChange }: Props) {
  const [gate, setGate] = React.useState<string | null>(null)
  const available = mode === 'recurring' || !!deadlineDate

  // The gate clears itself once reminders become available (deadline set / recurring).
  React.useEffect(() => {
    if (available) setGate(null)
  }, [available])

  function update(key: string, patch: Partial<ReminderRow>) {
    onChange(reminders.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }
  function remove(key: string) {
    onChange(reminders.filter((r) => r.key !== key))
  }
  function add() {
    onChange([...reminders, makeReminderRow()])
  }

  return (
    <div>
      <div className="rounded-xl border border-border-light bg-surface overflow-visible">
        {/* Header — click to expand/collapse; collapsed shows a read-only summary */}
        <button
          type="button"
          onClick={() => {
            if (!available) {
              setGate('Please select a deadline first, then set reminders.')
              return
            }
            setGate(null)
            onOpenChange(!open)
          }}
          aria-expanded={open}
          className="w-full flex items-center gap-2 px-3 py-3 text-left hover:bg-surface-sunken transition-colors"
        >
          <label className="text-sm font-medium text-text-secondary cursor-pointer shrink-0">Reminders</label>
          <span className="text-xs font-normal text-text-secondary shrink-0">Optional</span>
          {available && reminders.length > 0 && (
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-white text-[11px] font-medium shrink-0">
              {reminders.length}
            </span>
          )}
          {!open && available && (
            <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
              {reminders.length === 0
                ? 'None'
                : reminders.length === 1
                  ? reminderLabel(reminders[0])
                  : `${reminderLabel(reminders[0])}  ·  +${reminders.length - 1} more`}
            </span>
          )}
          <span className="ml-auto flex items-center justify-center w-6 h-6 rounded-[6px] text-primary-text shrink-0" aria-hidden>
            {available && reminders.length > 0 ? (
              open ? <ChevronUp size={16} /> : <ChevronDown size={16} />
            ) : (
              <Plus size={18} className={open ? 'rotate-45 transition-transform' : 'transition-transform'} />
            )}
          </span>
        </button>
        {open && (
          <div className="px-3 pb-3 pt-0 space-y-2 max-h-[340px] overflow-y-auto">
            {reminders.length === 0 ? (
              <p className="text-xs text-text-secondary px-1 py-2">No reminders — the assignee won’t be nudged before the deadline.</p>
            ) : (
              reminders.map((r) => {
                let hint: string | null = null
                if (r.kind === 'relative' && mode === 'one_time' && deadlineDate) {
                  const d = new Date(`${deadlineDate}T00:00`)
                  d.setDate(d.getDate() - r.offsetDays)
                  hint = d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: '2-digit' })
                }
                // One-time reminders that land in the past can't fire — warn but
                // don't block; buildReminderSpecs drops them on save.
                const past = mode === 'one_time' && reminderIsPast(r, deadlineDate)
                return (
                  <div key={r.key} className="relative rounded-lg border border-border-light bg-surface-sunken p-3 space-y-2.5">
                    {/* remove — top-right corner */}
                    <button
                      type="button"
                      onClick={() => remove(r.key)}
                      className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-[6px] text-text-muted hover:text-danger hover:bg-surface transition-colors"
                      aria-label="Remove reminder"
                    >
                      <X size={14} />
                    </button>

                    {/* kind toggle — full width, with room reserved for the corner X */}
                    <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-surface-control border border-border-light mr-6">
                      {([
                        { k: 'relative' as const, label: 'Days before' },
                        { k: 'absolute' as const, label: 'On a date' },
                      ]).map(({ k, label }) => {
                        const active = r.kind === k
                        return (
                          <button
                            key={k}
                            type="button"
                            onClick={() => update(r.key, { kind: k })}
                            className={[
                              'px-2 py-1.5 rounded-[6px] text-xs font-medium transition-colors',
                              active ? 'bg-primary text-white' : 'text-text-secondary hover:bg-surface',
                            ].join(' ')}
                          >
                            {label}
                          </button>
                        )
                      })}
                    </div>

                    {/* timing + recipients on one line (wraps only when too narrow) */}
                    <div className="flex items-center gap-x-3 gap-y-2 flex-wrap">
                      {r.kind === 'relative' ? (
                        <div className="flex items-center gap-2">
                          <OffsetDaysInput
                            value={r.offsetDays}
                            onChange={(n) => update(r.key, { offsetDays: n })}
                            className="w-11 text-center border border-border rounded-lg px-2 py-1.5 text-[13px] text-text-primary bg-surface-sunken hover:bg-surface hover:border-border-strong focus:bg-surface focus:border-2 focus:border-primary focus:outline-hidden"
                          />
                          <span className="text-[13px] text-text-secondary">days before</span>
                          <div className="w-[104px]">
                            <TimeField value={r.time} onChange={(v) => update(r.key, { time: v })} label="Reminder time" compact />
                          </div>
                          {hint && <span className="text-xs font-medium text-primary-text">→ {hint}</span>}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="w-[140px]">
                            <DatePicker
                              value={r.date}
                              onChange={(v) => update(r.key, { date: v })}
                              min={todayStr}
                              max={mode === 'one_time' && deadlineDate ? deadlineDate : '2100-12-31'}
                              placeholder="Pick date"
                              compact
                            />
                          </div>
                          <div className="w-[104px]">
                            <TimeField value={r.time} onChange={(v) => update(r.key, { time: v })} label="Reminder time" compact />
                          </div>
                        </div>
                      )}

                      {/* recipients — sit at the right of the same row, wrap under if tight */}
                      <div className="flex items-center gap-1.5 ml-auto">
                        <span className="text-xs text-text-secondary">Notify:</span>
                        <span className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-primary text-white">Assignee</span>
                        <button
                          type="button"
                          onClick={() => update(r.key, { toAssigner: !r.toAssigner })}
                          className={[
                            'px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors',
                            r.toAssigner ? 'bg-primary text-white border-primary' : 'bg-surface text-text-secondary border-border hover:border-border-strong',
                          ].join(' ')}
                        >
                          Assigner
                        </button>
                        <button
                          type="button"
                          onClick={() => update(r.key, { toCc: !r.toCc })}
                          className={[
                            'px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors',
                            r.toCc ? 'bg-primary text-white border-primary' : 'bg-surface text-text-secondary border-border hover:border-border-strong',
                          ].join(' ')}
                        >
                          CC
                        </button>
                      </div>
                    </div>

                    {past && (
                      <p className="flex items-start gap-1.5 text-[11px] text-warning bg-warning-bg border border-warning-border rounded-[6px] px-2 py-1.5">
                        This reminder falls in the past, so it won’t be sent. The task will still save.
                      </p>
                    )}
                  </div>
                )
              })
            )}
            <button
              type="button"
              onClick={add}
              className="flex items-center justify-center gap-1.5 w-full px-3 py-2 text-sm font-medium text-primary-text border border-primary rounded-lg hover:bg-primary-subtle transition-colors"
            >
              <Plus size={14} /> Add reminder
            </button>
          </div>
        )}
      </div>
      {gate && <p className="mt-1.5 text-xs text-danger">{gate}</p>}
    </div>
  )
}
