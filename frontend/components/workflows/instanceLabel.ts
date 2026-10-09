// Pure wording for workflow instances (no React, unit-tested). "Run" is only the action
// that starts a workflow; each execution it creates is an "instance", numbered per
// workflow ("Instance #12").

import type { TaskWorkflowRef } from '@/lib/types/tasks'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Instance #12", or "Instance" when the number is not known. */
export function instanceTitle(n: number | null | undefined): string {
  return typeof n === 'number' && n > 0 ? `Instance #${n}` : 'Instance'
}

/** "3 Nov" in the current year, "3 Nov 2025" otherwise. Empty for a bad date. */
export function badgeDate(value: string | Date | null | undefined, now: Date): string {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`
}

const SCHEDULED = new Set(['schedule', 'scheduled', 'date_trigger'])

/** Whether a workflow task's instance was started by a schedule (not run by hand). */
export function isScheduled(w: Pick<TaskWorkflowRef, 'is_scheduled' | 'trigger_type' | 'started_by_name'>): boolean {
  if (typeof w.is_scheduled === 'boolean') return w.is_scheduled
  if (w.trigger_type) return SCHEDULED.has(w.trigger_type)
  return !w.started_by_name
}

/**
 * The text of a workflow task's badge: "<instance name> · 3 Nov" for an instance someone
 * ran, "<workflow name> · 3 Nov" for a scheduled one (the year only when it isn't this
 * year). The server sends it ready-made as `label` (dated in the organisation's time
 * zone); it is built here only for an older response without one.
 */
export function workflowBadgeText(w: TaskWorkflowRef, now: Date): string {
  if (w.label?.trim()) return w.label.trim()
  const scheduled = isScheduled(w)
  const name = (scheduled ? w.template_name : w.instance_name)?.trim() || w.label?.trim() || w.template_name?.trim() || 'Workflow'
  const date = badgeDate(w.started_at, now)
  if (!date) return name
  // The server's label may already end with the date.
  if (name.endsWith(date) || name.endsWith(`${date} ${now.getFullYear()}`)) return name
  return `${name} · ${date}`
}

/** "Instance #12 · Step 2 of 5 · started by Mehul" / "… · started by schedule". */
export function workflowBadgeTip(w: TaskWorkflowRef): string {
  const parts: string[] = [instanceTitle(w.instance_number)]
  if (w.step_label) parts.push(`Step ${w.step_label}${w.total_steps ? ` of ${w.total_steps}` : ''}`)
  if (isScheduled(w)) parts.push('started by schedule')
  else if (w.started_by_name) parts.push(`started by ${w.started_by_name}`)
  return parts.join(' · ')
}
