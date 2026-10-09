import { MANUAL_START } from './engine/schedule'
import { localDateOf } from './engine/tz'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "3 Nov" for `instant` in `tz` — "3 Nov 2025" when that is not the current year (at `now`). */
export function shortDate(instant: Date, tz: string, now: Date): string {
  const d = localDateOf(instant, tz)
  const year = localDateOf(now, tz).year
  return `${d.day} ${MONTHS[d.month - 1]}${d.year !== year ? ` ${d.year}` : ''}`
}

/** "3 Nov 2026" (always with the year) — scheduled instances' automatic names. */
export function dayMonthYear(instant: Date, tz: string): string {
  const d = localDateOf(instant, tz)
  return `${d.day} ${MONTHS[d.month - 1]} ${d.year}`
}

export interface LabelSubject {
  name: string
  trigger_type: string
  metadata?: unknown
  started_at: Date
}

/** A manual instance whose name the person typed in the Run dialog. */
export function hasTypedName(inst: Pick<LabelSubject, 'trigger_type' | 'metadata'>): boolean {
  if (inst.trigger_type !== MANUAL_START) return false
  const m = inst.metadata
  return !!m && typeof m === 'object' && typeof (m as { name?: unknown }).name === 'string' && !!(m as { name: string }).name.trim()
}

/**
 * The instance badge label (task lists, task detail): a manual instance → "<instance
 * name> · <date it started>"; a scheduled one (or a manual one started without a typed
 * name, before names were required) → "<workflow name> · <date>". The date is the org-tz
 * day it started, with the year when it isn't the current year.
 */
export function instanceLabel(inst: LabelSubject, templateName: string, tz: string, now: Date): string {
  const lead = hasTypedName(inst) ? inst.name : templateName
  return `${lead} · ${shortDate(inst.started_at, tz, now)}`
}
