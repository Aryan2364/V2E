import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataScope } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService } from '../access-rights/scope.service';
import { Principal } from '../access-rights/permissions.service';
import { ClockService } from '../clock/clock.service';
import { isSuccessful, isTerminal } from './status-phase';
import { assigneeOutcome, handoverLateness, isReleased } from './active-assignee';
import { shouldEntryFireToday, type RecurrenceEntry } from '../common/recurrence/should-fire-today';

/**
 * Person Scorecard — a per-person view of workload + discipline, modelled on the
 * client's "Person Wise Task Scorecard" export:
 *   • headline metrics count every task ENTRY (each recurring occurrence + each
 *     one-time task), per person: given / completed / overdue / ongoing / on-time /
 *     late + delay stats. On-Time % (on-time ÷ given) is the real score.
 *   • a Task Data list: one row per entry (title, frequency, dept, assigner, due,
 *     completion, status, delay, on-time) — the export's detail sheet.
 *   • a "unique tasks held" view: recurring templates with cadence + next run.
 *
 * Strictly scope-aware and reuses the SAME visibility model as the rest of Work: a
 * viewer only ever sees people inside their effective scope (own/team/dept/org).
 *
 * ── Two integrity rules this report has to hold ───────────────────────────────
 *
 * 1. GRADE AGAINST THE FROZEN BASELINE, NOT THE LIVE DEADLINE.
 *    `Task.deadline` is editable, so anyone about to be marked late could push the
 *    date and land back on time. Every on-time / late / delay / overdue judgement
 *    below therefore uses `original_deadline ?? deadline` — the date the task was
 *    FIRST committed to (see `baselineOf`). The live `deadline` survives only where
 *    it is shown as forward-looking "when is this due" information, and in the
 *    created_at date-range filter (which never touched a deadline anyway).
 *    `deadline_revision_count` + `original_deadline` ride along on every detail row
 *    so the UI can flag "revised 2x" instead of silently trusting the new date.
 *
 * 2. INCLUDE REMOVED ASSIGNEES, BUT GRADE THEM BY `assigneeOutcome()`.
 *    Removal is a soft delete (`TaskAssignee.removed_at`), so this report deliberately
 *    reads the FULL historical roster — no `ACTIVE_ASSIGNEE` filter — otherwise taking
 *    a late person off a task would wipe the lateness out of their score. People
 *    released while still in good standing ('withdrawn') are counted in their own
 *    `withdrawn` bucket and kept out of every metric and denominator, so they are
 *    neither rewarded nor punished; everyone else is graded exactly as before.
 */

const TASK_LEAF = 'tasks.task.manage';

type Timing = 'early' | 'on_time' | 'late' | 'partial' | 'incomplete' | 'overdue' | 'pending';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 24 * 60 * 60 * 1000;
const ROW_CAP = 80000;

/**
 * The compliance yardstick for a task: the deadline it was FIRST committed to.
 *
 * `original_deadline` is frozen at creation and never rewritten by an edit, so it is
 * immune to someone pushing the date to escape a late mark. The coalesce onto the live
 * `deadline` is deliberate and defensive: a task that never had a deadline has both
 * columns null, and any row that somehow escaped the backfill still grades against
 * something rather than silently becoming "undated" (which would drop it out of the
 * On-Time Rate denominator — a second way to launder a bad score).
 */
function baselineOf(t: { original_deadline?: Date | null; deadline: Date | null }): Date | null {
  return t.original_deadline ?? t.deadline ?? null;
}

export interface ScorecardFilters {
  from_date?: string;
  to_date?: string;
  scope?: DataScope | null;
}

export interface ScorecardPerson {
  user_id: string;
  name: string;
  email: string | null;
  role_title: string | null;
  department_name: string | null;
}

/**
 * The client's "Person Wise Task Compliance Scorecard" grade. Assigned in strict
 * order, first match wins (see `gradeOf`): < 25 entries can't be judged; otherwise
 * the On-Time Rate decides, with a "Late but Closing" rescue for people who close
 * almost everything but always run late.
 */
export type ScorecardGrade =
  | 'Very Good'
  | 'Good'
  | 'Average'
  | 'Late but Closing'
  | 'Needs Attention'
  | 'Too Few Tasks to Judge';

/**
 * The client's discipline metric set, per person. Column-for-column with the
 * "Person Wise Task Compliance Scorecard" sheet:
 *   different_tasks        → Different Tasks Handled (distinct task NAMES = real scope)
 *   total_given            → Total Task Entries (every occurrence + every one-time)
 *   avg_repeat             → Average Times Each Task Repeats (total ÷ different)
 *   completed / pending    → Tasks Completed / Tasks Still Pending (overdue + ongoing)
 *   completion_pct         → Completion Rate (completed ÷ total)
 *   completed_on_time      → Finished On or Before Due Date
 *   on_time_pct            → On Time Rate (on-time ÷ completed-with-a-date; pending kept out)
 *   avg_delay_days         → Average Delay in Days (mean signed delay; minus = early)
 *   longest_delay_days     → Longest Delay in Days
 *   grade                  → Grade
 */
export interface ScorecardMetrics {
  different_tasks: number;      // distinct task NAMES handled — the person's real scope
  recurring_unique: number;     // distinct active recurring templates held (detail view)
  total_given: number;          // every task ENTRY (each occurrence + each one-time)
  avg_repeat: number | null;    // total_given ÷ different_tasks
  completed: number;
  pending: number;              // overdue + ongoing (Tasks Still Pending)
  overdue: number;
  ongoing: number;
  completion_pct: number | null;   // completed ÷ total_given (0–100)
  completed_on_time: number;       // completed with delay ≤ 0
  completed_with_date: number;     // completed entries that carry a completion date + due (on-time denominator)
  completed_no_date: number;       // completed but no completion date entered — a data-entry gap, not a work gap
  on_time_pct: number | null;      // completed_on_time ÷ completed_with_date (0–100)
  avg_delay_days: number | null;   // COMPLETED work only: mean signed delay over completed_with_date (minus = early)
  longest_delay_days: number | null;         // COMPLETED work only: worst single delay
  avg_pending_age_days: number | null;       // PENDING work only: mean (today − due) over overdue tasks
  longest_pending_age_days: number | null;   // PENDING work only: oldest overdue task
  // ── Integrity columns (additive; not part of the client's signed-off column set) ──
  withdrawn: number;         // entries the person was removed from BEFORE their baseline
                             // deadline without finishing (`assigneeOutcome` = 'withdrawn').
                             // Deliberately NOT part of total_given / completed / pending /
                             // any rate or grade denominator — the person was released in
                             // good standing, so they are neither credited nor blamed. Shown
                             // only so the removal stays visible.
  handed_over: number;       // entries that were ALREADY LATE when taken off this person and
                             // given to someone else. Counted in total_given and shown as a
                             // late mark they still own, but deliberately kept out of
                             // pending / overdue / the pending-age averages: the work is no
                             // longer theirs to finish, so it must not read as outstanding
                             // and must not keep ageing after they stopped holding it.
  revised_entries: number;   // graded entries whose deadline has been revised at least once
                             // (deadline_revision_count > 0). A "this score was measured
                             // against a moved goalpost" flag for the UI.
  grade: ScorecardGrade;
}

/** Overall / Total row — same numbers, no grade and no per-person template count. */
export type ScorecardTotals = Omit<ScorecardMetrics, 'grade' | 'recurring_unique'>;

/**
 * Where a task stands *today*, from the dates — independent of the work stage.
 * A task past its due date and not finished is 'overdue' no matter what stage the
 * person left it in.
 */
export type EntryDateStatus =
  | 'completed'
  | 'overdue'
  | 'in_progress'
  | 'not_yet_due'
  | 'closed'
  // Taken off this person and given to someone else. A TERMINAL state for them: it is
  // never pending, never ageing, and never chased. `is_withdrawn` says whether they
  // are graded for it; `handover.to` says who to actually ask about it now.
  | 'handed_over';

/** Where a released entry went, so no reader is left chasing the wrong person. */
export interface HandoverInfo {
  at: string;                       // when they were taken off
  to: string[];                     // who holds it NOW (live roster, may be empty)
  days_late_at_handover: number | null; // frozen lateness they carry; 0 = handed over in time
}

/** One row per task entry — the "Task Data" detail sheet + the person detail list. */
export interface TaskEntryRow {
  task_id: string;
  title: string;
  frequency: string;
  department: string | null;
  assigned_by: string | null;
  due_date: string | null;
  completion_date: string | null;
  status: string | null;              // the work stage label (what the person did)
  date_status: EntryDateStatus;       // where it stands today (from the dates)
  delay_days: number | null;          // completed only: signed (completion − baseline due); minus = early
  days_late: number | null;           // completed → signed delay; overdue → today − baseline due (positive); else null
  on_time: 'Yes' | 'No' | '';
  // ── Integrity columns (additive) ─────────────────────────────────────────────
  original_deadline: string | null;   // the frozen baseline every judgement above used.
                                      // Differs from due_date exactly when the deadline moved.
  deadline_revision_count: number;    // how many times the deadline was pushed/pulled
  is_withdrawn: boolean;              // person was removed before the baseline deadline without
                                      // finishing → listed, but excluded from every metric
  // Set exactly when the person no longer holds this entry (either released outcome).
  // Non-null ⇒ `date_status` is 'handed_over' and this row is NOT open work for them.
  handover: HandoverInfo | null;
}

/** Supporting "unique recurring tasks held" row. */
export interface RecurringRow {
  template_id: string;
  title: string;
  cadence_label: string;
  frequency: string;
  start_date: string | null;
  end_date: string | null;
  next_run: string | null;
  fired: number;
  done: number;
  on_time_rate: number | null;
  last_completed_at: string | null;
  freshness_state: 'current' | 'behind' | 'none';
  freshness_label: string;
  // Occurrences of this template the person was withdrawn from — kept out of
  // fired / done / on_time_rate / the behind-count, surfaced separately.
  withdrawn: number;
  // Occurrences that were already late when handed to someone else. Same exclusion:
  // no longer this person's backlog, so they never age against their cadence.
  handed_over: number;
}

export interface Scorecard {
  employee: ScorecardPerson;
  metrics: ScorecardMetrics;
  recurring_tasks: RecurringRow[];
  entries: TaskEntryRow[];
}

export interface RosterItem extends ScorecardPerson, ScorecardMetrics {}

interface ComputeOpts {
  includeDetail: boolean; // build entries[] + recurring_tasks[] (detail/export); roster skips.
}

// Mutable per-person accumulator used during the fold.
interface Acc {
  employee: ScorecardPerson;
  titles: Set<string>;       // distinct task names → Different Tasks Handled
  total: number;
  completed: number;
  overdue: number;
  ongoing: number;
  onTime: number;            // completed with delay ≤ 0
  completedWithDate: number; // completed entries that carry both a completion date and a due date
  noDate: number;            // completed but no completion date entered
  delaySum: number;          // Σ signed delay over completedWithDate (minus = early)
  delayMax: number | null;   // worst (max) signed delay, or null if none
  pendingAgeSum: number;     // Σ (today − due) over overdue tasks
  pendingAgeMax: number | null; // oldest overdue task, or null if none
  withdrawn: number;         // entries released in good standing — no other counter sees them
  handedOver: number;        // entries already late when passed to someone else — a late mark
                             // that never reaches overdue/pendingAge (not their work any more)
  revised: number;           // graded entries whose deadline was revised at least once
  entries: TaskEntryRow[];
}

/** Raw counts needed to finalize a metric block (per-person or the overall total). */
interface RawCounts {
  different: number;
  total: number;
  completed: number;
  overdue: number;
  ongoing: number;
  onTime: number;
  completedWithDate: number;
  noDate: number;
  delaySum: number;
  delayMax: number | null;
  pendingAgeSum: number;
  pendingAgeMax: number | null;
  withdrawn: number;
  handedOver: number;
  revised: number;
}

/** The client's grade ladder — strict order, first match wins. */
function gradeOf(total: number, onRate: number, completionRate: number): ScorecardGrade {
  if (total < 25) return 'Too Few Tasks to Judge';
  if (onRate >= 0.6) return 'Very Good';
  if (onRate >= 0.3) return 'Good';
  if (onRate >= 0.15) return 'Average';
  if (completionRate >= 0.9) return 'Late but Closing';
  return 'Needs Attention';
}

/** Turn raw counts into the display metric block (percentages, averages, grade). */
function finalize(r: RawCounts): ScorecardMetrics {
  const onRate = r.completedWithDate > 0 ? r.onTime / r.completedWithDate : 0;
  const completionRate = r.total > 0 ? r.completed / r.total : 0;
  return {
    different_tasks: r.different,
    recurring_unique: 0, // filled in by the caller (kept out of the raw fold)
    total_given: r.total,
    avg_repeat: r.different > 0 ? Math.round((r.total / r.different) * 100) / 100 : null,
    completed: r.completed,
    pending: r.overdue + r.ongoing,
    overdue: r.overdue,
    ongoing: r.ongoing,
    completion_pct: r.total > 0 ? Math.round(completionRate * 100) : null,
    completed_on_time: r.onTime,
    completed_with_date: r.completedWithDate,
    completed_no_date: r.noDate,
    on_time_pct: r.completedWithDate > 0 ? Math.round(onRate * 100) : null,
    avg_delay_days: r.completedWithDate > 0 ? Math.round((r.delaySum / r.completedWithDate) * 100) / 100 : null,
    longest_delay_days: r.delayMax,
    avg_pending_age_days: r.overdue > 0 ? Math.round((r.pendingAgeSum / r.overdue) * 100) / 100 : null,
    longest_pending_age_days: r.pendingAgeMax,
    withdrawn: r.withdrawn,
    handed_over: r.handedOver,
    revised_entries: r.revised,
    // `r.total` already excludes withdrawn entries, so the grade is computed over what
    // the person actually still owed. Note the deliberate consequence: releasing someone
    // in good standing from enough work CAN drop them under the 25-entry floor into
    // "Too Few Tasks to Judge". That is the correct reading — there is genuinely too
    // little left to judge — and `withdrawn` is published beside it so the reason is
    // visible rather than mysterious.
    grade: gradeOf(r.total, onRate, completionRate),
  };
}

@Injectable()
export class PersonScorecardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly clock: ClockService,
  ) {}

  // ─── Public API ────────────────────────────────────────────────────────────────

  /** Scope-aware roster: the client's metric set per person the viewer may open. */
  async getRoster(orgId: string, principal: Principal, requested?: DataScope | null) {
    const { max, effective } = await this.scope.resolveListScope(orgId, principal, TASK_LEAF, requested ?? null);
    if (effective === null) return { people: [] as RosterItem[], applied_scope: null, max_scope: max };

    const visible = await this.scope.visibleUserIds(orgId, principal.userId, effective);
    const now = await this.clock.now(orgId);
    const cards = await this.compute(orgId, visible, {}, now, { includeDetail: false });

    const people: RosterItem[] = Array.from(cards.values())
      .map((c) => ({ ...c.employee, ...c.metrics }))
      .sort((a, b) => b.total_given - a.total_given || a.name.localeCompare(b.name));

    return { people, totals: this.totalsOf(cards.values()), applied_scope: effective, max_scope: max };
  }

  /** One person's full scorecard — gated: 403 if outside the viewer's scope. */
  async getScorecard(orgId: string, principal: Principal, targetUserId: string, filters: ScorecardFilters): Promise<Scorecard> {
    const { effective } = await this.scope.resolveListScope(orgId, principal, TASK_LEAF, undefined);
    if (effective === null) throw new ForbiddenException('You do not have access to task data');
    const visible = await this.scope.visibleUserIds(orgId, principal.userId, effective);
    if (visible !== 'ALL' && !visible.includes(targetUserId)) {
      throw new ForbiddenException('This employee is outside your visibility scope');
    }

    const now = await this.clock.now(orgId);
    const cards = await this.compute(orgId, [targetUserId], filters, now, { includeDetail: true });
    const card = cards.get(targetUserId);
    if (!card) throw new NotFoundException('Employee not found');
    return card;
  }

  /** Every in-scope person's full scorecard — powers "download everyone". */
  async getAllScorecards(orgId: string, principal: Principal, filters: ScorecardFilters) {
    const { max, effective } = await this.scope.resolveListScope(orgId, principal, TASK_LEAF, filters.scope ?? null);
    if (effective === null) return { cards: [] as Scorecard[], applied_scope: null, max_scope: max };

    const visible = await this.scope.visibleUserIds(orgId, principal.userId, effective);
    const now = await this.clock.now(orgId);
    const cards = await this.compute(orgId, visible, filters, now, { includeDetail: true });
    const sorted = Array.from(cards.values()).sort((a, b) => b.metrics.total_given - a.metrics.total_given || a.employee.name.localeCompare(b.employee.name));

    return {
      cards: sorted,
      totals: this.totalsOf(sorted),
      applied_scope: effective,
      max_scope: max,
    };
  }

  // ─── Core builder ────────────────────────────────────────────────────────────--

  private async compute(
    orgId: string,
    targetUserIds: string[] | 'ALL',
    filters: ScorecardFilters,
    now: Date,
    opts: ComputeOpts,
  ): Promise<Map<string, Scorecard>> {
    // Default window = all-time (like the client's "data as on" report). A supplied
    // range narrows entries by the date they were CREATED — never by a deadline — so
    // it is untouched by the baseline switch: revising a deadline can neither pull a
    // task into the window nor push it out of one.
    const from = filters.from_date ? new Date(filters.from_date) : null;
    const to = filters.to_date ? new Date(filters.to_date) : null;
    const dateWhere = from || to ? { created_at: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {};

    const people = await this.loadPeople(orgId, targetUserIds);
    const acc = new Map<string, Acc>();
    for (const p of people) {
      acc.set(p.user_id, {
        employee: p,
        titles: new Set<string>(),
        total: 0, completed: 0, overdue: 0, ongoing: 0, onTime: 0, completedWithDate: 0, noDate: 0,
        delaySum: 0, delayMax: null, pendingAgeSum: 0, pendingAgeMax: null, withdrawn: 0, handedOver: 0, revised: 0,
        entries: [],
      });
    }
    if (acc.size === 0) return new Map();

    const idSet = new Set(acc.keys());
    const inTarget = (uid: string | null | undefined) => !!uid && idSet.has(uid);
    const assigneeUserFilter = targetUserIds === 'ALL' ? undefined : { in: Array.from(idSet) };
    const deptOf = new Map(people.map((p) => [p.user_id, p.department_name]));

    // Frequency label per template (all templates, incl. paused) + assigner names.
    // uniqueCounts = distinct active recurring templates each person holds (cheap;
    // always computed so the roster can show it too).
    const [freqByTemplate, uniqueCounts, holderTable] = await Promise.all([
      this.frequencyMap(orgId),
      this.recurringUniqueCounts(orgId, idSet),
      opts.includeDetail ? this.recurringHoldings(orgId, idSet, now) : Promise.resolve(new Map<string, RecurringRow[]>()),
    ]);

    // One pass over every task assigned to the target set (one-time + recurring occurrences).
    const tasks = await this.prisma.task.findMany({
      where: {
        organization_id: orgId,
        is_deleted: false,
        ...dateWhere,
        assignees: { some: { is_cc: false, ...(assigneeUserFilter ? { user_id: assigneeUserFilter } : {}) } },
      },
      select: {
        id: true,
        title: true,
        recurring_template_id: true,
        created_by_user_id: true,
        deadline: true,
        original_deadline: true,        // the frozen grading baseline
        deadline_revision_count: true,  // revision transparency for the detail rows
        completed_at: true,
        completed_by_user_id: true,
        completion_timing: true,
        completion_mode: true,
        is_overdue: true,
        status: { select: { label: true, type: true } },
        // NOTE: deliberately NOT filtered by ACTIVE_ASSIGNEE. This is a historical
        // compliance read: removed people must stay in the roster so lateness they had
        // already incurred cannot be deleted by taking them off the task. `removed_at`
        // is selected so `assigneeOutcome()` can sort them into graded vs withdrawn.
        assignees: {
          where: { is_cc: false },
          select: { user_id: true, is_completed: true, completed_at: true, cannot_complete: true, removed_at: true },
        },
      },
      take: ROW_CAP,
    });

    // Resolve assigner names once — plus the name of anyone who currently holds a task
    // that somebody was taken off, so a released row can say WHO to ask instead of
    // leaving the reader to chase the person who no longer has it.
    const nameIds = new Set<string>();
    for (const t of tasks) {
      if (t.created_by_user_id) nameIds.add(t.created_by_user_id);
      // Only tasks that actually saw a removal need their live roster named.
      if (t.assignees.some((a) => a.removed_at)) {
        for (const a of t.assignees) if (!a.removed_at) nameIds.add(a.user_id);
      }
    }
    const named = nameIds.size
      ? await this.prisma.user.findMany({ where: { id: { in: Array.from(nameIds) } }, select: { id: true, name: true } })
      : [];
    const creatorName = new Map(named.map((c) => [c.id, c.name]));

    for (const t of tasks) {
      const frequency = t.recurring_template_id ? (freqByTemplate.get(t.recurring_template_id) ?? 'Recurring') : 'One-time';
      // `deadline` = the live/working date, shown to the user as "when is this due".
      // `baseline` = the date the task was first committed to; EVERY on-time / late /
      // delay / overdue judgement below uses this one, so pushing the deadline cannot
      // retroactively rescue a late task.
      const deadline = t.deadline ?? null;
      const baseline = baselineOf(t);
      const past = !!baseline && baseline <= now;
      const anyCan = t.completion_mode !== 'all_must_complete';
      // Who the work sits with TODAY. Empty only if the task was left with nobody —
      // itself worth showing, so the row reads "no one" rather than staying silent.
      const heldNowBy = t.assignees
        .filter((a) => !a.removed_at)
        .map((a) => creatorName.get(a.user_id))
        .filter((n): n is string => !!n);

      for (const a of t.assignees) {
        if (!inTarget(a.user_id)) continue;
        const row = acc.get(a.user_id)!;

        // Per-person completion for this entry.
        const completed = anyCan ? isSuccessful(t.status?.type) : a.is_completed;
        const completionDate = anyCan ? (t.completed_at ?? null) : (a.completed_at ?? null);

        // How a removed person is graded. `completed` (not `a.is_completed`) is fed in
        // on purpose: in any_can_complete mode the win is recorded on the task, not on
        // the assignee row, and "finished before being removed → graded" has to hold in
        // both completion modes. The removal is judged against the BASELINE deadline too
        // — otherwise pushing the date out first would turn an already-late person's
        // removal into a clean "withdrawal".
        const outcome = assigneeOutcome({ removed_at: a.removed_at, is_completed: completed }, baseline);
        const withdrawn = outcome === 'withdrawn';
        const released = isReleased(outcome);

        // Signed delay + on-time, against the BASELINE. Judgeable only when the entry is
        // completed AND carries both a completion date and a baseline due date (matches
        // the client sheet: pending / undated tasks are kept out of the On-Time Rate
        // denominator).
        let delayDays: number | null = null;
        let onTime: 'Yes' | 'No' | '' = '';
        const hasDates = completed && !!completionDate && !!baseline;
        if (hasDates) {
          delayDays = Math.floor((completionDate!.getTime() - baseline!.getTime()) / DAY_MS);
          onTime = delayDays <= 0 ? 'Yes' : 'No'; // finished on OR before due = on time
        }

        // Where the entry stands TODAY (from the dates) + how late it is.
        //   completed    → done; days_late = signed completion − due
        //   overdue      → open and past due; days_late = today − due (positive, grows daily)
        //   in_progress  → open, not past due, work started
        //   not_yet_due  → open, not past due, work not started
        //   closed       → terminally closed but not a success (partial / incomplete)
        const terminalNotSuccess = !completed && isTerminal(t.status?.type);
        let dateStatus: EntryDateStatus;
        let daysLate: number | null = null;
        if (released) {
          // TERMINAL for this person, and checked before every open state on purpose.
          // They no longer hold the task, so it is not overdue/in-progress/pending for
          // them and must never appear as work to chase. Any lateness is frozen at the
          // handover — letting it keep growing would charge them for days the task was
          // sitting in someone else's queue.
          dateStatus = 'handed_over';
          daysLate = withdrawn ? null : handoverLateness(a.removed_at, baseline);
        } else if (completed) {
          dateStatus = 'completed';
          daysLate = delayDays; // signed; may be early (negative) or null if no dates
        } else if (terminalNotSuccess) {
          dateStatus = 'closed';
        } else if (past) {
          // Past its BASELINE and still open ⇒ overdue, however far the live deadline
          // has since been pushed out. This is the one existing field whose meaning
          // genuinely shifts: "overdue" is now measured against the original commitment.
          dateStatus = 'overdue';
          daysLate = Math.floor((now.getTime() - baseline!.getTime()) / DAY_MS);
        } else {
          dateStatus = t.status?.type === 'in_progress' ? 'in_progress' : 'not_yet_due';
        }

        // Released entries — the work is no longer theirs. Both kinds leave here before
        // touching a single open-work counter (`overdue`, `ongoing`, `pendingAge*`), so
        // neither can ever be read as something still owed by this person.
        //
        // They differ only in whether the person is graded:
        //   withdrawn   — let go before it was due. Ungraded: out of total_given, the
        //                 distinct-title count, every rate and the grade denominator.
        //   handed_over — already late when passed on. The lateness is real and stays
        //                 on their record (counted in total_given and `handed_over`,
        //                 frozen at the handover date), but it is a CLOSED late mark,
        //                 not outstanding work.
        if (released) {
          if (withdrawn) {
            row.withdrawn += 1;
          } else {
            row.total += 1;
            row.titles.add(t.title);
            if (t.deadline_revision_count > 0) row.revised += 1;
            row.handedOver += 1;
          }
          if (opts.includeDetail) {
            row.entries.push(this.entryRow(t, a, {
              frequency,
              department: deptOf.get(a.user_id) ?? null,
              assignedBy: t.created_by_user_id ? creatorName.get(t.created_by_user_id) ?? null : null,
              deadline,
              completionDate,
              dateStatus,
              delayDays: null,
              daysLate,
              onTime: '',
              withdrawn,
              handedOverTo: heldNowBy,
            }));
          }
          continue;
        }

        // Metric buckets. Total = every entry given; distinct titles = real scope.
        row.total += 1;
        row.titles.add(t.title);
        if (t.deadline_revision_count > 0) row.revised += 1;
        if (completed) {
          row.completed += 1;
          if (hasDates) {
            row.completedWithDate += 1;
            row.delaySum += delayDays!;
            if (row.delayMax === null || delayDays! > row.delayMax) row.delayMax = delayDays!;
            if (onTime === 'Yes') row.onTime += 1;
          } else {
            row.noDate += 1; // completed but no date entered — a data gap, not a work gap
          }
        } else if (dateStatus === 'overdue') {
          row.overdue += 1;
          row.pendingAgeSum += daysLate!;
          if (row.pendingAgeMax === null || daysLate! > row.pendingAgeMax) row.pendingAgeMax = daysLate!;
        } else if (!terminalNotSuccess) {
          row.ongoing += 1;
        }

        if (opts.includeDetail) {
          row.entries.push(this.entryRow(t, a, {
            frequency,
            department: deptOf.get(a.user_id) ?? null,
            assignedBy: t.created_by_user_id ? creatorName.get(t.created_by_user_id) ?? null : null,
            deadline, completionDate, dateStatus, delayDays, daysLate, onTime, withdrawn: false,
            handedOverTo: heldNowBy,
          }));
        }
      }
    }

    // Assemble.
    const out = new Map<string, Scorecard>();
    for (const [uid, r] of acc) {
      const metrics = finalize(this.rawOf(r));
      metrics.recurring_unique = uniqueCounts.get(uid) ?? 0;
      if (opts.includeDetail) {
        r.entries.sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));
      }
      out.set(uid, {
        employee: r.employee,
        metrics,
        recurring_tasks: holderTable.get(uid) ?? [],
        entries: r.entries,
      });
    }
    return out;
  }

  /**
   * Build one "Task Data" detail row. Shared by the graded and the withdrawn path so
   * the two can never drift in shape.
   *
   * `due_date` is the LIVE deadline on purpose — the detail list doubles as a
   * forward-looking "what do I owe and when" view, and showing a stale original date
   * there would be actively misleading. The grading columns beside it (`delay_days`,
   * `days_late`, `on_time`) were all computed against `original_deadline`, which is
   * published alongside so the two dates can be compared instead of conflated.
   */
  private entryRow(
    t: {
      id: string; title: string; deadline: Date | null;
      original_deadline: Date | null; deadline_revision_count: number;
      status: { label: string; type: string } | null;
    },
    a: { removed_at: Date | null },
    x: {
      frequency: string; department: string | null; assignedBy: string | null;
      deadline: Date | null; completionDate: Date | null; dateStatus: EntryDateStatus;
      delayDays: number | null; daysLate: number | null; onTime: 'Yes' | 'No' | ''; withdrawn: boolean;
      handedOverTo?: string[];
    },
  ): TaskEntryRow {
    return {
      task_id: t.id,
      title: t.title,
      frequency: x.frequency,
      department: x.department,
      assigned_by: x.assignedBy,
      due_date: x.deadline ? x.deadline.toISOString() : null,
      completion_date: x.completionDate ? x.completionDate.toISOString() : null,
      status: t.status?.label ?? null,
      date_status: x.dateStatus,
      delay_days: x.delayDays,
      days_late: x.daysLate,
      on_time: x.onTime,
      // Report the effective baseline (post-coalesce), not the raw column: this is the
      // date the row was actually graded against, which is what the UI needs to explain
      // a score. Equal to due_date whenever the deadline was never moved.
      original_deadline: (t.original_deadline ?? t.deadline)?.toISOString() ?? null,
      deadline_revision_count: t.deadline_revision_count,
      is_withdrawn: x.withdrawn,
      // Present exactly when the person has been taken off. Carrying the receiving
      // name here is the difference between "Seema, overdue" (wrong, and a dead end
      // for whoever reads it) and "left Seema on 22 Sep, 75 days late — now with
      // Ajay Rathod", which tells the reader both what happened and who to ask.
      handover: a.removed_at
        ? {
            at: a.removed_at.toISOString(),
            to: x.handedOverTo ?? [],
            days_late_at_handover: x.daysLate,
          }
        : null,
    };
  }

  /** Project a per-person accumulator to the raw counts `finalize` needs. */
  private rawOf(r: Acc): RawCounts {
    return {
      different: r.titles.size,
      total: r.total,
      completed: r.completed,
      overdue: r.overdue,
      ongoing: r.ongoing,
      onTime: r.onTime,
      completedWithDate: r.completedWithDate,
      noDate: r.noDate,
      delaySum: r.delaySum,
      delayMax: r.delayMax,
      pendingAgeSum: r.pendingAgeSum,
      pendingAgeMax: r.pendingAgeMax,
      withdrawn: r.withdrawn,
      handedOver: r.handedOver,
      revised: r.revised,
    };
  }

  /**
   * The Overall / Total row. Sums are additive (incl. Different Tasks Handled =
   * Σ per-person distinct counts, exactly like the client sheet), then ratios and
   * the average delay are recomputed from the summed raw — never averaged twice.
   */
  private totalsOf(cards: Iterable<Scorecard>): ScorecardTotals {
    const agg: RawCounts = {
      different: 0, total: 0, completed: 0, overdue: 0, ongoing: 0,
      onTime: 0, completedWithDate: 0, noDate: 0, delaySum: 0, delayMax: null,
      pendingAgeSum: 0, pendingAgeMax: null, withdrawn: 0, handedOver: 0, revised: 0,
    };
    for (const c of cards) {
      const m = c.metrics;
      agg.different += m.different_tasks;
      agg.total += m.total_given;
      agg.completed += m.completed;
      agg.overdue += m.overdue;
      agg.ongoing += m.ongoing;
      agg.onTime += m.completed_on_time;
      agg.completedWithDate += m.completed_with_date;
      agg.noDate += m.completed_no_date;
      if (m.completed_with_date > 0 && m.avg_delay_days !== null) agg.delaySum += m.avg_delay_days * m.completed_with_date;
      if (m.longest_delay_days !== null && (agg.delayMax === null || m.longest_delay_days > agg.delayMax)) agg.delayMax = m.longest_delay_days;
      // Withdrawn stays its OWN total — never folded into total_given / completed /
      // on-time / late, so the Totals row reads "N entries graded, plus M withdrawn".
      agg.withdrawn += m.withdrawn;
      agg.handedOver += m.handed_over;
      agg.revised += m.revised_entries;
      if (m.overdue > 0 && m.avg_pending_age_days !== null) agg.pendingAgeSum += m.avg_pending_age_days * m.overdue;
      if (m.longest_pending_age_days !== null && (agg.pendingAgeMax === null || m.longest_pending_age_days > agg.pendingAgeMax)) agg.pendingAgeMax = m.longest_pending_age_days;
    }
    const { grade: _drop, recurring_unique: _r, ...totals } = finalize(agg);
    return totals;
  }

  // ─── Unique recurring holdings (cadence + next run + freshness) ───────────────---

  private async recurringHoldings(orgId: string, idSet: Set<string>, now: Date): Promise<Map<string, RecurringRow[]>> {
    const templates = await this.prisma.recurringTemplate.findMany({
      where: { organization_id: orgId, is_active: true },
      select: {
        id: true,
        title: true,
        assignee_user_ids: true,
        schedule_entries: {
          where: { is_active: true },
          orderBy: { order_index: 'asc' },
          select: {
            schedule_type: true, every: true, days: true, month_days: true, yearly_dates: true,
            time: true, start_date: true, end_date: true, end_condition: true, end_after: true,
            occurrence_count: true, is_active: true,
          },
        },
      },
    });

    // Per (template, user) occurrence tally over ALL occurrences (for freshness).
    type Agg = { fired: number; done: number; onTime: number; withdrawn: number; handedOver: number; lastCompleted: Date | null; dueOpen: Date[] };
    const agg = new Map<string, Agg>();
    const keyOf = (tid: string, uid: string) => `${tid}:${uid}`;

    const templateIds = templates.map((t) => t.id);
    if (templateIds.length) {
      const occ = await this.prisma.task.findMany({
        where: { organization_id: orgId, recurring_template_id: { in: templateIds }, is_deleted: false },
        select: {
          recurring_template_id: true, deadline: true, original_deadline: true, completed_at: true,
          completed_by_user_id: true, completion_timing: true, completion_mode: true, is_overdue: true,
          status: { select: { type: true } },
          // Full historical roster again (no ACTIVE_ASSIGNEE) — see the main query.
          assignees: { where: { is_cc: false }, select: { user_id: true, is_completed: true, completed_at: true, removed_at: true } },
        },
        take: ROW_CAP,
      });
      for (const o of occ) {
        const tid = o.recurring_template_id!;
        const timing = this.timing(o);
        // Baseline again for every late / behind judgement in this tally.
        const baseline = baselineOf(o);
        const past = !!baseline && baseline <= now;
        const anyCan = o.completion_mode !== 'all_must_complete';
        for (const a of o.assignees) {
          if (!idSet.has(a.user_id)) continue;
          const k = keyOf(tid, a.user_id);
          let row = agg.get(k);
          if (!row) { row = { fired: 0, done: 0, onTime: 0, withdrawn: 0, handedOver: 0, lastCompleted: null, dueOpen: [] }; agg.set(k, row); }

          let done = false; let doneAt: Date | null = null; let late = false;
          if (!anyCan) {
            if (a.is_completed) { done = true; doneAt = a.completed_at ?? null; late = !!(a.completed_at && baseline && a.completed_at > baseline); }
          } else if ((timing === 'early' || timing === 'on_time' || timing === 'late') && o.completed_by_user_id === a.user_id) {
            done = true; doneAt = o.completed_at ?? null;
            // `completion_timing` was stamped against the live deadline at completion
            // time, so re-derive lateness from the baseline whenever we have both dates.
            late = doneAt && baseline ? doneAt > baseline : timing === 'late';
          }

          // Occurrences the person no longer holds are counted on their own and left out
          // of fired / done / on_time_rate and — critically — out of `dueOpen`, which
          // drives the "behind" count. An occurrence sitting in someone else's queue is
          // not this person's backlog, so it must never age against their cadence.
          const occOutcome = assigneeOutcome({ removed_at: a.removed_at, is_completed: done }, baseline);
          if (isReleased(occOutcome)) {
            if (occOutcome === 'withdrawn') row.withdrawn += 1;
            else row.handedOver += 1;
            continue;
          }

          row.fired += 1;
          if (done) {
            row.done += 1;
            if (!late) row.onTime += 1;
            if (doneAt && (!row.lastCompleted || doneAt > row.lastCompleted)) row.lastCompleted = doneAt;
          } else if (past) {
            row.dueOpen.push(baseline!);
          }
        }
      }
    }

    const byUser = new Map<string, RecurringRow[]>();
    for (const tpl of templates) {
      const holders = (Array.isArray(tpl.assignee_user_ids) ? tpl.assignee_user_ids : []) as string[];
      const entries = tpl.schedule_entries as unknown as RecurrenceEntry[];
      const cadence = this.cadenceLabel(tpl.schedule_entries);
      const frequency = this.frequencyLabel(tpl.schedule_entries);
      const startDate = this.earliestStart(tpl.schedule_entries);
      const endDate = this.latestEnd(tpl.schedule_entries);
      const nextRun = this.nextRun(entries, now);
      for (const uid of holders) {
        if (!idSet.has(uid)) continue;
        const a = agg.get(keyOf(tpl.id, uid));
        const behind = a ? a.dueOpen.filter((d) => !a.lastCompleted || d > a.lastCompleted).length : 0;
        const fired = a?.fired ?? 0;
        const done = a?.done ?? 0;
        const fresh = this.freshness(fired, behind);
        const list = byUser.get(uid) ?? [];
        list.push({
          template_id: tpl.id, title: tpl.title, cadence_label: cadence, frequency,
          start_date: startDate, end_date: endDate, next_run: nextRun,
          fired, done, on_time_rate: done > 0 ? Math.round(((a?.onTime ?? 0) / done) * 100) : null,
          last_completed_at: a?.lastCompleted ? a.lastCompleted.toISOString() : null,
          freshness_state: fresh.state, freshness_label: fresh.label,
          withdrawn: a?.withdrawn ?? 0,
          handed_over: a?.handedOver ?? 0,
        });
        byUser.set(uid, list);
      }
    }
    for (const list of byUser.values()) list.sort((a, b) => a.title.localeCompare(b.title));
    return byUser;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────--

  /** Distinct active recurring templates each in-scope person is assigned to. */
  private async recurringUniqueCounts(orgId: string, idSet: Set<string>): Promise<Map<string, number>> {
    const templates = await this.prisma.recurringTemplate.findMany({
      where: { organization_id: orgId, is_active: true },
      select: { assignee_user_ids: true },
    });
    const counts = new Map<string, number>();
    for (const t of templates) {
      const holders = (Array.isArray(t.assignee_user_ids) ? t.assignee_user_ids : []) as string[];
      for (const uid of holders) if (idSet.has(uid)) counts.set(uid, (counts.get(uid) ?? 0) + 1);
    }
    return counts;
  }

  private async frequencyMap(orgId: string): Promise<Map<string, string>> {
    const templates = await this.prisma.recurringTemplate.findMany({
      where: { organization_id: orgId },
      select: { id: true, schedule_entries: { select: { schedule_type: true } } },
    });
    return new Map(templates.map((t) => [t.id, this.frequencyLabel(t.schedule_entries)]));
  }

  private async loadPeople(orgId: string, targetUserIds: string[] | 'ALL'): Promise<ScorecardPerson[]> {
    const profiles = await this.prisma.employeeProfile.findMany({
      where: {
        organization_id: orgId,
        ...(targetUserIds === 'ALL' ? {} : { user_id: { in: targetUserIds } }),
      },
      select: {
        user_id: true,
        user: { select: { id: true, name: true, email: true } },
        role: { select: { title: true } },
        department: { select: { name: true } },
      },
    });
    return profiles
      .filter((p) => p.user)
      .map((p) => ({
        user_id: p.user_id,
        name: p.user!.name,
        email: p.user!.email,
        role_title: p.role?.title ?? null,
        department_name: p.department?.name ?? null,
      }));
  }

  private timing(t: { completion_timing: string | null; is_overdue: boolean; status: { type: string } | null }): Timing {
    if (t.completion_timing) return t.completion_timing as Timing;
    const phase = t.status?.type;
    if (phase === 'completed') return 'on_time';
    if (phase === 'partially_completed') return 'partial';
    if (phase === 'incomplete') return 'incomplete';
    return t.is_overdue ? 'overdue' : 'pending';
  }

  private freshness(fired: number, behind: number): { state: 'current' | 'behind' | 'none'; label: string } {
    if (fired === 0) return { state: 'none', label: '—' };
    if (behind > 0) return { state: 'behind', label: `${behind} behind` };
    return { state: 'current', label: 'Up to date' };
  }

  private jsonArr(value: unknown): number[] {
    return (Array.isArray(value) ? value : []) as number[];
  }

  /** Short frequency word for the Task Data sheet: Daily / Weekly / Monthly / Yearly / Custom. */
  private frequencyLabel(entries: { schedule_type: string }[]): string {
    if (!entries?.length) return 'Recurring';
    const types = new Set(entries.map((e) => e.schedule_type));
    if (types.size > 1) return 'Custom';
    const t = entries[0].schedule_type;
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Recurring';
  }

  /** Full human cadence label, e.g. "Weekly on Mon, Wed". */
  private cadenceLabel(entries: any[]): string {
    if (!entries?.length) return '—';
    const labelOne = (e: any): string => {
      const every = e.every && e.every > 1 ? e.every : 1;
      switch (e.schedule_type) {
        case 'daily':
          return every > 1 ? `Every ${every} days` : 'Daily';
        case 'weekly': {
          const days = this.jsonArr(e.days).map((d) => DOW[d] ?? d).join(', ');
          const base = every > 1 ? `Every ${every} weeks` : 'Weekly';
          return days ? `${base} on ${days}` : base;
        }
        case 'monthly': {
          const md = this.jsonArr(e.month_days).map((d) => (d < 0 ? 'last day' : `day ${d}`)).join(', ');
          const base = every > 1 ? `Every ${every} months` : 'Monthly';
          return md ? `${base} on ${md}` : base;
        }
        case 'yearly': {
          const yd = (Array.isArray(e.yearly_dates) ? e.yearly_dates : [])
            .map((o: any) => `${MON[(o.month ?? 1) - 1] ?? '?'} ${o.day}`)
            .join(', ');
          const base = every > 1 ? `Every ${every} years` : 'Yearly';
          return yd ? `${base} on ${yd}` : base;
        }
        default:
          return String(e.schedule_type ?? '—');
      }
    };
    return entries.map(labelOne).join('; ');
  }

  private earliestStart(entries: any[]): string | null {
    const dates = entries.map((e) => e.start_date).filter(Boolean) as Date[];
    if (!dates.length) return null;
    return new Date(Math.min(...dates.map((d) => d.getTime()))).toISOString();
  }

  private latestEnd(entries: any[]): string | null {
    const dates = entries.map((e) => e.end_date).filter(Boolean) as Date[];
    if (!dates.length) return null;
    return new Date(Math.max(...dates.map((d) => d.getTime()))).toISOString();
  }

  private nextRun(entries: RecurrenceEntry[], now: Date): string | null {
    if (!entries?.length) return null;
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    for (let i = 0; i <= 366; i++) {
      const day = new Date(start);
      day.setDate(day.getDate() + i);
      if (entries.some((e) => shouldEntryFireToday(e, day))) return day.toISOString();
    }
    return null;
  }
}
