import { TERMINAL_TYPES } from './status-phase';
import { ACTIVE_ASSIGNEE } from './active-assignee';

/**
 * Org-local day-boundary bucket for a deadline relative to `now` (the org's
 * ClockService "now" — real or simulated). Day boundaries are computed from the
 * calendar date parts of each Date value, the same convention `completionTiming()`
 * in tasks.service.ts already uses for grading — there is no separate per-org
 * timezone conversion elsewhere in this codebase, so this mirrors that.
 */
export function deadlineBucket(
  deadline: Date | null | undefined,
  now: Date,
): 'overdue' | 'today' | 'tomorrow' | 'later' | 'noDate' {
  if (!deadline) return 'noDate';
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((day(new Date(deadline)) - day(now)) / 86_400_000);
  if (diffDays < 0) return 'overdue';
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'tomorrow';
  return 'later';
}

/** Shared "overdue or due today" predicate — used by both the grouped "my tasks" view
 *  and the phone app's badge count, so they can never disagree. */
export function isOverdueOrDueToday(deadline: Date | null | undefined, now: Date): boolean {
  const bucket = deadlineBucket(deadline, now);
  return bucket === 'overdue' || bucket === 'today';
}

/**
 * The single "assigned to me" predicate for badge/overdue purposes: a real
 * (non-CC), live (not soft-removed) assignee, on a task that is not yet terminal
 * (not completed / partially completed / incomplete). Scoped by organization_id —
 * callers must additionally scope by the caller's own user_id (self-scoped, no
 * ScopeService gate needed per AUTHORIZATION.md's recipient-scoped-rows rule).
 */
export function myOpenTasksWhere(orgId: string, userId: string) {
  return {
    organization_id: orgId,
    is_deleted: false,
    assignees: { some: { ...ACTIVE_ASSIGNEE, user_id: userId, is_cc: false } },
    status: { type: { notIn: TERMINAL_TYPES } },
  } as const;
}
