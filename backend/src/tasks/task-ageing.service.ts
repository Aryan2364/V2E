import { ForbiddenException, Injectable } from '@nestjs/common';
import { DataScope } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService } from '../access-rights/scope.service';
import { Principal } from '../access-rights/permissions.service';
import { ClockService } from '../clock/clock.service';
import { isSuccessful, isTerminal } from './status-phase';
import { assigneeOutcome, handoverLateness, isReleased } from './active-assignee';

/**
 * Pending & Overdue Ageing report — models the client's "Pending and Overdue
 * Ageing Report" (three linked sheets: Person-wise, Task-wise, Pending Task List).
 *
 * It looks ONLY at work that is still open — Overdue or Ongoing. Completed and
 * terminally-closed tasks are out. Every open task ENTRY (each recurring
 * occurrence + each one-time task, per assignee) is aged by how many days late it
 * is against the "position as on" date (the org's current / simulated clock):
 *
 *   Days Late = As-On date − Due date  (whole days, both taken as calendar dates)
 *
 * and dropped into one age band. "Not Yet Due" work (due date still ahead, or no
 * due date) is kept in its own band so nobody is blamed for work that isn't late
 * yet, and it is kept OUT of the oldest / average-late figures.
 *
 * Strictly scope-aware: reuses the same visibility model as the rest of Work — a
 * viewer only ever sees people inside their effective scope (own/team/dept/org).
 *
 * ── Two integrity rules this report has to hold ───────────────────────────────
 *
 * 1. AGE AGAINST THE FROZEN BASELINE. The Due date is editable, so ageing off it let
 *    anyone in the "90+ Days Late" band push their deadline forward and reappear as
 *    Not Yet Due. Days Late and the age band are therefore measured against
 *    `original_deadline ?? deadline` — the date first committed to (see `baselineOf`).
 *    The live Due date is still what the list SHOWS, because the pending list is also
 *    the operational "what do I owe and when" view; `original_deadline` and
 *    `deadline_revision_count` ride alongside so the two can be compared.
 *
 * 2. INCLUDE REMOVED ASSIGNEES, GRADED BY `assigneeOutcome()`. Removal is soft
 *    (`TaskAssignee.removed_at`), and this report reads the FULL historical roster —
 *    no `ACTIVE_ASSIGNEE` filter — so a person 60 days late cannot be taken off the
 *    task to empty their ageing row. Someone released before their baseline came due
 *    ('withdrawn') lands in the separate `withdrawn` band instead of any age band, so
 *    they are visible without being aged.
 *
 * ── The click-through invariant ────────────────────────────────────────────────
 *    Every count on the grid is clickable and the drawer filters ONE loaded snapshot
 *    (`pending[]`), so `clicked count === rows shown` must hold exactly. That is why
 *    `withdrawn` is a real `AgeBucketKey` carried on the row rather than a side-tally:
 *    the drilldown filters on `bucket`, so a Withdrawn click lands on exactly the
 *    withdrawn rows and an age-band click can never pick one up. `total_pending`
 *    stays the sum of the SEVEN age bands (withdrawn excluded), so the drawer's
 *    unconstrained "Total" filter must exclude `bucket === 'withdrawn'` to match.
 */

const TASK_LEAF = 'tasks.task.manage';
const DAY_MS = 24 * 60 * 60 * 1000;
const ROW_CAP = 80000;
/**
 * Detail rows returned to the browser for the Pending List + click-through drills.
 * Set high on purpose: every count on the grid is clickable and must land on
 * EXACTLY that many rows, so the list has to carry the whole pending set (both are
 * built in one pass off one clock read). `list_truncated` flags the rare overflow.
 */
const LIST_CAP = 20000;

/** The seven age bands, in order. `withdrawn` is deliberately NOT one of them. */
export type AgeBandKey =
  | 'not_yet_due'
  | 'd1_7'
  | 'd8_15'
  | 'd16_30'
  | 'd31_60'
  | 'd61_90'
  | 'd90_plus';

/**
 * What a pending row can be tagged as. `withdrawn` and `handed_over` are two extra
 * NON-age keys covering the same fact from opposite sides of the due date: the person
 * has been taken off the task, so it is not their pending work and there is no honest
 * number of days to keep ageing them by — yet the row still has to be listed and
 * clickable, and must name whoever holds it now.
 * Keeping it in the same `bucket` field is what preserves the click-through invariant
 * (one filter dimension, no row can belong to both a band and the withdrawn tally).
 */
export type AgeBucketKey = AgeBandKey | 'withdrawn' | 'handed_over';

/** The seven age bands in grid order — the only keys that feed `total_pending`. */
export const AGE_BANDS: AgeBandKey[] = ['not_yet_due', 'd1_7', 'd8_15', 'd16_30', 'd31_60', 'd61_90', 'd90_plus'];

/** Human label per band — shared verbatim by the "How Late" column + the Excel. */
export const AGE_BUCKET_LABEL: Record<AgeBucketKey, string> = {
  not_yet_due: 'Not Yet Due',
  d1_7: '1 to 7 Days Late',
  d8_15: '8 to 15 Days Late',
  d16_30: '16 to 30 Days Late',
  d31_60: '31 to 60 Days Late',
  d61_90: '61 to 90 Days Late',
  d90_plus: 'More than 90 Days Late',
  withdrawn: 'Withdrawn (removed before due)',
  handed_over: 'Handed over to someone else',
};

/** The seven age bands + the three derived figures — one shared block per row. */
export interface AgeBuckets {
  not_yet_due: number;
  d1_7: number;
  d8_15: number;
  d16_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
  total_pending: number; // every open entry in the seven age bands, incl. Not Yet Due.
                         // Withdrawn is NOT in here — see below.
  over_month_late: number; // d31_60 + d61_90 + d90_plus — everything above 30 days
  oldest_late_days: number | null; // age of the single oldest LATE entry (Not Yet Due excluded)
  avg_late_days: number | null; // mean age over LATE entries only (Not Yet Due excluded)
  // ── Integrity columns (additive) ─────────────────────────────────────────────
  withdrawn: number;       // open entries the person was removed from BEFORE their baseline
                           // came due. Its own figure on purpose: they are not pending work
                           // for that person any more, so folding them into total_pending or
                           // any age band would invent a backlog. Excluded from
                           // over_month_late / oldest_late_days / avg_late_days too.
  handed_over: number;     // open entries already late when taken off this person. Same
                           // exclusion for the same reason — the task is someone else's now,
                           // so it cannot sit in their backlog or keep ageing against them.
                           // The lateness it HAD at handover is reported on the row itself.
  revised_entries: number; // pending entries whose deadline has been revised at least once —
                           // "this row's age is measured against a moved goalpost".
}

export interface PersonAgeRow extends AgeBuckets {
  user_id: string;
  name: string;
  role_title: string | null;
  department_name: string | null;
}

export interface TaskAgeRow extends AgeBuckets {
  title: string;
  frequency: string;
}

/** One open task entry — the Pending Task List sheet + the in-app detail table. */
export interface PendingTaskRow {
  task_id: string;
  title: string;
  assigned_to: string;
  assigned_to_user_id: string;
  assigned_by: string | null;
  department: string | null;
  frequency: string;
  due_date: string | null;  // the LIVE due date — this list is also the operational
                            // "what is outstanding and when" view
  days_late: number | null; // measured from `original_deadline`; null when Not Yet Due,
                            // undated, or Withdrawn
  bucket: AgeBucketKey;
  bucket_label: string; // AGE_BUCKET_LABEL[bucket]
  status: 'Overdue' | 'Not Yet Due' | 'Withdrawn' | 'Handed Over';
  // ── Integrity columns (additive) ─────────────────────────────────────────────
  original_deadline: string | null; // the frozen baseline the ageing above used; equal to
                                    // due_date unless the deadline was moved
  deadline_revision_count: number;
  is_withdrawn: boolean;            // === (bucket === 'withdrawn'); kept explicit so the UI
                                    // does not have to know the bucket taxonomy to style it
  // Set whenever the person has been taken off this task (either released bucket).
  // `to` names whoever holds it now, so the row is a pointer rather than a dead end.
  handover: { at: string; to: string[]; days_late_at_handover: number | null } | null;
}

export interface AgeingReport {
  as_on_date: string;
  people: PersonAgeRow[];
  tasks: TaskAgeRow[];
  pending: PendingTaskRow[];
  totals: AgeBuckets; // identical for the Person-wise and Task-wise Overall rows
  frequencies: string[]; // distinct frequency labels present (for the filter dropdown)
  list_truncated: boolean; // pending[] was capped for transport (aggregates still complete)
  applied_scope: DataScope | null;
  max_scope: DataScope | null;
}

export interface AgeingFilters {
  scope?: DataScope | null;
}

// Mutable per-group age accumulator.
interface AgeAcc {
  not_yet_due: number;
  d1_7: number;
  d8_15: number;
  d16_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
  withdrawn: number; // tallied but never aged — see AgeBuckets.withdrawn
  handed_over: number; // tallied but never aged — see AgeBuckets.handed_over
  revised: number;
  lateSum: number; // Σ days_late over LATE entries
  lateCount: number;
  oldest: number | null;
}

function newAcc(): AgeAcc {
  return {
    not_yet_due: 0, d1_7: 0, d8_15: 0, d16_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0,
    withdrawn: 0, handed_over: 0, revised: 0, lateSum: 0, lateCount: 0, oldest: null,
  };
}

/**
 * The ageing yardstick for a task: the deadline it was FIRST committed to.
 *
 * `original_deadline` is frozen at creation and never rewritten by an edit, so nobody
 * can age their way out of a band by pushing the date. The coalesce onto the live
 * `deadline` is deliberate and defensive: tasks that never had a deadline have both
 * columns null, and any row that somehow escaped the backfill still ages against
 * something rather than dropping silently into "Not Yet Due".
 */
function baselineOf(t: { original_deadline: Date | null; deadline: Date | null }): Date | null {
  return t.original_deadline ?? t.deadline ?? null;
}

/** Whole calendar days between two dates (both floored to midnight; DST-safe). */
function dayDiff(now: Date, due: Date): number {
  const a = new Date(now); a.setHours(0, 0, 0, 0);
  const b = new Date(due); b.setHours(0, 0, 0, 0);
  return Math.round((a.getTime() - b.getTime()) / DAY_MS);
}

/** Age band for a signed days-late figure (≤ 0 ⇒ not yet due / due today). */
function bucketOf(daysLate: number): AgeBandKey {
  if (daysLate <= 0) return 'not_yet_due';
  if (daysLate <= 7) return 'd1_7';
  if (daysLate <= 15) return 'd8_15';
  if (daysLate <= 30) return 'd16_30';
  if (daysLate <= 60) return 'd31_60';
  if (daysLate <= 90) return 'd61_90';
  return 'd90_plus';
}

/**
 * Fold one open entry into a group's tally. `bucket === 'withdrawn'` increments only
 * the withdrawn counter: it must never reach `lateSum` / `oldest` (which would charge
 * a released person for days after they were gone) nor the age bands that make up
 * `total_pending`. `revised` is orthogonal — it counts moved goalposts, withdrawn or
 * not, so it is passed separately.
 */
function addToAcc(acc: AgeAcc, bucket: AgeBucketKey, daysLate: number | null, revised: boolean) {
  acc[bucket] += 1;
  if (revised) acc.revised += 1;
  // Neither released bucket may feed the late statistics: `lateSum` / `oldest` drive
  // "how far behind is this person", and work they no longer hold is not an answer to
  // that question. The handover's own frozen lateness lives on the row instead.
  if (bucket !== 'not_yet_due' && bucket !== 'withdrawn' && bucket !== 'handed_over' && daysLate !== null) {
    acc.lateSum += daysLate;
    acc.lateCount += 1;
    if (acc.oldest === null || daysLate > acc.oldest) acc.oldest = daysLate;
  }
}

function finalizeAcc(acc: AgeAcc): AgeBuckets {
  // total_pending sums the SEVEN age bands only. Withdrawn is excluded on purpose, and
  // the drilldown's unconstrained filter has to exclude it identically or the
  // "clicked count === rows shown" contract breaks.
  const total = acc.not_yet_due + acc.d1_7 + acc.d8_15 + acc.d16_30 + acc.d31_60 + acc.d61_90 + acc.d90_plus;
  return {
    not_yet_due: acc.not_yet_due,
    d1_7: acc.d1_7,
    d8_15: acc.d8_15,
    d16_30: acc.d16_30,
    d31_60: acc.d31_60,
    d61_90: acc.d61_90,
    d90_plus: acc.d90_plus,
    total_pending: total,
    over_month_late: acc.d31_60 + acc.d61_90 + acc.d90_plus,
    oldest_late_days: acc.oldest,
    avg_late_days: acc.lateCount > 0 ? Math.round((acc.lateSum / acc.lateCount) * 100) / 100 : null,
    withdrawn: acc.withdrawn,
    handed_over: acc.handed_over,
    revised_entries: acc.revised,
  };
}

@Injectable()
export class TaskAgeingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly clock: ClockService,
  ) {}

  /** Build the full ageing report for everyone in the viewer's effective scope. */
  async getReport(orgId: string, principal: Principal, filters: AgeingFilters): Promise<AgeingReport> {
    const { max, effective } = await this.scope.resolveListScope(orgId, principal, TASK_LEAF, filters.scope ?? null);
    if (effective === null) {
      return {
        as_on_date: (await this.clock.now(orgId)).toISOString(),
        people: [], tasks: [], pending: [], totals: finalizeAcc(newAcc()),
        frequencies: [], list_truncated: false, applied_scope: null, max_scope: max,
      };
    }

    const visible = await this.scope.visibleUserIds(orgId, principal.userId, effective);
    const now = await this.clock.now(orgId);

    // People in scope (name / role / department).
    const profiles = await this.prisma.employeeProfile.findMany({
      where: { organization_id: orgId, ...(visible === 'ALL' ? {} : { user_id: { in: visible } }) },
      select: {
        user_id: true,
        user: { select: { id: true, name: true } },
        role: { select: { title: true } },
        department: { select: { name: true } },
      },
    });
    const person = new Map(
      profiles
        .filter((p) => p.user)
        .map((p) => [p.user_id, { name: p.user!.name, role_title: p.role?.title ?? null, department_name: p.department?.name ?? null }]),
    );
    const idSet = new Set(person.keys());
    if (idSet.size === 0) {
      return {
        as_on_date: now.toISOString(), people: [], tasks: [], pending: [], totals: finalizeAcc(newAcc()),
        frequencies: [], list_truncated: false, applied_scope: effective, max_scope: max,
      };
    }
    const assigneeUserFilter = visible === 'ALL' ? undefined : { in: Array.from(idSet) };

    // Frequency label per recurring template (one-time tasks are labelled "One-time").
    const freqByTemplate = await this.frequencyMap(orgId);

    // One pass over every task assigned to the in-scope set (one-time + occurrences).
    const tasks = await this.prisma.task.findMany({
      where: {
        organization_id: orgId,
        is_deleted: false,
        assignees: { some: { is_cc: false, ...(assigneeUserFilter ? { user_id: assigneeUserFilter } : {}) } },
      },
      select: {
        id: true,
        title: true,
        recurring_template_id: true,
        created_by_user_id: true,
        deadline: true,
        original_deadline: true,        // the frozen ageing baseline
        deadline_revision_count: true,  // revision transparency
        completion_mode: true,
        status: { select: { type: true } },
        // NOTE: deliberately NOT filtered by ACTIVE_ASSIGNEE. This is a historical
        // compliance read: a person already deep in an ageing band must not be able to
        // be removed off the task to empty their row. `removed_at` + the completion
        // fields let `assigneeOutcome()` split them into graded vs withdrawn.
        assignees: {
          where: { is_cc: false },
          select: { user_id: true, is_completed: true, completed_at: true, removed_at: true },
        },
      },
      take: ROW_CAP,
    });

    // Assigner names.
    const nameIds = new Set<string>();
    for (const t of tasks) {
      if (t.created_by_user_id) nameIds.add(t.created_by_user_id);
      // Only tasks someone was actually taken off need their live roster named.
      if (t.assignees.some((a) => a.removed_at)) {
        for (const a of t.assignees) if (!a.removed_at) nameIds.add(a.user_id);
      }
    }
    const creators = nameIds.size
      ? await this.prisma.user.findMany({ where: { id: { in: Array.from(nameIds) } }, select: { id: true, name: true } })
      : [];
    const creatorName = new Map(creators.map((c) => [c.id, c.name]));

    const byPerson = new Map<string, AgeAcc>();
    const byTask = new Map<string, { frequency: string; acc: AgeAcc }>();
    const totalAcc = newAcc();
    const freqSet = new Set<string>();
    const pending: PendingTaskRow[] = [];

    for (const t of tasks) {
      const frequency = t.recurring_template_id ? (freqByTemplate.get(t.recurring_template_id) ?? 'Recurring') : 'One-time';
      // `deadline` = the live/working date this report SHOWS in the Due column.
      // `baseline` = the date first committed to; the age band and Days Late are
      // measured against this, so a revision can never move a row to a younger band.
      const deadline = t.deadline ?? null;
      const baseline = baselineOf(t);
      const revised = t.deadline_revision_count > 0;
      const anyCan = t.completion_mode !== 'all_must_complete';
      // Who the work sits with today — the answer a released row has to carry.
      const heldNowBy = t.assignees
        .filter((a) => !a.removed_at)
        .map((a) => creatorName.get(a.user_id))
        .filter((n): n is string => !!n);

      for (const a of t.assignees) {
        if (!idSet.has(a.user_id)) continue;

        // Only OPEN work counts — completed or terminally-closed entries are out.
        const completed = anyCan ? isSuccessful(t.status?.type) : a.is_completed;
        if (completed) continue;
        if (isTerminal(t.status?.type)) continue;

        // Age it against the BASELINE. No baseline due date ⇒ can't be late ⇒ Not Yet Due.
        const daysLate = baseline ? dayDiff(now, baseline) : -1;
        const band = bucketOf(daysLate);

        // A person released before their baseline came due is not carrying this work any
        // more, so it gets no age at all — but the row stays listed under its own bucket
        // so the removal is visible and independently clickable. `completed` is already
        // false here, so this is purely the removed-before-vs-after-due decision.
        const outcome = assigneeOutcome({ removed_at: a.removed_at, is_completed: false }, baseline);
        const released = isReleased(outcome);

        // Released either way ⇒ its own non-age bucket, never an age band. This is the
        // whole point: a task someone was taken off is not their pending work, and must
        // not keep ageing in their column while it sits in somebody else's queue.
        const bucket: AgeBucketKey = released ? (outcome === 'withdrawn' ? 'withdrawn' : 'handed_over') : band;
        const late = !released && band !== 'not_yet_due';
        // For a handover, report the lateness FROZEN at the moment they let it go —
        // not today's age, which is no longer anything they can act on.
        const daysLateOut = late ? daysLate : outcome === 'handed_over' ? handoverLateness(a.removed_at, baseline) : null;

        const pacc = byPerson.get(a.user_id) ?? newAcc();
        addToAcc(pacc, bucket, daysLateOut, revised);
        byPerson.set(a.user_id, pacc);

        let tacc = byTask.get(t.title);
        if (!tacc) { tacc = { frequency, acc: newAcc() }; byTask.set(t.title, tacc); }
        addToAcc(tacc.acc, bucket, daysLateOut, revised);

        addToAcc(totalAcc, bucket, daysLateOut, revised);
        freqSet.add(frequency);

        const p = person.get(a.user_id)!;
        pending.push({
          task_id: t.id,
          title: t.title,
          assigned_to: p.name,
          assigned_to_user_id: a.user_id,
          assigned_by: t.created_by_user_id ? creatorName.get(t.created_by_user_id) ?? null : null,
          department: p.department_name,
          frequency,
          // Live date: the Due column has to say when the work is actually expected now.
          due_date: deadline ? deadline.toISOString() : null,
          days_late: daysLateOut,
          bucket,
          bucket_label: AGE_BUCKET_LABEL[bucket],
          status: outcome === 'withdrawn' ? 'Withdrawn' : outcome === 'handed_over' ? 'Handed Over' : late ? 'Overdue' : 'Not Yet Due',
          // Effective baseline (post-coalesce) — the date this row was actually aged
          // against. Equal to due_date whenever the deadline was never moved.
          original_deadline: baseline ? baseline.toISOString() : null,
          deadline_revision_count: t.deadline_revision_count,
          is_withdrawn: outcome === 'withdrawn',
          // Who to actually ask about this row now. Without it a reader sees a late
          // task under a name, chases that person, and is told "it was reassigned" —
          // with nowhere to go next. The row has to carry the answer itself.
          handover: a.removed_at
            ? { at: a.removed_at.toISOString(), to: heldNowBy, days_late_at_handover: daysLateOut }
            : null,
        });
      }
    }

    // Person-wise rows — sorted by the heaviest pile first.
    const people: PersonAgeRow[] = Array.from(byPerson.entries())
      .map(([uid, acc]) => {
        const p = person.get(uid)!;
        return { user_id: uid, name: p.name, role_title: p.role_title, department_name: p.department_name, ...finalizeAcc(acc) };
      })
      .sort((a, b) => b.total_pending - a.total_pending || a.name.localeCompare(b.name));

    // Task-wise rows — heaviest pile first.
    const taskRows: TaskAgeRow[] = Array.from(byTask.entries())
      .map(([title, { frequency, acc }]) => ({ title, frequency, ...finalizeAcc(acc) }))
      .sort((a, b) => b.total_pending - a.total_pending || a.title.localeCompare(b.title));

    // Pending list — oldest late work first, then Not Yet Due, then RELEASED rows last
    // (informational, not a backlog anyone still owes). Both released kinds sink, and
    // handed-over rows must sink on the BUCKET, not on `days_late`: they carry a frozen
    // lateness, so sorting them by it would float a task nobody is waiting on this
    // person for above the real pending work at the top of the list.
    const sortAge = (r: PendingTaskRow) =>
      r.bucket === 'withdrawn' || r.bucket === 'handed_over' ? -2 : r.days_late ?? -1;
    pending.sort((a, b) => sortAge(b) - sortAge(a) || a.assigned_to.localeCompare(b.assigned_to));
    const list_truncated = pending.length > LIST_CAP;

    return {
      as_on_date: now.toISOString(),
      people,
      tasks: taskRows,
      pending: list_truncated ? pending.slice(0, LIST_CAP) : pending,
      totals: finalizeAcc(totalAcc),
      frequencies: Array.from(freqSet).sort(),
      list_truncated,
      applied_scope: effective,
      max_scope: max,
    };
  }

  /** Short frequency word per template: Daily / Weekly / Monthly / Yearly / Custom. */
  private async frequencyMap(orgId: string): Promise<Map<string, string>> {
    const templates = await this.prisma.recurringTemplate.findMany({
      where: { organization_id: orgId },
      select: { id: true, schedule_entries: { select: { schedule_type: true } } },
    });
    return new Map(templates.map((t) => [t.id, this.frequencyLabel(t.schedule_entries)]));
  }

  private frequencyLabel(entries: { schedule_type: string }[]): string {
    if (!entries?.length) return 'Recurring';
    const types = new Set(entries.map((e) => e.schedule_type));
    if (types.size > 1) return 'Custom';
    const t = entries[0].schedule_type;
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Recurring';
  }
}
