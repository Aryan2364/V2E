import type { ScorecardMetrics } from '@/lib/types/reports'

// Shared plain-language formatting + meaning-carrying colours for the Person
// Scorecard detail screen. Colour is only ever applied where the value has a
// judgement behind it (performance / lateness); plain counts stay dark grey.

export const INK = 'var(--text-primary)'
export const MUTE = 'var(--text-muted)'
export const GREEN = 'var(--success)'
export const AMBER = 'var(--warning)'
export const RED = 'var(--danger)'

/** Days late as a full-words phrase. Minus = finished early. */
export function daysLatePhrase(n: number | null): string {
  if (n === null || n === undefined) return ''
  if (n === 0) return 'On the due date'
  return n > 0 ? `${n} ${n === 1 ? 'day' : 'days'} late` : `${Math.abs(n)} ${Math.abs(n) === 1 ? 'day' : 'days'} early`
}

/** Compact days-late for a table cell. */
export function daysLateShort(n: number | null): string {
  if (n === null || n === undefined) return '—'
  if (n === 0) return 'On time'
  return n > 0 ? `${n} late` : `${Math.abs(n)} early`
}

export function completionColor(pct: number | null): string {
  if (pct === null) return MUTE
  return pct >= 90 ? GREEN : pct >= 70 ? AMBER : RED
}

export function onTimeColor(pct: number | null): string {
  if (pct === null) return MUTE
  return pct >= 60 ? GREEN : pct >= 30 ? 'var(--success)' : pct >= 15 ? AMBER : RED
}

/** Completed-work delay: early / on time is good, small late is amber, big late is red. */
export function completedDelayColor(days: number | null): string {
  if (days === null) return MUTE
  return days <= 0 ? GREEN : days <= 7 ? AMBER : RED
}

/** Pending-work age: any overdue age is a concern — small amber, large red. */
export function pendingAgeColor(days: number | null): string {
  if (days === null) return MUTE
  return days <= 7 ? AMBER : RED
}

/**
 * One supporting line under the grade tag, built from the person's own figures, so
 * the reader never has to work out *why* the grade was given.
 */
export function gradeReason(m: ScorecardMetrics): string {
  const total = m.total_given
  if (m.grade === 'Too Few Tasks to Judge') {
    return `Only ${total} task ${total === 1 ? 'entry' : 'entries'} in this period; at least 25 are needed to give a fair grade.`
  }

  const completedClause = m.completed === 0 ? 'nothing completed' : `${m.completed} of ${total} completed (${m.completion_pct}%)`
  const onTimeClause = m.completed_with_date > 0 ? `${m.on_time_pct}% finished on time` : null
  const oldest = m.longest_pending_age_days !== null && m.longest_pending_age_days > 0 ? `, oldest ${m.longest_pending_age_days} days late` : ''
  const pendingClause = m.pending > 0 ? `${m.pending} still pending${oldest}` : null

  switch (m.grade) {
    case 'Very Good':
    case 'Good':
    case 'Average':
      return [onTimeClause, completedClause, pendingClause].filter(Boolean).join(', ')
    case 'Late but Closing':
      return `${m.completion_pct}% of work is being closed, but only ${m.on_time_pct}% on time — usually running late rather than ignoring work${m.pending > 0 ? `; ${pendingClause}` : ''}`
    case 'Needs Attention':
    default:
      return [pendingClause, completedClause].filter(Boolean).join(', ')
  }
}
