/*
 * Pure display helpers for the task detail screens (desktop page and phone).
 * No React, no clock: callers pass `now` so these stay unit-testable.
 */

/** "Aryan Shah" -> "AS". Empty for an empty name. */
export function getInitials(name: string): string {
  if (!name) return ''
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
}

const AVATAR_COLORS = [
  'bg-primary', 'bg-text-secondary', 'bg-success',
  'bg-warning', 'bg-danger', 'bg-text-secondary',
]

/** A stable avatar background class for a name. */
export function avatarColor(name: string): string {
  if (!name) return AVATAR_COLORS[0]
  let h = 0
  for (let i = 0; i < name.length; i++) h += name.charCodeAt(i)
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

/** Seconds left in the undo window as "2m 5s" / "40s"; empty once it has run out. */
export function formatCountdown(secs: number): string {
  if (secs <= 0) return ''
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

/** Text colour class for a deadline: overdue = danger, today = warning, otherwise secondary. */
export function deadlineColor(deadline: string | undefined, now: Date): string {
  if (!deadline) return 'text-text-secondary'
  const d = new Date(deadline)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dl = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  if (dl < today) return 'text-danger font-medium'
  if (dl.getTime() === today.getTime()) return 'text-warning font-medium'
  return 'text-text-secondary'
}

/** Seconds from `now` until `expiresAt` (never negative), rounded like the countdown button. */
export function secondsUntil(expiresAt: string, now: Date): number {
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - now.getTime()) / 1000))
}

/** "A, B, C +2 more" for the pending-people heads-up. */
export function namesSummary(names: string[]): string {
  return `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3} more` : ''}`
}
