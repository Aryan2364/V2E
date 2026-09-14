/**
 * The single filter that separates a task's LIVE roster from people who have been
 * taken off it.
 *
 * Removing someone from a task is a SOFT removal (`TaskAssignee.removed_at`): the row
 * survives so compliance reporting can still show that they held the task and what
 * they did with it. Without that, anyone about to be marked late could be quietly
 * removed into a clean scorecard.
 *
 * The consequence is that every read has to declare which roster it wants:
 *
 *   - **Operational reads** — the task's current people, completion gates, n/N counts,
 *     "my tasks", notification recipients, reminders, access/scope checks, proof gates.
 *     These want the LIVE roster: spread `ACTIVE_ASSIGNEE`.
 *
 *   - **Historical reads** — the three compliance reports (person scorecard, ageing,
 *     monthly calendar) and the task's own history feed. These deliberately include
 *     removed people, and grade them by `assigneeOutcome()` below.
 *
 * There is intentionally no global/implicit Prisma filter doing this. It mirrors how
 * `is_deleted: false` is already spelled out at each call site in this codebase — an
 * invisible default is exactly how a removed person silently reappears in a gate.
 */
export const ACTIVE_ASSIGNEE = { removed_at: null } as const;

/**
 * How a removed assignee should be graded by the compliance reports.
 *
 * The rule the removal policy has to satisfy: taking someone off a task must not
 * erase lateness they had already incurred, but must also not invent lateness for
 * someone who was released from the task while it was still perfectly on track.
 *
 * So the removal is judged against that person's own deadline:
 *   - removed BEFORE the deadline, having not finished → `withdrawn`. They were let go
 *     while still in good standing; excluded from on-time/late grading entirely so they
 *     are neither rewarded nor punished. Still listed, so the removal stays visible.
 *   - removed AFTER the deadline, having not finished → `handed_over`. The lateness was
 *     already real at the moment of removal, so it counts — but FROZEN at the handover
 *     (`handoverLateness`), and never as open work. The task is not theirs any more.
 *   - finished before being removed → `graded`. Their completion stands on its own.
 *   - never removed → `graded`, the ordinary case.
 *
 * The two released outcomes differ only in whether the person is graded. Neither may
 * ever be counted as pending/overdue/ageing — use `isReleased()` for that question,
 * and always report WHO the work went to, or the reader is left with a row that looks
 * like an open task belonging to someone who no longer has it.
 */
/**
 * The date a task's punctuality is judged against: the deadline it was FIRST
 * committed to, falling back to the live one for a task with no baseline.
 *
 * Every on-time / late / days-late / ageing-bucket decision — and the persisted
 * `completion_timing` stamp — must use this rather than `Task.deadline`. The live
 * deadline is editable; grading against it means anyone about to be marked late can
 * push the date and come up clean.
 *
 * The live `deadline` remains correct for forward-looking questions: "when is this
 * due", reminder scheduling, the overdue sweep, and date-range filtering of which
 * tasks appear in a report period.
 */
export function gradingDeadline(task: {
  original_deadline?: Date | null;
  deadline?: Date | null;
}): Date | null {
  return task.original_deadline ?? task.deadline ?? null;
}

export type AssigneeOutcome = 'graded' | 'withdrawn' | 'handed_over';

export function assigneeOutcome(
  assignee: { removed_at?: Date | null; is_completed?: boolean; completed_at?: Date | null },
  deadline: Date | null | undefined,
): AssigneeOutcome {
  if (!assignee.removed_at) return 'graded';
  // A completed part is a fact regardless of what happened to the person afterwards.
  if (assignee.is_completed) return 'graded';
  // No deadline to be late against → removal can only ever be a withdrawal.
  if (!deadline) return 'withdrawn';
  return assignee.removed_at < deadline ? 'withdrawn' : 'handed_over';
}

/**
 * Has this person been let go of the work — is it no longer theirs to finish?
 *
 * True for BOTH released outcomes, and that is the whole point of the helper. The
 * reports previously asked only "is this withdrawn?", which meant someone removed
 * AFTER their deadline fell through into the live buckets and was reported as still
 * pending — a manager would read the row, chase them for a task they had not held
 * for weeks, and the report offered no clue who actually had it.
 *
 * Nothing released may ever reach an open/pending/ageing counter. Whether the person
 * is GRADED for it is a separate question, answered by `assigneeOutcome` above:
 * 'withdrawn' is ungraded, 'handed_over' keeps the lateness they had already incurred.
 */
export function isReleased(outcome: AssigneeOutcome): boolean {
  return outcome !== 'graded';
}

/**
 * How late the work already was at the moment it left this person's hands.
 *
 * Frozen at `removed_at` — deliberately not measured against "today". Once the task
 * is someone else's, days keep passing but they are no longer this person's to answer
 * for; charging them for that time is the exact bug this function exists to prevent.
 *
 * Returns 0 for a handover made on or before the deadline (nothing owed yet) and null
 * when there is no deadline or the person was never removed.
 */
export function handoverLateness(
  removedAt: Date | null | undefined,
  deadline: Date | null | undefined,
): number | null {
  if (!removedAt || !deadline) return null;
  const DAY_MS = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((removedAt.getTime() - deadline.getTime()) / DAY_MS));
}
