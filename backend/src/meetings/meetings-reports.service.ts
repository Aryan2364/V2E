import { Injectable, NotFoundException } from '@nestjs/common';
import { DataScope, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TaskDetailService } from '../tasks/task-detail.service';
import { ScopeService } from '../access-rights/scope.service';
import { principalFromUser } from '../access-rights/permissions.service';
import { Actor } from './meetings.service';

const MIN = 60_000;
const HOUR = 60 * MIN;
const ON_TIME_GRACE_MS = 5 * MIN;
const MEETING_LEAF = 'meetings';

// v1 governance visibility = creator-only, expressed as a scope CEILING (not an
// if-creator branch). `own` → visibleUserIds = [me] → created_by in {me}. To widen
// later to the reporting hierarchy, change this ONE constant to DataScope.team:
// `team` → visibleUserIds = me + my recursive subtree → a team member's rhythm rolls
// up to me, and to my manager. Never silently widens: a role with a broader configured
// scope is still clamped to this ceiling, so widening MUST be declared here.
const GOVERNANCE_SCOPE_CEILING: DataScope = DataScope.own;

@Injectable()
export class MeetingsReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TaskDetailService,
    private readonly scope: ScopeService,
  ) {}

  // ─── Level 1 — per-meeting analytics ───────────────────────────────────────────
  async analytics(orgId: string, id: string) {
    const m = await this.prisma.meeting.findFirst({
      where: { id, organization_id: orgId, is_deleted: false },
      include: { attendees: true, action_items: true, decisions: true },
    });
    if (!m) throw new NotFoundException('Meeting not found');

    const plannedMs = m.scheduled_start && m.scheduled_end ? m.scheduled_end.getTime() - m.scheduled_start.getTime() : null;
    const actualMs = m.actual_start && m.actual_end ? m.actual_end.getTime() - m.actual_start.getTime() : null;

    // Opt-out attendance: everyone not declined was EXPECTED. A no-show only exists
    // once attendance was actually recorded — otherwise it is "not recorded", never
    // a silent room-full of no-shows.
    const recorded = m.attendance_taken_at != null;
    const roster = m.attendees.filter((a) => !a.is_organizer);
    const declined = roster.filter((a) => a.response === 'declined');
    const declinedRequired = declined.filter((a) => a.is_required);
    // Attendance metrics are computed over the ROSTER (excludes the organiser). The
    // organiser runs the meeting and is the one taking attendance; counting them as a
    // no-show unless they explicitly tick their own row would silently distort the
    // rate. This also keeps `expected`/`no_show` consistent with the by-person report.
    const expected = roster.filter((a) => a.response !== 'declined');
    const attended = roster.filter((a) => a.attended);
    const late = roster.filter((a) => a.attended && a.attended_in_at && m.scheduled_start && a.attended_in_at > m.scheduled_start);
    const noShow = recorded ? expected.filter((a) => !a.attended).length : null;

    const linkedTaskIds = m.action_items.map((a) => a.linked_task_id).filter(Boolean) as string[];
    const completedMap = await this.tasks.areCompleted(orgId, linkedTaskIds);
    const doneCount = m.action_items.filter((a) => a.is_done || (a.linked_task_id && completedMap[a.linked_task_id])).length;

    return {
      planned_minutes: plannedMs != null ? Math.round(plannedMs / MIN) : null,
      actual_minutes: actualMs != null ? Math.round(actualMs / MIN) : null,
      overrun_minutes: plannedMs != null && actualMs != null ? Math.round((actualMs - plannedMs) / MIN) : null,
      attendance: {
        roster: roster.length,
        expected: expected.length,
        declined: declined.length,
        declined_required: declinedRequired.length,
        attended: attended.length,
        late: late.length,
        no_show: noShow,
        attendance_recorded: recorded,
      },
      action_items: {
        created: m.action_items.length,
        linked: linkedTaskIds.length,
        done: doneCount,
      },
      decisions: m.decisions.length,
      linkage: m.link_type ?? 'ad_hoc',
      started_on_time:
        m.actual_start && m.scheduled_start
          ? m.actual_start.getTime() <= m.scheduled_start.getTime() + ON_TIME_GRACE_MS
          : null,
    };
  }

  // ─── Level 2 — aggregated reports (viewer-scoped, creator-only in v1) ───────────
  async report(orgId: string, actor: Actor, filters: Record<string, string | undefined>) {
    const where = await this.buildScopedWhere(orgId, actor, filters);
    if (where === null) return this.emptyReport(); // no read scope → nothing, fail closed

    const meetings = await this.prisma.meeting.findMany({
      where,
      include: {
        attendees: { select: { user_id: true, is_organizer: true, is_required: true, response: true, attended: true, attended_in_at: true, user: { select: { name: true } } } },
        action_items: { select: { linked_task_id: true, is_done: true } },
        decisions: { select: { id: true } },
      },
    });

    const count = meetings.length;
    let totalMs = 0;
    let overrunSum = 0;
    let overrunN = 0;
    let onTime = 0;
    let onTimeN = 0;
    let rosterTotal = 0;
    let expectedRecorded = 0; // expected attendees in meetings where attendance was recorded
    let attendedRecorded = 0;
    let noShowRecorded = 0;
    let declinedTotal = 0;
    let declinedRequiredTotal = 0;
    let unrecordedMeetings = 0;
    let decisionsTotal = 0;
    let zeroDecisionMeetings = 0;
    let actionItemsTotal = 0;
    let linkedTotal = 0;
    const linkedTaskIds: string[] = [];
    const loadPerPerson = new Map<string, number>();
    const byLinkage = new Map<string, number>();
    const goalAttention = new Map<string, { meetings: number; hours: number }>();
    // Per-person governance record over the scoped series.
    const person = new Map<string, { name: string; expected: number; attended: number; declined: number; declined_required: number; no_show: number }>();
    const bump = (uid: string, name: string, k: 'expected' | 'attended' | 'declined' | 'declined_required' | 'no_show') => {
      const row = person.get(uid) ?? { name, expected: 0, attended: 0, declined: 0, declined_required: 0, no_show: 0 };
      row[k] += 1; row.name = name; person.set(uid, row);
    };

    for (const m of meetings) {
      const plannedMs = m.scheduled_start && m.scheduled_end ? m.scheduled_end.getTime() - m.scheduled_start.getTime() : 0;
      const actualMs = m.actual_start && m.actual_end ? m.actual_end.getTime() - m.actual_start.getTime() : 0;
      const durMs = actualMs || plannedMs;
      totalMs += durMs;
      if (plannedMs && actualMs) { overrunSum += actualMs - plannedMs; overrunN++; }
      if (m.actual_start && m.scheduled_start) {
        onTimeN++;
        if (m.actual_start.getTime() <= m.scheduled_start.getTime() + ON_TIME_GRACE_MS) onTime++;
      }
      const recorded = m.attendance_taken_at != null;
      if (!recorded) unrecordedMeetings++;

      const roster = m.attendees.filter((a) => !a.is_organizer);
      rosterTotal += roster.length;
      for (const a of m.attendees) loadPerPerson.set(a.user_id, (loadPerPerson.get(a.user_id) ?? 0) + 1);

      for (const a of m.attendees) {
        const nm = a.user?.name ?? 'Unknown';
        if (a.response === 'declined') {
          declinedTotal += a.is_organizer ? 0 : 1;
          if (a.is_required && !a.is_organizer) declinedRequiredTotal++;
          if (!a.is_organizer) { bump(a.user_id, nm, 'declined'); if (a.is_required) bump(a.user_id, nm, 'declined_required'); }
          continue;
        }
        // expected (non-declined). Attendance rates are computed over the ROSTER only
        // (skip the organiser): they take attendance, so counting them absent unless
        // they tick their own row would silently drag the rate down as a false no-show.
        if (!a.is_organizer) bump(a.user_id, nm, 'expected');
        if (recorded && !a.is_organizer) {
          expectedRecorded++;
          if (a.attended) { attendedRecorded++; bump(a.user_id, nm, 'attended'); }
          else { noShowRecorded++; bump(a.user_id, nm, 'no_show'); }
        }
      }

      decisionsTotal += m.decisions.length;
      if (m.decisions.length === 0) zeroDecisionMeetings++;
      actionItemsTotal += m.action_items.length;
      for (const ai of m.action_items) if (ai.linked_task_id) { linkedTotal++; linkedTaskIds.push(ai.linked_task_id); }

      const linkKey = m.link_type ?? 'ad_hoc';
      byLinkage.set(linkKey, (byLinkage.get(linkKey) ?? 0) + durMs / HOUR);
      if (m.link_type === 'goal' && m.link_entity_id) {
        const g = goalAttention.get(m.link_entity_id) ?? { meetings: 0, hours: 0 };
        g.meetings++; g.hours += durMs / HOUR;
        goalAttention.set(m.link_entity_id, g);
      }
    }

    const completedMap = await this.tasks.areCompleted(orgId, linkedTaskIds);
    const linkedCompleted = linkedTaskIds.filter((tid) => completedMap[tid]).length;

    return {
      activity: {
        meetings_count: count,
        total_hours: round(totalMs / HOUR),
        avg_duration_min: count ? Math.round(totalMs / MIN / count) : 0,
        avg_overrun_min: overrunN ? Math.round(overrunSum / MIN / overrunN) : 0,
        load_per_person: [...loadPerPerson.entries()]
          .map(([user_id, meetings]) => ({ user_id, meetings }))
          .sort((a, b) => b.meetings - a.meetings),
      },
      attendance: {
        // Rates are computed ONLY over meetings where attendance was actually recorded,
        // so an un-graded meeting never drags a rate down as if everyone no-showed.
        attendance_rate: expectedRecorded ? round((attendedRecorded / expectedRecorded) * 100) : 0,
        no_show_rate: expectedRecorded ? round((noShowRecorded / expectedRecorded) * 100) : 0,
        declined_rate: rosterTotal ? round((declinedTotal / rosterTotal) * 100) : 0,
        declined_required: declinedRequiredTotal,
        started_on_time_rate: onTimeN ? round((onTime / onTimeN) * 100) : 0,
        unrecorded_meetings: unrecordedMeetings,
      },
      output: {
        decisions_total: decisionsTotal,
        decisions_per_meeting: count ? round(decisionsTotal / count) : 0,
        zero_decision_meetings: zeroDecisionMeetings,
        action_items_created: actionItemsTotal,
        pct_linked_to_tasks: actionItemsTotal ? round((linkedTotal / actionItemsTotal) * 100) : 0,
        pct_linked_tasks_completed: linkedTotal ? round((linkedCompleted / linkedTotal) * 100) : 0,
      },
      linkage: {
        hours_by_type: [...byLinkage.entries()].map(([type, hours]) => ({ type, hours: round(hours) })),
        goal_attention: [...goalAttention.entries()]
          .map(([goal_id, v]) => ({ goal_id, meetings: v.meetings, hours: round(v.hours) }))
          .sort((a, b) => b.hours - a.hours),
      },
      by_person: [...person.entries()]
        .map(([user_id, v]) => ({ user_id, ...v }))
        .sort((a, b) => b.expected - a.expected),
    };
  }

  // Build the scope + date + explicit-filter where-clause. Returns null when the
  // caller has no read scope at all (fail closed → empty report).
  private async buildScopedWhere(
    orgId: string,
    actor: Actor,
    filters: Record<string, string | undefined>,
  ): Promise<Prisma.MeetingWhereInput | null> {
    const and: Prisma.MeetingWhereInput[] = [];

    // Scope through the SAME machinery the list uses. Clamp to the governance ceiling
    // (own = creator-only in v1). effective is min(configured, ceiling); null = denied.
    const principal = principalFromUser(actor);
    const { effective } = await this.scope.resolveListScope(orgId, principal, MEETING_LEAF, GOVERNANCE_SCOPE_CEILING);
    if (effective === null) return null;
    if (effective !== DataScope.org) {
      const visible = await this.scope.visibleUserIds(orgId, actor.id, effective);
      if (visible !== 'ALL') and.push({ created_by_user_id: { in: visible } });
    }

    // Explicit filters narrow further (AND-ed on top of scope — never widen it).
    if (filters.user) {
      and.push({ OR: [{ created_by_user_id: filters.user }, { attendees: { some: { user_id: filters.user } } }] });
    }
    if (filters.department) {
      const ids = await this.userIdsInDepartments(orgId, [filters.department]);
      and.push({ created_by_user_id: { in: ids.length ? ids : ['__none__'] } });
    }
    if (filters.rhythm_id) and.push({ rhythm_id: filters.rhythm_id });

    const where: Prisma.MeetingWhereInput = { organization_id: orgId, is_deleted: false };
    if (filters.from_date || filters.to_date) {
      where.scheduled_start = {};
      if (filters.from_date) (where.scheduled_start as any).gte = new Date(filters.from_date);
      if (filters.to_date) (where.scheduled_start as any).lte = new Date(filters.to_date);
    }
    if (and.length) where.AND = and;
    return where;
  }

  private async userIdsInDepartments(orgId: string, deptIds: string[]): Promise<string[]> {
    const profiles = await this.prisma.employeeProfile.findMany({
      where: { organization_id: orgId, department_id: { in: deptIds } },
      select: { user_id: true },
    });
    return profiles.map((p) => p.user_id);
  }

  private emptyReport() {
    return {
      activity: { meetings_count: 0, total_hours: 0, avg_duration_min: 0, avg_overrun_min: 0, load_per_person: [] },
      attendance: { attendance_rate: 0, no_show_rate: 0, declined_rate: 0, declined_required: 0, started_on_time_rate: 0, unrecorded_meetings: 0 },
      output: { decisions_total: 0, decisions_per_meeting: 0, zero_decision_meetings: 0, action_items_created: 0, pct_linked_to_tasks: 0, pct_linked_tasks_completed: 0 },
      linkage: { hours_by_type: [], goal_attention: [] },
      by_person: [],
    };
  }
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
