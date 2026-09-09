import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GoalCadence, GoalStatus, PermissionAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SubjectEligibilityService } from '../access-rights/subject-eligibility.service';
import { AccessVisibilityService } from '../access-rights/access-visibility.service';
import { ScopeService } from '../access-rights/scope.service';
import { ClockService } from '../clock/clock.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PermissionsService, Principal } from '../access-rights/permissions.service';
import { TERMINAL_TYPES } from '../tasks/status-phase';
import { CreateGoalDto } from './dto/create-goal.dto';
import { UpdateGoalDto } from './dto/update-goal.dto';
import { CreateGoalCheckInDto } from './dto/create-check-in.dto';
import { CreateGoalLinkDto, UpdateGoalLinkDto } from './dto/goal-link.dto';
import { VoidCheckInDto } from './dto/void-check-in.dto';

/** A goal with no cadence is flagged "not checked in for N+ days" past this. */
export const GOAL_STALE_DAYS = 30;

/** The only three values a check-in's traffic light may take. */
export const CHECK_IN_STATUSES: GoalStatus[] = ['on_track', 'at_risk', 'off_track'];

/** Statuses that mean the goal is finished — no check-ins, never chased. */
const CLOSED_STATUSES: GoalStatus[] = ['achieved', 'closed'];

/**
 * Statuses that mean nobody should be nudged about this goal right now:
 * it is either finished, or deliberately parked. An `on_hold` goal is still
 * live (it keeps its deadline and shows in every list) — it just stops being
 * chased for check-ins and stops being reported as overdue, because the pause
 * was a decision, not a slip.
 */
const UNCHASED_STATUSES: GoalStatus[] = [...CLOSED_STATUSES, 'on_hold'];

/** The Projects module's permission leaf — goals only READ through it. */
const PROJECTS_LEAF = 'projects.project.manage';

export interface GoalListFilters {
  owner_user_id?: string;
  department_id?: string;
  status?: string;
  from_date?: string;
  to_date?: string;
  search?: string;
}

/**
 * Goals — one flat entity plus a web of links.
 *
 * Deliberate design decisions, recorded so they don't get quietly undone:
 *  · No levels, no parent, no cascade. `goal_links` carries all the structure.
 *  · NOTHING is computed. A goal's number changes only when a person types it
 *    in at a check-in — no rollup, no averaging, no percentage anywhere.
 *  · Access is the module permission, full stop. Goals are company-wide by
 *    design, so there is no row-level data scope on this module. Every query
 *    is still scoped by organization_id (multi-tenant isolation is not
 *    negotiable — see backend/AUTHORIZATION.md).
 *  · Check-ins are immutable. A wrong one is VOIDED (kept, with a reason),
 *    never edited or deleted.
 */
@Injectable()
export class GoalsService {
  private static readonly GOALS_LEAF = 'goals';

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly subjects: SubjectEligibilityService,
    private readonly visibility: AccessVisibilityService,
    private readonly scope: ScopeService,
    private readonly permissions: PermissionsService,
    private readonly clock: ClockService,
    private readonly notifications: NotificationsService,
  ) {
    // Goals carry no row-level scope: anyone holding the leaf sees every goal
    // in the org, so nothing is ever "hidden by permissions". Registering a
    // zero counter keeps the shared access-hidden UI truthful for this module
    // instead of reporting a phantom hidden count.
    this.visibility.registerCounter(GoalsService.GOALS_LEAF, async () => 0);
  }

  // ─── Create ─────────────────────────────────────────────────────────────────
  async create(orgId: string, userId: string, dto: CreateGoalDto) {
    // Owner is accountability, not access — but it must be a person the org has
    // marked ownable, not (say) a vendor contact.
    await this.subjects.assertEligible(orgId, 'goals.subject.ownable', dto.owner_user_id);

    const dueDate = this.parseDate(dto.due_date, 'due_date');
    const now = await this.clock.now(orgId);
    const cadence = dto.review_cadence ?? 'none';

    const goal = await this.prisma.goal.create({
      data: {
        organization_id: orgId,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        owner_user_id: dto.owner_user_id,
        department_id: dto.department_id || null,
        focus_area: dto.focus_area ?? null,
        due_date: dueDate,
        target_value: this.toDecimal(dto.target_value),
        current_value: this.toDecimal(dto.current_value),
        unit: dto.unit?.trim() || null,
        status: dto.status ?? 'not_started',
        review_cadence: cadence,
        // An explicit first check-in date wins; otherwise fall back to one
        // interval from today so a rhythm always has a concrete first date.
        next_review_date:
          cadence === 'none'
            ? null
            : dto.first_check_in_date
              ? this.parseDate(dto.first_check_in_date, 'first_check_in_date')
              : this.nextReviewDate(now, cadence),
        created_by_user_id: userId,
      },
      include: this.goalInclude(),
    });

    await this.audit.record({
      orgId,
      actorId: userId,
      action: 'create',
      resource: 'goal',
      entityId: goal.id,
      entityLabel: goal.title,
      changes: { title: { before: null, after: goal.title } },
    });

    return this.shape(goal);
  }

  // ─── List ───────────────────────────────────────────────────────────────────
  async list(orgId: string, _principal: Principal, filters: GoalListFilters = {}) {
    const where: Prisma.GoalWhereInput = { organization_id: orgId, is_deleted: false };
    if (filters.owner_user_id) where.owner_user_id = filters.owner_user_id;
    if (filters.department_id) where.department_id = filters.department_id;
    if (filters.status) where.status = filters.status as GoalStatus;
    if (filters.from_date || filters.to_date) {
      where.due_date = {};
      if (filters.from_date) where.due_date.gte = this.parseDate(filters.from_date, 'from_date');
      if (filters.to_date) where.due_date.lte = this.parseDate(filters.to_date, 'to_date');
    }
    if (filters.search) where.title = { contains: filters.search, mode: 'insensitive' };

    const goals = await this.prisma.goal.findMany({
      where,
      orderBy: { due_date: 'asc' },
      include: this.goalInclude(),
    });

    const [taskCounts, links, now] = await Promise.all([
      this.taskCountsByGoal(
        orgId,
        goals.map((g) => g.id),
      ),
      this.allLinks(orgId),
      this.clock.now(orgId),
    ]);

    const supportCount = new Map<string, number>();
    const supportedByCount = new Map<string, number>();
    for (const l of links) {
      supportCount.set(l.supporting_goal_id, (supportCount.get(l.supporting_goal_id) ?? 0) + 1);
      supportedByCount.set(l.supported_goal_id, (supportedByCount.get(l.supported_goal_id) ?? 0) + 1);
    }

    return goals.map((g) => ({
      ...this.shape(g),
      days_left: this.daysBetween(now, g.due_date),
      task_counts: taskCounts.get(g.id) ?? { open: 0, closed: 0 },
      supports_count: supportCount.get(g.id) ?? 0,
      supported_by_count: supportedByCount.get(g.id) ?? 0,
    }));
  }

  // ─── Strategic map ──────────────────────────────────────────────────────────
  /**
   * Everything the Strategic Map canvas needs in ONE read: every live goal in a
   * lean shape (the canvas draws a title and nothing else) plus every live link
   * edge. The client lays the goals out in the four focus-area bands and draws
   * the web between them, so there is no per-goal round trip and no layout
   * state to keep in the database.
   */
  async strategyMap(orgId: string) {
    const [goals, links] = await Promise.all([
      this.prisma.goal.findMany({
        where: { organization_id: orgId, is_deleted: false },
        orderBy: [{ due_date: 'asc' }, { title: 'asc' }],
        select: {
          id: true,
          title: true,
          focus_area: true,
          status: true,
          due_date: true,
          department_id: true,
          owner: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
        },
      }),
      this.allLinks(orgId),
    ]);

    return { goals, links };
  }

  // ─── Detail ─────────────────────────────────────────────────────────────────
  async getOne(orgId: string, id: string, principal?: Principal) {
    const goal = await this.prisma.goal.findFirst({
      where: { id, organization_id: orgId, is_deleted: false },
      include: {
        ...this.goalInclude(),
        check_ins: {
          orderBy: [{ check_in_date: 'desc' }, { created_at: 'desc' }],
          include: { created_by: { select: { id: true, name: true } } },
        },
      },
    });
    if (!goal) throw new NotFoundException('Goal not found');

    const [links, tasks, projects, now] = await Promise.all([
      this.getLinks(orgId, id),
      this.prisma.task.findMany({
        where: { goal_id: id, organization_id: orgId, is_deleted: false },
        orderBy: { created_at: 'desc' },
        include: { status: true, priority: true, assignees: true },
      }),
      this.linkedProjects(orgId, id, principal),
      this.clock.now(orgId),
    ]);

    return {
      ...this.shape(goal),
      check_ins: goal.check_ins.map((c) => this.shapeCheckIn(c)),
      days_left: this.daysBetween(now, goal.due_date),
      ...links,
      tasks,
      ...projects,
    };
  }

  /**
   * A goal's linked projects.
   *
   * Goals are company-wide, but PROJECTS are not: opening one requires
   * MEMBERSHIP of that project (ProjectsService.requireMember), on top of the
   * module's row-level data scope. So this returns only projects this viewer
   * can actually open — both gates applied — and reports the rest as a count.
   *
   * Membership is the binding gate, not the data scope: someone with org-wide
   * project scope who is not on the project still gets a 403 from
   * `GET /projects/:id`. Filtering on scope alone would put a link on this page
   * that dead-ends, so both are intersected here.
   */
  private async linkedProjects(orgId: string, goalId: string, principal?: Principal) {
    // Does the Projects section apply to this viewer AT ALL? `hasEffective`
    // answers both halves in one call: the org's entitlement ceiling (is the
    // module even licensed) AND this person's own effective permission. If
    // either says no, the goal page must not show the section — not even a
    // "hidden projects" note, which would itself reveal that projects exist.
    const projectsVisible = principal
      ? await this.permissions
          .hasEffective(orgId, principal, PROJECTS_LEAF, PermissionAction.read)
          .catch(() => false)
      : true;
    if (!projectsVisible) {
      return { projects: [], hidden_project_count: 0, projects_visible: false };
    }

    // Reached through the join table — a project can serve several goals.
    const where: Prisma.ProjectWhereInput = {
      organization_id: orgId,
      is_deleted: false,
      goals: { some: { goal_id: goalId } },
    };
    const total = await this.prisma.project.count({ where });
    if (total === 0) return { projects: [], hidden_project_count: 0, projects_visible: true };

    const gates: Record<string, unknown>[] = [];
    if (principal) {
      // Reuse the shared scope toolkit; never hand-roll access here.
      const scopeWhere = await this.scope
        .listWhere(orgId, principal, PROJECTS_LEAF)
        .catch(() => ({}) as Record<string, unknown>);
      if (Object.keys(scopeWhere).length) gates.push(scopeWhere);
      gates.push({ members: { some: { user_id: principal.userId } } });
    }

    const projects = await this.prisma.project.findMany({
      where: { ...where, ...(gates.length ? { AND: gates as any } : {}) },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        name: true,
        status: true,
        start_date: true,
        end_date: true,
        completion_percentage: true,
        total_tasks: true,
        completed_tasks: true,
        project_manager_user_id: true,
      },
    });

    return {
      projects,
      hidden_project_count: Math.max(0, total - projects.length),
      projects_visible: true,
    };
  }

  // ─── Update ─────────────────────────────────────────────────────────────────
  async update(orgId: string, userId: string, id: string, dto: UpdateGoalDto) {
    const existing = await this.findActiveOrFail(orgId, id);

    if (dto.owner_user_id && dto.owner_user_id !== existing.owner_user_id) {
      await this.subjects.assertEligible(orgId, 'goals.subject.ownable', dto.owner_user_id);
    }

    const data: Prisma.GoalUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.description !== undefined) data.description = dto.description?.trim() || null;
    if (dto.owner_user_id !== undefined) data.owner = { connect: { id: dto.owner_user_id } };
    if (dto.department_id !== undefined) {
      data.department = dto.department_id
        ? { connect: { id: dto.department_id } }
        : { disconnect: true };
    }
    if (dto.focus_area !== undefined) data.focus_area = dto.focus_area;
    if (dto.due_date !== undefined) data.due_date = this.parseDate(dto.due_date, 'due_date');
    if (dto.target_value !== undefined) data.target_value = this.toDecimal(dto.target_value);
    if (dto.unit !== undefined) data.unit = dto.unit?.trim() || null;
    if (dto.status !== undefined) data.status = dto.status;

    // Clearing the target clears the recorded number with it — a value with no
    // target to measure it against is meaningless.
    if (dto.target_value !== undefined && this.toDecimal(dto.target_value) === null) {
      data.current_value = null;
    }

    // Changing the cadence re-anchors the next review off the last check-in
    // (or now, if there has never been one) rather than leaving a stale date.
    if (dto.review_cadence !== undefined) {
      data.review_cadence = dto.review_cadence;
      const anchor = existing.last_check_in_at ?? (await this.clock.now(orgId));
      data.next_review_date = this.nextReviewDate(anchor, dto.review_cadence);
    }
    // An explicit date always wins over the re-anchor above, so the owner can
    // pin exactly when the next check-in is due.
    if (dto.next_review_date !== undefined) {
      data.next_review_date = dto.next_review_date
        ? this.parseDate(dto.next_review_date, 'next_review_date')
        : null;
    }

    const goal = await this.prisma.goal.update({
      where: { id },
      data,
      include: this.goalInclude(),
    });

    await this.audit.record({
      orgId,
      actorId: userId,
      action: 'update',
      resource: 'goal',
      entityId: id,
      entityLabel: goal.title,
      changes: this.diff(existing, goal, [
        'title',
        'owner_user_id',
        'due_date',
        'target_value',
        'unit',
        'status',
        'review_cadence',
        'department_id',
        'focus_area',
      ]),
    });

    return this.shape(goal);
  }

  // ─── Delete (soft) ──────────────────────────────────────────────────────────
  /**
   * Nothing blocks a delete — not links, not tasks. The UI tells the user what
   * the delete severs (`deleteImpact`) and they decide. Link rows are LEFT IN
   * PLACE so undeleting a goal restores its web; reads filter out edges whose
   * other end is deleted.
   */
  async remove(orgId: string, userId: string, id: string, reason?: string) {
    const goal = await this.findActiveOrFail(orgId, id);
    const now = await this.clock.now(orgId);

    await this.prisma.goal.update({
      where: { id },
      data: {
        is_deleted: true,
        deleted_at: now,
        deleted_by_user_id: userId,
        deletion_reason: reason?.trim() || null,
      },
    });

    await this.audit.record({
      orgId,
      actorId: userId,
      action: 'delete',
      resource: 'goal',
      entityId: id,
      entityLabel: goal.title,
      changes: { is_deleted: { before: false, after: true } },
      triggerContext: reason?.trim() ? { reason: reason.trim() } : undefined,
    });

    return { success: true };
  }

  /** What a delete would sever — powers the confirm dialog's plain-language warning. */
  async deleteImpact(orgId: string, id: string, principal?: Principal) {
    await this.findActiveOrFail(orgId, id);
    const [supports, supportedBy, openTasks, checkIns, projects] = await Promise.all([
      this.prisma.goalLink.count({
        where: { organization_id: orgId, supporting_goal_id: id, supported: { is_deleted: false } },
      }),
      this.prisma.goalLink.count({
        where: { organization_id: orgId, supported_goal_id: id, supporting: { is_deleted: false } },
      }),
      this.prisma.task.count({
        where: {
          goal_id: id,
          organization_id: orgId,
          is_deleted: false,
          status: { type: { notIn: TERMINAL_TYPES } },
        },
      }),
      this.prisma.goalCheckIn.count({ where: { goal_id: id, is_voided: false } }),
      this.prisma.project.count({
        where: { organization_id: orgId, is_deleted: false, goals: { some: { goal_id: id } } },
      }),
    ]);
    // Same rule as the Projects section itself: someone with no Projects access
    // is never told that linked projects exist, so the confirm text can't leak
    // what the page deliberately hides.
    const projectsVisible = principal
      ? await this.permissions
          .hasEffective(orgId, principal, PROJECTS_LEAF, PermissionAction.read)
          .catch(() => false)
      : true;

    return {
      supports_count: supports,
      supported_by_count: supportedBy,
      open_task_count: openTasks,
      check_in_count: checkIns,
      project_count: projectsVisible ? projects : 0,
    };
  }

  // ─── Links (the web) ────────────────────────────────────────────────────────
  /** Both sides of a goal's web, with each end's deleted goals filtered out. */
  async getLinks(orgId: string, goalId: string) {
    const linkGoalSelect = {
      id: true,
      title: true,
      status: true,
      due_date: true,
      target_value: true,
      current_value: true,
      unit: true,
      owner: { select: { id: true, name: true } },
      // How far the chain continues past this neighbour, so the detail page can
      // say "3 more behind this" instead of pretending the web stops here.
      _count: {
        select: {
          supported_by: { where: { supporting: { is_deleted: false } } },
          supports: { where: { supported: { is_deleted: false } } },
        },
      },
    } as const;

    const [self, supportedBy, supports] = await Promise.all([
      this.prisma.goal.findFirst({
        where: { id: goalId, organization_id: orgId },
        select: { due_date: true },
      }),
      // Goals that support THIS goal.
      this.prisma.goalLink.findMany({
        where: {
          organization_id: orgId,
          supported_goal_id: goalId,
          supporting: { is_deleted: false },
        },
        orderBy: { created_at: 'asc' },
        include: { supporting: { select: linkGoalSelect } },
      }),
      // Goals THIS goal supports.
      this.prisma.goalLink.findMany({
        where: {
          organization_id: orgId,
          supporting_goal_id: goalId,
          supported: { is_deleted: false },
        },
        orderBy: { created_at: 'asc' },
        include: { supported: { select: linkGoalSelect } },
      }),
    ]);

    const myDue = self?.due_date ?? null;

    return {
      // A supporting goal due AFTER the goal it feeds is a logic error worth
      // surfacing — but legitimate cases exist (an ongoing capability goal that
      // keeps running), so it warns and never blocks.
      supported_by: supportedBy.map((l) => ({
        link_id: l.id,
        note: l.note,
        goal: this.shape(l.supporting),
        deadline_warning: !!myDue && l.supporting.due_date > myDue,
      })),
      supports: supports.map((l) => ({
        link_id: l.id,
        note: l.note,
        goal: this.shape(l.supported),
        deadline_warning: !!myDue && myDue > l.supported.due_date,
      })),
    };
  }

  /** Links `dto.supporting_goal_id` as a supporter of `supportedGoalId`. */
  async createLink(orgId: string, userId: string, supportedGoalId: string, dto: CreateGoalLinkDto) {
    const supportingId = dto.supporting_goal_id;

    if (supportingId === supportedGoalId) {
      throw new BadRequestException('A goal cannot support itself.');
    }

    const [supported, supporting] = await Promise.all([
      this.findActiveOrFail(orgId, supportedGoalId),
      this.findActiveOrFail(orgId, supportingId),
    ]);

    const existing = await this.prisma.goalLink.findUnique({
      where: {
        supporting_goal_id_supported_goal_id: {
          supporting_goal_id: supportingId,
          supported_goal_id: supportedGoalId,
        },
      },
    });
    if (existing) {
      throw new ConflictException(`"${supporting.title}" already supports "${supported.title}".`);
    }

    // Cycle guard: adding supporting → supported is only safe if `supported`
    // cannot already reach `supporting`. The refusal names the chain that
    // closes the circle so the user can see why.
    const path = await this.findPath(orgId, supportedGoalId, supportingId);
    if (path) {
      const via = path.slice(1, -1);
      throw new ConflictException(
        `"${supported.title}" already depends on "${supporting.title}"` +
          (via.length ? `, through ${via.map((t) => `"${t}"`).join(' → ')}` : '') +
          '. Linking them this way would make a circle.',
      );
    }

    const link = await this.prisma.goalLink.create({
      data: {
        organization_id: orgId,
        supporting_goal_id: supportingId,
        supported_goal_id: supportedGoalId,
        note: dto.note?.trim() || null,
        created_by_user_id: userId,
      },
    });

    await this.audit.record({
      orgId,
      actorId: userId,
      action: 'create',
      resource: 'goal_link',
      entityId: link.id,
      entityLabel: `${supporting.title} → ${supported.title}`,
      changes: { note: { before: null, after: link.note } },
    });

    return link;
  }

  async updateLink(orgId: string, userId: string, linkId: string, dto: UpdateGoalLinkDto) {
    const link = await this.findLinkOrFail(orgId, linkId);

    const updated = await this.prisma.goalLink.update({
      where: { id: linkId },
      data: { note: dto.note?.trim() || null },
    });

    await this.audit.record({
      orgId,
      actorId: userId,
      action: 'update',
      resource: 'goal_link',
      entityId: linkId,
      entityLabel: `${link.supporting.title} → ${link.supported.title}`,
      changes: { note: { before: link.note, after: updated.note } },
    });

    return updated;
  }

  async removeLink(orgId: string, userId: string, linkId: string) {
    const link = await this.findLinkOrFail(orgId, linkId);

    await this.prisma.goalLink.delete({ where: { id: linkId } });

    await this.audit.record({
      orgId,
      actorId: userId,
      action: 'delete',
      resource: 'goal_link',
      entityId: linkId,
      entityLabel: `${link.supporting.title} → ${link.supported.title}`,
      changes: {},
    });

    return { success: true };
  }

  /**
   * Goals that may be linked to `goalId` in `direction`, with everything that
   * would error already filtered out: the goal itself, goals already linked
   * that way, and anything that would close a loop. Pre-filtering here is what
   * stops the picker offering a choice that fails on save.
   */
  async linkCandidates(orgId: string, goalId: string, direction: 'supported_by' | 'supports') {
    await this.findActiveOrFail(orgId, goalId);
    const [goals, links] = await Promise.all([
      this.prisma.goal.findMany({
        where: { organization_id: orgId, is_deleted: false, id: { not: goalId } },
        orderBy: { title: 'asc' },
        select: { id: true, title: true, due_date: true, status: true, unit: true },
      }),
      this.allLinks(orgId),
    ]);

    let taken: Set<string>;
    let wouldLoop: Set<string>;
    if (direction === 'supported_by') {
      // Picking a goal to support this one: anything downstream of this goal
      // (i.e. that this goal already helps) would close a circle.
      taken = new Set(links.filter((l) => l.supported_goal_id === goalId).map((l) => l.supporting_goal_id));
      wouldLoop = this.reachable(links, goalId, 'down');
    } else {
      // Picking a goal for this one to support: anything upstream would loop.
      taken = new Set(links.filter((l) => l.supporting_goal_id === goalId).map((l) => l.supported_goal_id));
      wouldLoop = this.reachable(links, goalId, 'up');
    }

    return goals.filter((g) => !taken.has(g.id) && !wouldLoop.has(g.id));
  }

  /**
   * Attach an existing project to this goal. Gated twice on purpose: holding
   * goals.edit gets you here (the controller), and the project must ALSO be one
   * this person can already open — otherwise a goal editor could attach (and so
   * reveal) a project they have no access to.
   */
  async linkProject(orgId: string, userId: string, goalId: string, projectId: string) {
    await this.findActiveOrFail(orgId, goalId);
    await this.assertProjectReachable(orgId, projectId, userId);

    const existing = await this.prisma.goalProject.findUnique({
      where: { goal_id_project_id: { goal_id: goalId, project_id: projectId } },
    });
    if (existing) throw new ConflictException('That project is already on this goal.');

    const link = await this.prisma.goalProject.create({
      data: {
        organization_id: orgId,
        goal_id: goalId,
        project_id: projectId,
        created_by_user_id: userId,
      },
      include: { project: { select: { name: true } }, goal: { select: { title: true } } },
    });

    await this.audit.record({
      orgId,
      actorId: userId,
      action: 'create',
      resource: 'goal_project',
      entityId: link.id,
      entityLabel: `${link.project.name} → ${link.goal.title}`,
      changes: {},
    });

    return { success: true };
  }

  async unlinkProject(orgId: string, userId: string, goalId: string, projectId: string) {
    const link = await this.prisma.goalProject.findFirst({
      where: { goal_id: goalId, project_id: projectId, organization_id: orgId },
      include: { project: { select: { name: true } }, goal: { select: { title: true } } },
    });
    if (!link) throw new NotFoundException('That project is not on this goal.');
    await this.assertProjectReachable(orgId, projectId, userId);

    await this.prisma.goalProject.delete({ where: { id: link.id } });

    await this.audit.record({
      orgId,
      actorId: userId,
      action: 'delete',
      resource: 'goal_project',
      entityId: link.id,
      entityLabel: `${link.project.name} → ${link.goal.title}`,
      changes: {},
    });

    return { success: true };
  }

  /** Projects this person could link to a goal: live, in-org, and openable by them. */
  async projectCandidates(orgId: string, goalId: string, principal?: Principal) {
    await this.findActiveOrFail(orgId, goalId);
    const visible = await this.permissions
      .hasEffective(orgId, principal!, PROJECTS_LEAF, PermissionAction.read)
      .catch(() => false);
    if (!principal || !visible) return [];

    const scopeWhere = await this.scope
      .listWhere(orgId, principal, PROJECTS_LEAF)
      .catch(() => ({}) as Record<string, unknown>);
    const gates: Record<string, unknown>[] = [];
    if (Object.keys(scopeWhere).length) gates.push(scopeWhere);
    gates.push({ members: { some: { user_id: principal.userId } } });

    return this.prisma.project.findMany({
      where: {
        organization_id: orgId,
        is_deleted: false,
        // Already on this goal — but a project may well be on OTHER goals, and
        // that must not exclude it. Many-to-many by design.
        NOT: { goals: { some: { goal_id: goalId } } },
        AND: gates as any,
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, status: true, end_date: true },
    });
  }

  /** A project must be one the actor can already open (scope AND membership). */
  private async assertProjectReachable(orgId: string, projectId: string, userId: string) {
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        organization_id: orgId,
        is_deleted: false,
        members: { some: { user_id: userId } },
      },
      select: { id: true },
    });
    if (!project) {
      throw new NotFoundException(
        'Project not found, or you are not on it. Ask a project manager to add you.',
      );
    }
  }

  // ─── Check-ins ──────────────────────────────────────────────────────────────
  async createCheckIn(orgId: string, userId: string, goalId: string, dto: CreateGoalCheckInDto) {
    const goal = await this.findActiveOrFail(orgId, goalId);

    if (CLOSED_STATUSES.includes(goal.status)) {
      throw new BadRequestException(
        `"${goal.title}" is marked ${goal.status === 'achieved' ? 'achieved' : 'closed'}. ` +
          'Change its status back before recording a check-in.',
      );
    }
    if (!CHECK_IN_STATUSES.includes(dto.status)) {
      throw new BadRequestException('A check-in must be on track, at risk or off track.');
    }
    if (dto.recorded_value !== undefined && dto.recorded_value !== null && goal.target_value === null) {
      throw new BadRequestException('This goal has no target number, so there is no value to record.');
    }

    const checkInDate = this.parseDate(dto.check_in_date, 'check_in_date');
    const now = await this.clock.now(orgId);
    if (checkInDate > this.endOfDay(now)) {
      throw new BadRequestException('A check-in cannot be dated in the future.');
    }

    const recorded = this.toDecimal(dto.recorded_value);

    const checkIn = await this.prisma.$transaction(async (tx) => {
      const ci = await tx.goalCheckIn.create({
        data: {
          organization_id: orgId,
          goal_id: goalId,
          check_in_date: checkInDate,
          status: dto.status,
          recorded_value: recorded,
          // Snapshot the target as it stands today, so raising the target later
          // never makes this row's history misleading.
          target_value_at_check_in: goal.target_value,
          status_note: dto.status_note?.trim() || null,
          created_by_user_id: userId,
        },
        include: { created_by: { select: { id: true, name: true } } },
      });

      await tx.goal.update({
        where: { id: goalId },
        data: {
          // The recorded number IS the goal's number. Nothing else writes it.
          ...(recorded !== null ? { current_value: recorded } : {}),
          status: dto.status,
          last_check_in_at: now,
          next_review_date: this.nextReviewDate(checkInDate, goal.review_cadence),
        },
      });

      return ci;
    });

    await this.audit.record({
      orgId,
      actorId: userId,
      action: 'create',
      resource: 'goal_check_in',
      entityId: checkIn.id,
      entityLabel: goal.title,
      changes: {
        status: { before: goal.status, after: dto.status },
        recorded_value: {
          before: goal.current_value?.toString() ?? null,
          after: recorded?.toString() ?? null,
        },
      },
    });

    if (dto.status === 'at_risk' || dto.status === 'off_track') {
      await this.notifyDependentsOfRisk(orgId, goalId, goal.title, dto.status, userId).catch(() => {});
    }

    return this.shapeCheckIn(checkIn);
  }

  async listCheckIns(orgId: string, goalId: string) {
    await this.findActiveOrFail(orgId, goalId);
    const rows = await this.prisma.goalCheckIn.findMany({
      where: { goal_id: goalId, organization_id: orgId },
      orderBy: [{ check_in_date: 'desc' }, { created_at: 'desc' }],
      include: { created_by: { select: { id: true, name: true } } },
    });
    return rows.map((r) => this.shapeCheckIn(r));
  }

  /**
   * Void a check-in. Check-ins are never edited or deleted — the dated history
   * IS the value — so a fat-finger entry is reversed the way accounting does
   * it: the row stays, struck through, with a reason. The goal's headline
   * number then falls back to the newest surviving check-in.
   */
  async voidCheckIn(orgId: string, userId: string, checkInId: string, dto: VoidCheckInDto) {
    const ci = await this.prisma.goalCheckIn.findFirst({
      where: { id: checkInId, organization_id: orgId },
      include: { goal: { select: { id: true, title: true, is_deleted: true } } },
    });
    if (!ci || ci.goal.is_deleted) throw new NotFoundException('Check-in not found');
    if (ci.is_voided) throw new ConflictException('This check-in is already voided.');

    const now = await this.clock.now(orgId);

    await this.prisma.$transaction(async (tx) => {
      await tx.goalCheckIn.update({
        where: { id: checkInId },
        data: {
          is_voided: true,
          voided_at: now,
          voided_by_user_id: userId,
          void_reason: dto.reason.trim(),
        },
      });

      // Re-derive the goal's headline number and status from the newest
      // surviving check-in — never from arithmetic.
      const latest = await tx.goalCheckIn.findFirst({
        where: { goal_id: ci.goal_id, is_voided: false },
        orderBy: [{ check_in_date: 'desc' }, { created_at: 'desc' }],
      });
      await tx.goal.update({
        where: { id: ci.goal_id },
        data: {
          current_value: latest?.recorded_value ?? null,
          status: latest?.status ?? 'not_started',
          last_check_in_at: latest?.created_at ?? null,
        },
      });
    });

    await this.audit.record({
      orgId,
      actorId: userId,
      action: 'update',
      resource: 'goal_check_in',
      entityId: checkInId,
      entityLabel: ci.goal.title,
      changes: { is_voided: { before: false, after: true } },
      triggerContext: { reason: dto.reason.trim() },
    });

    return { success: true };
  }

  /**
   * "My check-ins" — the goals this user owns that owe a check-in, soonest
   * first. This is the screen that keeps the module alive, so it stays one
   * cheap query.
   */
  async myCheckIns(orgId: string, userId: string) {
    const now = await this.clock.now(orgId);
    const goals = await this.prisma.goal.findMany({
      where: {
        organization_id: orgId,
        is_deleted: false,
        owner_user_id: userId,
        ...this.checkInDueWhere(now),
      },
      orderBy: [{ next_review_date: 'asc' }, { due_date: 'asc' }],
      include: this.goalInclude(),
    });

    return goals.map((g) => ({
      ...this.shape(g),
      days_left: this.daysBetween(now, g.due_date),
      due_reason: this.dueReason(g, now),
      days_overdue: g.next_review_date ? Math.max(0, this.daysBetween(g.next_review_date, now)) : null,
    }));
  }

  /** Badge count for the "My check-ins" nav item. */
  async myCheckInCount(orgId: string, userId: string) {
    const now = await this.clock.now(orgId);
    const count = await this.prisma.goal.count({
      where: {
        organization_id: orgId,
        is_deleted: false,
        owner_user_id: userId,
        ...this.checkInDueWhere(now),
      },
    });
    return { count };
  }

  // ─── Dashboard ──────────────────────────────────────────────────────────────
  async dashboard(orgId: string) {
    const now = await this.clock.now(orgId);
    const today = this.endOfDay(now);
    const staleBefore = this.daysAgo(now, GOAL_STALE_DAYS);

    const goals = await this.prisma.goal.findMany({
      where: { organization_id: orgId, is_deleted: false },
      orderBy: { due_date: 'asc' },
      include: this.goalInclude(),
    });

    const counts: Record<GoalStatus, number> = {
      not_started: 0,
      in_progress: 0,
      on_track: 0,
      at_risk: 0,
      off_track: 0,
      on_hold: 0,
      achieved: 0,
      closed: 0,
    };
    for (const g of goals) counts[g.status] += 1;

    const live = goals.filter((g) => !CLOSED_STATUSES.includes(g.status));
    // Parked goals drop out of the two "you owe something" lists, but stay in
    // the counts and in every list view.
    const chased = goals.filter((g) => !UNCHASED_STATUSES.includes(g.status));
    const withDays = (g: (typeof goals)[number]) => ({
      ...this.shape(g),
      days_left: this.daysBetween(now, g.due_date),
    });

    return {
      as_on: now.toISOString(),
      total: goals.length,
      counts,
      at_risk: live.filter((g) => g.status === 'at_risk' || g.status === 'off_track').map(withDays),
      overdue: chased
        .filter((g) => g.due_date < now)
        .map((g) => ({ ...withDays(g), days_late: this.daysBetween(g.due_date, now) })),
      needs_check_in: chased
        .filter(
          (g) =>
            (g.next_review_date && g.next_review_date <= today) ||
            (g.review_cadence === 'none' && (g.last_check_in_at ?? g.created_at) < staleBefore),
        )
        .map((g) => ({ ...withDays(g), due_reason: this.dueReason(g, now) })),
    };
  }

  // ─── Nightly check-in reminders (driven by the scheduler) ───────────────────
  /**
   * One pass per org: nudge owners whose review date has arrived, and nudge
   * again once they are `followupDays` late. Both are deduped per
   * (event_type, goal) by the notifications service, so an owner is never
   * nagged twice for the same miss — the follow-up lands only because it is a
   * different event type.
   */
  async sendCheckInReminders(orgId: string, now: Date, followupDays: number) {
    const lateBefore = this.daysAgo(now, followupDays);

    const goals = await this.prisma.goal.findMany({
      where: {
        organization_id: orgId,
        is_deleted: false,
        ...this.checkInDueWhere(now),
      },
      select: {
        id: true,
        title: true,
        owner_user_id: true,
        next_review_date: true,
        review_cadence: true,
        last_check_in_at: true,
        created_at: true,
      },
    });
    if (goals.length === 0) return { due: 0, overdue: 0 };

    const items = goals.map((g) => {
      const isLate = !!g.next_review_date && g.next_review_date < lateBefore;
      return {
        orgId,
        module: 'goals' as const,
        event_type: isLate ? 'goal_check_in_overdue' : 'goal_check_in_due',
        recipients: [g.owner_user_id],
        title: isLate ? 'Check-in overdue' : 'Check-in due',
        body: isLate
          ? `"${g.title}" has been waiting for a check-in since ${this.formatDate(g.next_review_date!)}.`
          : `"${g.title}" is due for a check-in. It takes under a minute.`,
        link: '/goals/my-check-ins',
        entity: { type: 'goal', id: g.id },
        dedupe: true,
      };
    });

    await this.notifications.emitMany(items);
    return {
      due: items.filter((i) => i.event_type === 'goal_check_in_due').length,
      overdue: items.filter((i) => i.event_type === 'goal_check_in_overdue').length,
    };
  }

  /**
   * When a goal goes amber or red, tell the owners of the goals it supports.
   * This is what the web buys you: no reporting hierarchy is needed, because
   * the links already know who is depending on this goal.
   */
  private async notifyDependentsOfRisk(
    orgId: string,
    goalId: string,
    goalTitle: string,
    status: GoalStatus,
    actorId: string,
  ) {
    const dependents = await this.prisma.goalLink.findMany({
      where: {
        organization_id: orgId,
        supporting_goal_id: goalId,
        supported: { is_deleted: false },
      },
      include: { supported: { select: { id: true, title: true, owner_user_id: true } } },
    });
    if (dependents.length === 0) return;

    const label = status === 'off_track' ? 'off track' : 'at risk';
    const actor = await this.notifications.userName(actorId);

    await this.notifications.emitMany(
      dependents
        .filter((d) => d.supported.owner_user_id !== actorId)
        .map((d) => ({
          orgId,
          module: 'goals' as const,
          event_type: 'goal_at_risk',
          recipients: [d.supported.owner_user_id],
          title: `A goal you depend on is ${label}`,
          body: `${actor} marked "${goalTitle}" ${label}. It supports your goal "${d.supported.title}".`,
          link: `/goals/${goalId}`,
          entity: { type: 'goal', id: goalId },
        })),
    );
  }

  // ─── Graph helpers ──────────────────────────────────────────────────────────
  /**
   * Every live link edge in the org. An SME has hundreds of goals at most, so
   * loading the edge list and walking it in memory beats a recursive SQL query
   * on every read — and it is far easier to read and audit.
   */
  private async allLinks(orgId: string) {
    return this.prisma.goalLink.findMany({
      where: {
        organization_id: orgId,
        supporting: { is_deleted: false },
        supported: { is_deleted: false },
      },
      select: { supporting_goal_id: true, supported_goal_id: true },
    });
  }

  /**
   * Every goal reachable from `startId`. `down` follows the supports direction
   * (the goals this one helps); `up` follows its supporters.
   */
  private reachable(
    links: { supporting_goal_id: string; supported_goal_id: string }[],
    startId: string,
    direction: 'up' | 'down',
  ): Set<string> {
    const next = this.adjacency(links, direction);
    const seen = new Set<string>();
    const queue = [startId];
    while (queue.length) {
      const id = queue.shift()!;
      for (const n of next.get(id) ?? []) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    return seen;
  }

  private adjacency(
    links: { supporting_goal_id: string; supported_goal_id: string }[],
    direction: 'up' | 'down',
  ): Map<string, string[]> {
    const next = new Map<string, string[]>();
    for (const l of links) {
      const [from, to] =
        direction === 'down'
          ? [l.supporting_goal_id, l.supported_goal_id]
          : [l.supported_goal_id, l.supporting_goal_id];
      const arr = next.get(from);
      if (arr) arr.push(to);
      else next.set(from, [to]);
    }
    return next;
  }

  /**
   * Shortest chain of goal TITLES from `fromId` to `toId` following the
   * supports direction, or null if there is no path. Used to name the loop when
   * a link is refused, so the message says which goals close the circle.
   */
  private async findPath(orgId: string, fromId: string, toId: string): Promise<string[] | null> {
    const links = await this.allLinks(orgId);
    const next = this.adjacency(links, 'down');

    const prev = new Map<string, string>();
    const seen = new Set([fromId]);
    const queue = [fromId];
    let found = false;
    while (queue.length && !found) {
      const id = queue.shift()!;
      for (const n of next.get(id) ?? []) {
        if (seen.has(n)) continue;
        seen.add(n);
        prev.set(n, id);
        if (n === toId) {
          found = true;
          break;
        }
        queue.push(n);
      }
    }
    if (!found) return null;

    const ids: string[] = [toId];
    let cur = toId;
    while (prev.has(cur)) {
      cur = prev.get(cur)!;
      ids.unshift(cur);
    }

    const rows = await this.prisma.goal.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r.title]));
    return ids.map((id) => byId.get(id) ?? 'a goal');
  }

  // ─── Shaping ────────────────────────────────────────────────────────────────
  private goalInclude() {
    return {
      owner: { select: { id: true, name: true, email: true } },
      department: { select: { id: true, name: true } },
    } as const;
  }

  /** Prisma hands Decimals back as objects — send plain numbers to the client. */
  private shape<T extends { target_value: unknown; current_value: unknown }>(goal: T) {
    return {
      ...goal,
      target_value: goal.target_value == null ? null : Number(goal.target_value),
      current_value: goal.current_value == null ? null : Number(goal.current_value),
    };
  }

  private shapeCheckIn<T extends { recorded_value: unknown; target_value_at_check_in: unknown }>(ci: T) {
    return {
      ...ci,
      recorded_value: ci.recorded_value == null ? null : Number(ci.recorded_value),
      target_value_at_check_in:
        ci.target_value_at_check_in == null ? null : Number(ci.target_value_at_check_in),
    };
  }

  /** Open vs closed linked-task counts for a whole page in two grouped queries. */
  private async taskCountsByGoal(orgId: string, goalIds: string[]) {
    const out = new Map<string, { open: number; closed: number }>();
    if (goalIds.length === 0) return out;

    const [open, total] = await Promise.all([
      this.prisma.task.groupBy({
        by: ['goal_id'],
        where: {
          organization_id: orgId,
          is_deleted: false,
          goal_id: { in: goalIds },
          status: { type: { notIn: TERMINAL_TYPES } },
        },
        _count: { _all: true },
      }),
      this.prisma.task.groupBy({
        by: ['goal_id'],
        where: { organization_id: orgId, is_deleted: false, goal_id: { in: goalIds } },
        _count: { _all: true },
      }),
    ]);

    const openBy = new Map(open.map((r) => [r.goal_id!, r._count._all]));
    for (const t of total) {
      const o = openBy.get(t.goal_id!) ?? 0;
      out.set(t.goal_id!, { open: o, closed: t._count._all - o });
    }
    return out;
  }

  /**
   * The one definition of "owes a check-in", shared by My check-ins, the
   * dashboard and the nightly reminder so all three can never disagree.
   * A goal with no cadence was never promised a rhythm, so it is only chased
   * once it has gone quiet for GOAL_STALE_DAYS.
   */
  private checkInDueWhere(now: Date): Prisma.GoalWhereInput {
    const today = this.endOfDay(now);
    const staleBefore = this.daysAgo(now, GOAL_STALE_DAYS);
    return {
      status: { notIn: UNCHASED_STATUSES },
      OR: [
        { next_review_date: { lte: today } },
        { review_cadence: 'none', last_check_in_at: { lt: staleBefore } },
        { review_cadence: 'none', last_check_in_at: null, created_at: { lt: staleBefore } },
      ],
    };
  }

  /** Plain-language reason this goal is being chased for a check-in. */
  private dueReason(
    g: {
      next_review_date: Date | null;
      review_cadence: GoalCadence;
      last_check_in_at: Date | null;
      created_at: Date;
    },
    now: Date,
  ): string {
    if (g.next_review_date) {
      const days = this.daysBetween(g.next_review_date, now);
      if (days <= 0) return 'Due today';
      return `${days} day${days === 1 ? '' : 's'} overdue`;
    }
    const days = this.daysBetween(g.last_check_in_at ?? g.created_at, now);
    return g.last_check_in_at
      ? `No check-in for ${days} days`
      : `Created ${days} days ago, never checked in`;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────
  private async findActiveOrFail(orgId: string, id: string) {
    const goal = await this.prisma.goal.findFirst({
      where: { id, organization_id: orgId, is_deleted: false },
    });
    if (!goal) throw new NotFoundException('Goal not found');
    return goal;
  }

  private async findLinkOrFail(orgId: string, linkId: string) {
    const link = await this.prisma.goalLink.findFirst({
      where: { id: linkId, organization_id: orgId },
      include: {
        supporting: { select: { title: true } },
        supported: { select: { title: true } },
      },
    });
    if (!link) throw new NotFoundException('Link not found');
    return link;
  }

  private toDecimal(v: number | string | null | undefined): Prisma.Decimal | null {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[, ]/g, ''));
    if (isNaN(n)) throw new BadRequestException('Target and recorded values must be numbers.');
    return new Prisma.Decimal(n);
  }

  private nextReviewDate(from: Date, cadence: GoalCadence): Date | null {
    const d = new Date(from);
    switch (cadence) {
      case 'weekly':
        d.setDate(d.getDate() + 7);
        return d;
      case 'biweekly':
        d.setDate(d.getDate() + 14);
        return d;
      case 'monthly':
        d.setMonth(d.getMonth() + 1);
        return d;
      case 'quarterly':
        d.setMonth(d.getMonth() + 3);
        return d;
      default:
        return null;
    }
  }

  private diff(before: any, after: any, fields: string[]) {
    const changes: Record<string, { before: any; after: any }> = {};
    const norm = (v: any) =>
      v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : v.toString();
    for (const f of fields) {
      const b = norm(before[f]);
      const a = norm(after[f]);
      if (b !== a) changes[f] = { before: b, after: a };
    }
    return changes;
  }

  private parseDate(value: string, field: string): Date {
    const d = new Date(value);
    if (isNaN(d.getTime())) throw new BadRequestException(`Invalid ${field}`);
    return d;
  }

  private endOfDay(d: Date): Date {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  }

  private daysAgo(from: Date, days: number): Date {
    const d = new Date(from);
    d.setDate(d.getDate() - days);
    return d;
  }

  private daysBetween(from: Date, to: Date): number {
    const a = new Date(from);
    a.setHours(0, 0, 0, 0);
    const b = new Date(to);
    b.setHours(0, 0, 0, 0);
    return Math.round((b.getTime() - a.getTime()) / 86400000);
  }

  private formatDate(d: Date): string {
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }
}
