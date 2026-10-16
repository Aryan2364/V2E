import type { RoleLevel } from './types'

/** Pill background + text colors per role level (shared across role UIs). */
export const levelColors: Record<RoleLevel, string> = {
  junior: 'bg-success-bg text-success',
  mid: 'bg-primary-subtle text-primary-text',
  senior: 'bg-warning-bg text-warning',
  head: 'bg-surface-control text-text-secondary',
}

/** Seniority order, most senior first — for sorting role lists. */
export const LEVEL_RANK: Record<RoleLevel, number> = {
  head: 0,
  senior: 1,
  mid: 2,
  junior: 3,
}

export const rankOfLevel = (lvl?: RoleLevel) => (lvl ? LEVEL_RANK[lvl] : 5)
