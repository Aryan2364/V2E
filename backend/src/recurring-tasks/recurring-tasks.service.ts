import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  DataScope,
  PermissionAction,
  RecurringAccessKind,
  RecurringAccessLevel,
  type TaskActionType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService } from '../access-rights/scope.service';
import { SubjectEligibilityService } from '../access-rights/subject-eligibility.service';
import { AssigneeVisibilityService } from '../assignee-visibility/assignee-visibility.service';
import { Principal } from '../access-rights/permissions.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateRecurringDto } from './dto/create-recurring.dto';
import { RecurringEditScope, UpdateRecurringDto } from './dto/update-recurring.dto';
import { CreateScheduleEntryDto } from './dto/create-schedule-entry.dto';
import { TERMINAL_TYPES } from '../tasks/status-phase';
import { ACTIVE_ASSIGNEE } from '../tasks/active-assignee';
import { normaliseExtensions } from '../tasks/task-attachments.service';
import { assertActiveOrgMembers } from '../common/org-members';
import { assertMastersUsable } from '../common/task-masters-usable';
import { shouldEntryFireToday, type RecurrenceEntry } from '../common/recurrence/should-fire-today';

const ENTRY_INCLUDE = { orderBy: { order_index: 'asc' as const } };

/** Recurring templates are task content — they share the task content leaf. */
const TASK_LEAF = 'tasks.task.manage';

/**
 * SUBJECT-eligibility leaf: "may this person be given a task at all?" — the same key
 * `TasksService.TASK_SUBJECT` uses. A recurring template is a task factory, so the
 * people on it must clear exactly the gate a one-time task's assignees clear; the
 * scheduler will otherwise mint real tasks for an ineligible person every cycle.
 */
const TASK_SUBJECT = 'tasks.subject.assignable';

/** What an edit actually did to already-spawned work, so the UI can say it out loud. */
export interface RecurringPropagationSummary {
  /** Open child tasks whose roster was actually changed. */
  applied_to: number;
  /** Open child tasks deliberately left alone, each with a human reason. */
  skipped: Array<{ task_id: string; title: string; reason: string }>;
}

/** Which slice of templates the caller wants: work they SENT vs work they RECEIVED. */
export type RecurringRelation = 'incoming' | 'outgoing' | 'all';

export interface ListTemplatesQuery {
  scope?: DataScope;
  relation?: RecurringRelation;
  status?: 'active' | 'paused';
  category_id?: string;
  priority_id?: string;
  department_id?: string;
  search?: string;
}

@Injectable()
export class RecurringTasksService {
  private readonly logger = new Logger(RecurringTasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly notifications: NotificationsService,
    private readonly assigneeVisibility: AssigneeVisibilityService,
    private readonly subjects: SubjectEligibilityService,
  ) {}

  /** Read a JSON user-id array column safely. */
  private jsonIds(value: unknown): string[] {
    return (Array.isArray(value) ? value : []) as string[];
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async enrichTemplates(templates: any[], now: Date = new Date(), principal?: Principal) {
    if (templates.length === 0) return [];
    // One batched lookup for every person referenced (creator + assignees + cc).
    const userIds = new Set<string>();
    const deptIds = new Set<string>();
    for (const t of templates) {
      userIds.add(t.created_by_user_id);
      this.jsonIds(t.assignee_user_ids).forEach((id) => userIds.add(id));
      this.jsonIds(t.cc_user_ids).forEach((id) => userIds.add(id));
      if (t.department_id) deptIds.add(t.department_id);
    }
    const [users, depts] = await Promise.all([
      userIds.size
        ? this.prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      deptIds.size
        ? this.prisma.department.findMany({ where: { id: { in: [...deptIds] } }, select: { id: true, name: true } })
        : Promise.resolve([]),
    ]);
    const nameMap = new Map(users.map((u) => [u.id, u.name]));
    const deptMap = new Map(depts.map((d) => [d.id, d.name]));
    const nameOf = (id: string) => nameMap.get(id) ?? 'Unknown';

    // Which of these templates has this user been granted Drive-style edit on? The
    // edit button is shown only to the creator, an admin, or a grant-edit sharee —
    // never to a plain assignee (assignees receive tasks, they don't own the recurrence).
    let editGrantedIds = new Set<string>();
    if (principal) {
      const grants = await this.prisma.recurringTemplateAccess.findMany({
        where: {
          recurring_template_id: { in: templates.map((t) => t.id) },
          user_id: principal.userId,
          kind: RecurringAccessKind.grant,
          level: RecurringAccessLevel.edit,
        },
        select: { recurring_template_id: true },
      });
      editGrantedIds = new Set(grants.map((g) => g.recurring_template_id));
    }

    return templates.map((t) => {
      const assignees = this.jsonIds(t.assignee_user_ids);
      const cc = this.jsonIds(t.cc_user_ids);
      const occurrences = (t.schedule_entries ?? []).reduce((sum: number, e: any) => sum + (e.occurrence_count ?? 0), 0);
      return {
        ...t,
        created_by_name: nameOf(t.created_by_user_id),
        assignee_names: assignees.map(nameOf),
        cc_names: cc.map(nameOf),
        department_name: t.department_id ? deptMap.get(t.department_id) ?? null : null,
        occurrences,
        next_run: this.nextRunDate(t, now),
        can_manage: principal ? t.created_by_user_id === principal.userId || principal.isAdmin : false,
        can_edit: principal
          ? t.created_by_user_id === principal.userId || principal.isAdmin || editGrantedIds.has(t.id)
          : false,
      };
    });
  }

  private async enrichTemplate(template: any) {
    if (!template) return null;
    const user = await this.prisma.user.findUnique({
      where: { id: template.created_by_user_id },
      select: { name: true },
    });
    return {
      ...template,
      created_by_name: user?.name ?? 'Unknown',
    };
  }


  /**
   * A recurring template is a private record (it spawns private tasks). Allow an
   * actor only if they are directly on it (creator; assignees too, except for
   * delete) OR it falls within their effective scope for `action` over one of its
   * participants. External callers pass their principal; internal callers
   * (scheduler, post-mutation reads) pass none. Fails closed.
   */
  async assertCanAccessTemplate(
    orgId: string,
    principal: Principal | undefined,
    templateId: string,
    action: PermissionAction,
  ): Promise<void> {
    if (!principal) return;
    const t = await this.prisma.recurringTemplate.findFirst({
      where: { id: templateId, organization_id: orgId },
      select: { created_by_user_id: true, assignee_user_ids: true },
    });
    if (!t) throw new NotFoundException(`Recurring template ${templateId} not found`);
    const assigneeIds = (Array.isArray(t.assignee_user_ids) ? t.assignee_user_ids : []) as string[];
    const isCreator = t.created_by_user_id === principal.userId;
    const isAssignee = assigneeIds.includes(principal.userId);
    // The creator owns the recurrence and may read/edit/delete it. Assignees only
    // receive the spawned tasks — being on the template grants READ, never the right
    // to edit or delete it. Editing/deleting stays with the creator (plus explicit
    // grants and scope elevation over the creator, handled below).
    if (isCreator) return;
    if (action === PermissionAction.read && isAssignee) return;

    // Google-Drive-style per-user override, layered on top of the rules.
    const override = await this.prisma.recurringTemplateAccess.findUnique({
      where: { recurring_template_id_user_id: { recurring_template_id: templateId, user_id: principal.userId } },
      select: { kind: true, level: true },
    });
    // A grant extends read (any level) or edit (level=edit) to a non-participant.
    // It never confers delete — destroying a template stays with the creator/admin.
    if (override?.kind === RecurringAccessKind.grant && action !== PermissionAction.delete) {
      if (action === PermissionAction.read) return;
      if (action === PermissionAction.edit && override.level === RecurringAccessLevel.edit) return;
    }
    // A revoke hides the template from a would-be scope viewer (admins bypass; fails
    // closed as NotFound so we don't leak the row's existence).
    if (override?.kind === RecurringAccessKind.revoke && !principal.isAdmin) {
      throw new NotFoundException(`Recurring template ${templateId} not found`);
    }

    // Scope elevation acts on the template's OWNER. For READ we also consider the
    // assignees so a manager of an assignee can view it. For EDIT/DELETE the target
    // is the creator alone — otherwise an assignee's own-scope `edit`/`delete` would
    // match their own id in the list and re-grant them the edit they must not have.
    const scopeTargets =
      action === PermissionAction.read ? [t.created_by_user_id, ...assigneeIds] : [t.created_by_user_id];
    await this.scope.assertCanActOn(orgId, principal, TASK_LEAF, action, scopeTargets);
  }

  // ─── Google-Drive-style access management ────────────────────────────────────

  /** Only the creator or an admin may manage a template's sharing. Returns the template. */
  private async assertCanManageAccess(orgId: string, principal: Principal, templateId: string) {
    const t = await this.prisma.recurringTemplate.findFirst({
      where: { id: templateId, organization_id: orgId },
      select: { id: true, title: true, created_by_user_id: true, assignee_user_ids: true, cc_user_ids: true },
    });
    if (!t) throw new NotFoundException(`Recurring template ${templateId} not found`);
    if (t.created_by_user_id !== principal.userId && !principal.isAdmin) {
      throw new ForbiddenException('Only the creator or an admin can manage who can see this recurring task');
    }
    return t;
  }

  /** The access panel: rule-based participants + explicit shares + explicit removals. */
  async getAccess(orgId: string, principal: Principal, templateId: string) {
    const t = await this.assertCanManageAccess(orgId, principal, templateId);
    const assignees = this.jsonIds(t.assignee_user_ids);
    const cc = this.jsonIds(t.cc_user_ids);
    const overrides = await this.prisma.recurringTemplateAccess.findMany({
      where: { organization_id: orgId, recurring_template_id: templateId },
      orderBy: { created_at: 'asc' },
    });
    const ids = new Set<string>([t.created_by_user_id, ...assignees, ...cc, ...overrides.map((o) => o.user_id)]);
    const people = ids.size
      ? await this.prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } })
      : [];
    const nameMap = new Map(people.map((p) => [p.id, p.name]));
    const person = (uid: string, extra: Record<string, unknown>) => ({ user_id: uid, name: nameMap.get(uid) ?? 'Unknown', ...extra });

    const ruleViewers = [
      person(t.created_by_user_id, { source: 'creator' }),
      ...assignees.filter((id) => id !== t.created_by_user_id).map((id) => person(id, { source: 'assignee' })),
      ...cc.filter((id) => id !== t.created_by_user_id && !assignees.includes(id)).map((id) => person(id, { source: 'cc' })),
    ];
    const shares = overrides.filter((o) => o.kind === RecurringAccessKind.grant).map((o) => person(o.user_id, { level: o.level }));
    const revokes = overrides.filter((o) => o.kind === RecurringAccessKind.revoke).map((o) => person(o.user_id, {}));

    return { template_id: templateId, title: t.title, rule_viewers: ruleViewers, shares, revokes };
  }

  /** Add or change an override for one person (grant view/edit, or revoke). Notifies them. */
  async setAccess(
    orgId: string,
    principal: Principal,
    templateId: string,
    targetUserId: string,
    kind: RecurringAccessKind,
    level?: RecurringAccessLevel,
  ) {
    const t = await this.assertCanManageAccess(orgId, principal, templateId);
    if (targetUserId === t.created_by_user_id) {
      throw new BadRequestException('The creator always has full access and cannot be changed here');
    }
    await assertActiveOrgMembers(this.prisma, orgId, [targetUserId], 'people');

    const key = { recurring_template_id_user_id: { recurring_template_id: templateId, user_id: targetUserId } };
    if (kind === RecurringAccessKind.grant) {
      const lvl = level === RecurringAccessLevel.edit ? RecurringAccessLevel.edit : RecurringAccessLevel.view;
      await this.prisma.recurringTemplateAccess.upsert({
        where: key,
        create: { organization_id: orgId, recurring_template_id: templateId, user_id: targetUserId, kind, level: lvl, created_by_user_id: principal.userId },
        update: { kind, level: lvl, created_by_user_id: principal.userId },
      });
      await this.notifyAccess(orgId, targetUserId, templateId, t.title, 'shared', lvl);
    } else {
      await this.prisma.recurringTemplateAccess.upsert({
        where: key,
        create: { organization_id: orgId, recurring_template_id: templateId, user_id: targetUserId, kind, level: null, created_by_user_id: principal.userId },
        update: { kind, level: null, created_by_user_id: principal.userId },
      });
      await this.notifyAccess(orgId, targetUserId, templateId, t.title, 'removed');
    }
    return this.getAccess(orgId, principal, templateId);
  }

  /** Clear an override entirely: un-share (was a grant) or restore (was a revoke). Notifies them. */
  async clearAccess(orgId: string, principal: Principal, templateId: string, targetUserId: string) {
    const t = await this.assertCanManageAccess(orgId, principal, templateId);
    const existing = await this.prisma.recurringTemplateAccess.findUnique({
      where: { recurring_template_id_user_id: { recurring_template_id: templateId, user_id: targetUserId } },
      select: { kind: true },
    });
    if (existing) {
      await this.prisma.recurringTemplateAccess.delete({
        where: { recurring_template_id_user_id: { recurring_template_id: templateId, user_id: targetUserId } },
      });
      await this.notifyAccess(orgId, targetUserId, templateId, t.title, existing.kind === RecurringAccessKind.grant ? 'removed' : 'restored');
    }
    return this.getAccess(orgId, principal, templateId);
  }

  private async notifyAccess(
    orgId: string,
    userId: string,
    templateId: string,
    title: string,
    kind: 'shared' | 'removed' | 'restored',
    level?: RecurringAccessLevel,
  ) {
    const copy = {
      shared: { event_type: 'recurring_shared', title: 'Shared with you', body: `You were given ${level === RecurringAccessLevel.edit ? 'edit' : 'view'} access to the recurring task “${title}”.` },
      restored: { event_type: 'recurring_shared', title: 'Access restored', body: `Your access to the recurring task “${title}” was restored.` },
      removed: { event_type: 'recurring_access_removed', title: 'Access updated', body: `Your access to the recurring task “${title}” was removed.` },
    }[kind];
    await this.notifications
      .emit({
        orgId,
        module: 'tasks',
        event_type: copy.event_type,
        recipients: [userId],
        title: copy.title,
        body: copy.body,
        link: `/dashboard/tasks/recurring/${templateId}`,
        entity: { type: 'recurring_template', id: templateId },
      })
      .catch(() => {});
  }

  private async findTemplateOrFail(orgId: string, templateId: string) {
    const t = await this.prisma.recurringTemplate.findFirst({
      where: { id: templateId, organization_id: orgId },
      include: { schedule_entries: ENTRY_INCLUDE },
    });
    if (!t) throw new NotFoundException(`Recurring template ${templateId} not found`);
    return t;
  }

  /**
   * A linked goal must be a real goal in THIS org — otherwise a pasted foreign id
   * becomes a cross-org reference on every spawned instance. Empty/undefined skips.
   */
  private async assertGoalInOrg(orgId: string, goalId: string | undefined | null): Promise<void> {
    if (!goalId) return;
    const goal = await this.prisma.goal.findFirst({
      where: { id: goalId, organization_id: orgId },
      select: { id: true },
    });
    if (!goal) throw new BadRequestException('Linked goal not found in this organization');
  }

  /**
   * The assignee picker's visibility rules re-checked at SAVE time — the exact twin of
   * `TasksService.assertAssigneesVisible`, using the same resolved pool the picker
   * itself renders. A hand-crafted request must not be able to put someone the editor
   * can't even see onto a recurring template, because the scheduler then spawns a real
   * task for that person every single cycle. Applies to working assignees AND CCs
   * (both are chosen through the same visibility-scoped picker).
   */
  private async assertAssigneesVisible(orgId: string, assignerId: string, userIds: string[]): Promise<void> {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (!ids.length) return;
    const { pool } = await this.assigneeVisibility.resolve(orgId, assignerId);
    const outside = ids.filter((id) => !pool.has(id));
    if (outside.length) {
      throw new BadRequestException(
        'One or more selected people are outside the set you are allowed to assign tasks to.',
      );
    }
  }

  private entryData(orgId: string, templateId: string, dto: CreateScheduleEntryDto, index = 0) {
    return {
      organization_id: orgId,
      recurring_template_id: templateId,
      schedule_type: dto.schedule_type,
      every: dto.every ?? 1,
      days: dto.days ?? [],
      month_days: dto.month_days ?? [],
      yearly_dates: (dto.yearly_dates ?? []) as never,
      time: dto.time,
      start_date: new Date(dto.start_date),
      end_condition: dto.end_condition ?? 'never',
      end_date: dto.end_date ? new Date(dto.end_date) : undefined,
      end_after: dto.end_after ?? undefined,
      order_index: dto.order_index ?? index,
    };
  }

  // ─── List ─────────────────────────────────────────────────────────────────────

  /**
   * Scope- and relation-aware template list. This is the read side of the
   * Mine / My Team / Company switcher — and it is what closes the old leak where
   * every member could read every template in the org.
   *
   * - `scope` is clamped to the caller's entitled ceiling (never widened).
   * - `relation` ('outgoing' = templates they created, 'incoming' = templates
   *   assigned to them / their team). Ignored at Company (org) scope, which is a
   *   flat complete list.
   * - Per-caller Google-Drive overrides are layered on: a personal grant reveals a
   *   template outside their scope; a personal revoke hides one they'd otherwise see
   *   (never for the creator, an assignee, or an admin).
   */
  async listTemplates(orgId: string, principal?: Principal, query: ListTemplatesQuery = {}, now: Date = new Date()) {
    // Internal callers (no principal) get the raw org list — external HTTP always scopes.
    if (!principal) {
      const all = await this.prisma.recurringTemplate.findMany({
        where: { organization_id: orgId },
        include: { schedule_entries: ENTRY_INCLUDE },
        orderBy: { created_at: 'desc' },
      });
      return { items: await this.enrichTemplates(all, now), max_scope: null, applied_scope: null };
    }

    const { max, effective } = await this.scope.resolveListScope(orgId, principal, TASK_LEAF, query.scope ?? null);
    if (effective === null) {
      return { items: [], max_scope: max, applied_scope: null };
    }
    const visible = await this.scope.visibleUserIds(orgId, principal.userId, effective);
    const allowed = visible === 'ALL' ? null : new Set(visible);
    const inScope = (uid: string) => allowed === null || allowed.has(uid);
    const isOrg = effective === DataScope.org;

    // DB-pushable filters.
    const where: Record<string, unknown> = { organization_id: orgId };
    if (query.status === 'active') where.is_active = true;
    else if (query.status === 'paused') where.is_active = false;
    if (query.category_id) where.category_id = query.category_id;
    if (query.priority_id) where.priority_id = query.priority_id;
    if (query.department_id) where.department_id = query.department_id;
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const templates = await this.prisma.recurringTemplate.findMany({
      where,
      include: { schedule_entries: ENTRY_INCLUDE },
      orderBy: { created_at: 'desc' },
    });

    // The caller's own access overrides across this candidate set.
    const overrides = templates.length
      ? await this.prisma.recurringTemplateAccess.findMany({
          where: { organization_id: orgId, user_id: principal.userId, recurring_template_id: { in: templates.map((t) => t.id) } },
          select: { recurring_template_id: true, kind: true },
        })
      : [];
    const grantedToMe = new Set(overrides.filter((o) => o.kind === RecurringAccessKind.grant).map((o) => o.recurring_template_id));
    const revokedFromMe = new Set(overrides.filter((o) => o.kind === RecurringAccessKind.revoke).map((o) => o.recurring_template_id));

    const relation: RecurringRelation = query.relation ?? 'all';

    const filtered = templates.filter((t) => {
      const assignees = this.jsonIds(t.assignee_user_ids);
      const isCreator = t.created_by_user_id === principal.userId;
      const isAssignee = assignees.includes(principal.userId);
      // A revoke hides the template from the caller — but never from the creator, an
      // assignee (assignment ≠ visibility), or an admin.
      if (revokedFromMe.has(t.id) && !isCreator && !isAssignee && !principal.isAdmin) return false;
      // Company view: flat complete list (admins & org-scope readers see everything).
      if (isOrg) return true;
      const creatorInScope = inScope(t.created_by_user_id);
      const assigneeInScope = assignees.some(inScope);
      // A personal grant is about ME specifically — it surfaces the shared-with-me
      // template under 'received' at any scope (it's work that came to me).
      const sharedToMe = grantedToMe.has(t.id);
      if (relation === 'outgoing') return creatorInScope;
      if (relation === 'incoming') return assigneeInScope || sharedToMe;
      return creatorInScope || assigneeInScope || sharedToMe;
    });

    return {
      items: await this.enrichTemplates(filtered, now, principal),
      max_scope: max,
      applied_scope: effective,
    };
  }

  /** The next calendar day (from `now`) any active schedule entry fires, ISO or null. */
  private nextRunDate(template: any, now: Date): string | null {
    if (!template.is_active) return null;
    const entries = (template.schedule_entries ?? []).filter((e: any) => e.is_active) as RecurrenceEntry[];
    if (entries.length === 0) return null;
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    for (let i = 0; i <= 366; i++) {
      const day = new Date(start);
      day.setDate(day.getDate() + i);
      if (entries.some((e) => shouldEntryFireToday(e, day))) return day.toISOString();
    }
    return null;
  }


  // ─── Create ──────────────────────────────────────────────────────────────────

  async createTemplate(orgId: string, userId: string, dto: CreateRecurringDto) {
    await this.assertGoalInOrg(orgId, dto.linked_goal_id);
    await assertMastersUsable(this.prisma, orgId, {
      category_id: dto.category_id,
      priority_id: dto.priority_id,
      department_id: dto.department_id,
    });
    await assertActiveOrgMembers(this.prisma, orgId, dto.escalation_user_ids, 'escalation contacts');
    await assertActiveOrgMembers(
      this.prisma,
      orgId,
      [...(dto.assignee_user_ids ?? []), ...(dto.cc_user_ids ?? [])],
      'assignees or CC recipients',
    );

    // Subject eligibility (fail loud, before any writes): every WORKING assignee must be
    // eligible to be assigned a task at all — even if they have no Tasks actor access.
    // CCs are observers, so they are deliberately exempt.
    await this.subjects.assertAllEligible(orgId, TASK_SUBJECT, dto.assignee_user_ids ?? []);

    // The picker's visibility rules re-checked at save time: the creator may only put
    // people they're allowed to assign to on the template (assignees AND CCs).
    await this.assertAssigneesVisible(orgId, userId, [
      ...(dto.assignee_user_ids ?? []),
      ...(dto.cc_user_ids ?? []),
    ]);

    const template = await this.prisma.recurringTemplate.create({
      data: {
        organization_id: orgId,
        created_by_user_id: userId,
        title: dto.title,
        description: dto.description,
        quadrant: dto.quadrant ?? 'Q2',
        category_id: dto.category_id,
        priority_id: dto.priority_id,
        has_multiple_schedules: dto.schedule_entries.length > 1,
        completion_mode: dto.completion_mode ?? 'any_can_complete',
        proof_required: dto.proof_required ?? false,
        proof_allowed_extensions: normaliseExtensions(dto.proof_allowed_extensions),
        escalation_user_ids: dto.escalation_user_ids ?? [],
        linked_goal_id: dto.linked_goal_id || null,
        assignee_user_ids: dto.assignee_user_ids ?? [],
        cc_user_ids: dto.cc_user_ids ?? [],
        checklist_items: (dto.checklist_items ?? []) as never,
        reminder_specs: (dto.reminders ?? []) as never,
        department_id: dto.department_id,
      },
    });

    await this.prisma.recurringScheduleEntry.createMany({
      data: dto.schedule_entries.map((e, i) => this.entryData(orgId, template.id, e, i)),
    });

    const created = await this.prisma.recurringTemplate.findUnique({
      where: { id: template.id },
      include: { schedule_entries: ENTRY_INCLUDE },
    });
    return this.enrichTemplate(created);
  }


  // ─── Update ──────────────────────────────────────────────────────────────────

  async updateTemplate(orgId: string, templateId: string, dto: UpdateRecurringDto, actingUserId: string) {
    const existing = await this.findTemplateOrFail(orgId, templateId);
    await this.assertGoalInOrg(orgId, dto.linked_goal_id);
    await assertMastersUsable(this.prisma, orgId, {
      category_id: dto.category_id,
      priority_id: dto.priority_id,
      department_id: dto.department_id,
    });
    await assertActiveOrgMembers(this.prisma, orgId, dto.escalation_user_ids, 'escalation contacts');
    await assertActiveOrgMembers(
      this.prisma,
      orgId,
      [...(dto.assignee_user_ids ?? []), ...(dto.cc_user_ids ?? [])],
      'assignees or CC recipients',
    );

    // The roster this edit RESULTS in — an omitted field keeps what's already stored.
    const nextAssignees = dto.assignee_user_ids ?? this.jsonIds(existing.assignee_user_ids);
    const nextCc = dto.cc_user_ids ?? this.jsonIds(existing.cc_user_ids);
    // Gate the whole resulting set, not just the ids being added: a partial payload
    // (e.g. only `cc_user_ids`) must still leave a template whose every person clears
    // both gates. Only run it when the edit actually touches the roster, so an
    // unrelated edit (a title fix) by someone with a narrower picker than the original
    // creator isn't blocked by people they didn't choose and aren't changing.
    if (dto.assignee_user_ids !== undefined || dto.cc_user_ids !== undefined) {
      // Fail loud BEFORE any write: every working assignee must be eligible to be
      // assigned a task at all. CCs are observers, so they're deliberately exempt.
      await this.subjects.assertAllEligible(orgId, TASK_SUBJECT, nextAssignees);
      // …and every person on the template — assignee or CC — must be inside the set
      // this editor is allowed to assign to (the picker's rules, re-checked at save).
      await this.assertAssigneesVisible(orgId, actingUserId, [...nextAssignees, ...nextCc]);
    }

    if (dto.schedule_entries !== undefined) {
      if (dto.schedule_entries.length === 0) {
        throw new BadRequestException('Template must have at least one schedule entry');
      }
      await this.prisma.recurringScheduleEntry.deleteMany({
        where: { recurring_template_id: templateId },
      });
      await this.prisma.recurringScheduleEntry.createMany({
        data: dto.schedule_entries.map((e, i) => this.entryData(orgId, templateId, e, i)),
      });
    }

    const entryCount = await this.prisma.recurringScheduleEntry.count({
      where: { recurring_template_id: templateId },
    });

    const updated = await this.prisma.recurringTemplate.update({
      where: { id: templateId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.quadrant !== undefined && { quadrant: dto.quadrant }),
        ...(dto.category_id !== undefined && { category_id: dto.category_id }),
        ...(dto.priority_id !== undefined && { priority_id: dto.priority_id }),
        ...(dto.completion_mode !== undefined && { completion_mode: dto.completion_mode }),
        ...(dto.proof_required !== undefined && { proof_required: dto.proof_required }),
        ...(dto.proof_allowed_extensions !== undefined && {
          proof_allowed_extensions: normaliseExtensions(dto.proof_allowed_extensions),
        }),
        ...(dto.escalation_user_ids !== undefined && { escalation_user_ids: dto.escalation_user_ids }),
        ...(dto.linked_goal_id !== undefined && { linked_goal_id: dto.linked_goal_id || null }),
        ...(dto.assignee_user_ids !== undefined && { assignee_user_ids: dto.assignee_user_ids }),
        ...(dto.cc_user_ids !== undefined && { cc_user_ids: dto.cc_user_ids }),
        ...(dto.checklist_items !== undefined && { checklist_items: dto.checklist_items as never }),
        ...(dto.reminders !== undefined && { reminder_specs: dto.reminders as never }),
        ...(dto.department_id !== undefined && { department_id: dto.department_id }),
        has_multiple_schedules: entryCount > 1,
      },
      include: { schedule_entries: ENTRY_INCLUDE },
    });

    // Ask-every-time propagation. Absent field = `future_only` = exactly the behaviour
    // that shipped before this option existed, so old clients are unaffected.
    const applyTo = dto.apply_to ?? RecurringEditScope.future_only;
    const rosterTouched = dto.assignee_user_ids !== undefined || dto.cc_user_ids !== undefined;
    const propagation: RecurringPropagationSummary =
      applyTo === RecurringEditScope.future_and_open && rosterTouched
        ? await this.propagateRosterToOpenInstances(orgId, templateId, actingUserId, nextAssignees, nextCc)
        : { applied_to: 0, skipped: [] };

    const enriched = (await this.enrichTemplate(updated))!;
    return { ...enriched, propagation };
  }

  /**
   * Push the template's new roster onto work that has ALREADY been spawned.
   *
   * A recurring template is a factory: editing it normally only changes the copies the
   * scheduler makes next. When the editor picks `future_and_open`, the new roster is
   * also applied to every child task that is still open — so "Priya left, Rahul takes
   * over" actually moves the task sitting in Priya's list today, not only next month's.
   *
   * The rules that keep already-recorded work intact:
   *   - adding someone REVIVES their soft-removed row (clears `removed_at`) rather than
   *     creating a second one, restoring their prior status / checklist / proof state;
   *   - removing someone is a SOFT removal (`removed_at` + `removed_by_user_id`), never
   *     a hard delete — compliance reporting must still show they held the task;
   *   - a person moving between assignee and CC is an IN-PLACE `is_cc` flip, never a
   *     delete-and-recreate, which would throw away their completion state;
   *   - a child that would be left with nobody actually doing the work is SKIPPED and
   *     reported — never silently emptied, and never allowed to fail the whole edit.
   *
   * Only the roster travels. Title / description / schedule stay with the template.
   */
  private async propagateRosterToOpenInstances(
    orgId: string,
    templateId: string,
    actingUserId: string,
    assigneeIds: string[],
    ccIds: string[],
  ): Promise<RecurringPropagationSummary> {
    const summary: RecurringPropagationSummary = { applied_to: 0, skipped: [] };

    // A person named as both a worker and a CC is a worker (the stronger role wins),
    // matching how a spawned instance is built.
    const workers = [...new Set(assigneeIds.filter(Boolean))];
    const observers = [...new Set(ccIds.filter(Boolean))].filter((id) => !workers.includes(id));
    const desired = new Map<string, boolean>();
    for (const id of workers) desired.set(id, false);
    for (const id of observers) desired.set(id, true);

    // "Not yet completed" = not in any terminal phase (completed / partially_completed /
    // incomplete) and not soft-deleted. Closed history is never rewritten.
    const terminalStatuses = await this.prisma.taskStatus.findMany({
      where: { organization_id: orgId, type: { in: TERMINAL_TYPES } },
      select: { id: true },
    });

    const children = await this.prisma.task.findMany({
      where: {
        organization_id: orgId,
        recurring_template_id: templateId,
        is_deleted: false,
        status_id: { notIn: terminalStatuses.map((s) => s.id) },
      },
      select: {
        id: true,
        title: true,
        assignees: { select: { id: true, user_id: true, is_cc: true, removed_at: true } },
      },
    });
    if (children.length === 0) return summary;

    const now = new Date();
    // Same single source of truth the rest of the app filters rosters by
    // (tasks/active-assignee.ts) — applied in memory here because the revive path
    // deliberately needs the soft-removed rows too.
    const isActive = (r: { removed_at: Date | null }) => r.removed_at === ACTIVE_ASSIGNEE.removed_at;

    for (const child of children) {
      const rows = child.assignees;

      // An open task with no active non-CC assignee is nobody's job. If this roster
      // would produce that, leave the child exactly as it is and report it.
      if (workers.length === 0) {
        summary.skipped.push({
          task_id: child.id,
          title: child.title,
          reason:
            'Left unchanged — the new list has no working assignee, and an open task cannot be left with nobody doing it.',
        });
        continue;
      }

      // Nothing to do if this child's live roster already matches.
      const liveKey = rows
        .filter(isActive)
        .map((r) => `${r.user_id}:${r.is_cc}`)
        .sort()
        .join('|');
      const desiredKey = [...desired.entries()].map(([id, isCc]) => `${id}:${isCc}`).sort().join('|');
      if (liveKey === desiredKey) continue;

      const added: string[] = [];
      const removed: string[] = [];
      const roleChanged: string[] = [];

      // One child = one transaction, so a child is never left half-rostered.
      await this.prisma.$transaction(async (tx) => {
        // Soft-remove whoever is no longer on the template.
        for (const row of rows) {
          if (desired.has(row.user_id) || !isActive(row)) continue;
          await tx.taskAssignee.update({
            where: { id: row.id },
            data: { removed_at: now, removed_by_user_id: actingUserId },
          });
          removed.push(row.user_id);
        }
        // Add / revive / re-role everyone the template now names.
        for (const [userId, isCc] of desired) {
          const row = rows.find((r) => r.user_id === userId);
          if (!row) {
            await tx.taskAssignee.create({
              data: { organization_id: orgId, task_id: child.id, user_id: userId, is_cc: isCc },
            });
            added.push(userId);
            continue;
          }
          const wasActive = isActive(row);
          if (wasActive && row.is_cc === isCc) continue;
          await tx.taskAssignee.update({
            where: { id: row.id },
            data: { is_cc: isCc, removed_at: null, removed_by_user_id: null },
          });
          if (wasActive) roleChanged.push(userId);
          else added.push(userId);
        }
      });

      if (added.length === 0 && removed.length === 0 && roleChanged.length === 0) continue;
      summary.applied_to += 1;
      await this.logChildRosterChange(orgId, child.id, actingUserId, { added, removed, roleChanged });
    }

    return summary;
  }

  /**
   * Mirror of `TasksService.logActivity` for the children this edit touched, so the
   * change is traceable on each task's own history rather than only on the template.
   * Best-effort by design: it runs AFTER the roster change has committed, so a
   * transient failure here must never turn an already-successful edit into a 500.
   */
  private async logChildRosterChange(
    orgId: string,
    taskId: string,
    actorId: string,
    change: { added: string[]; removed: string[]; roleChanged: string[] },
  ): Promise<void> {
    // Pure additions read as 'assigned'; anything that moved or dropped a person is a
    // reassignment — the same two actions tasks.service.ts uses for roster edits.
    const action: TaskActionType =
      change.removed.length > 0 || change.roleChanged.length > 0 ? 'reassigned' : 'assigned';
    try {
      await this.prisma.taskActivityLog.create({
        data: {
          organization_id: orgId,
          task_id: taskId,
          performed_by_user_id: actorId,
          action,
          metadata: {
            source: 'recurring_template_update',
            added_user_ids: change.added,
            removed_user_ids: change.removed,
            role_changed_user_ids: change.roleChanged,
          } as never,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Roster activity log (${action}) failed for task ${taskId}: ${(err as Error).message}`,
      );
    }
  }


  // ─── Schedule Entries ─────────────────────────────────────────────────────────

  async listScheduleEntries(orgId: string, templateId: string) {
    await this.findTemplateOrFail(orgId, templateId);
    return this.prisma.recurringScheduleEntry.findMany({
      where: { recurring_template_id: templateId },
      orderBy: { order_index: 'asc' },
    });
  }

  async addScheduleEntry(orgId: string, templateId: string, dto: CreateScheduleEntryDto) {
    await this.findTemplateOrFail(orgId, templateId);
    const count = await this.prisma.recurringScheduleEntry.count({
      where: { recurring_template_id: templateId },
    });
    const entry = await this.prisma.recurringScheduleEntry.create({
      data: this.entryData(orgId, templateId, dto, count),
    });
    await this.prisma.recurringTemplate.update({
      where: { id: templateId },
      data: { has_multiple_schedules: count + 1 > 1 },
    });
    return entry;
  }

  async updateScheduleEntry(
    orgId: string,
    templateId: string,
    entryId: string,
    dto: Partial<CreateScheduleEntryDto>,
  ) {
    await this.findTemplateOrFail(orgId, templateId);
    const entry = await this.prisma.recurringScheduleEntry.findFirst({
      where: { id: entryId, recurring_template_id: templateId },
    });
    if (!entry) throw new NotFoundException(`Schedule entry ${entryId} not found`);

    return this.prisma.recurringScheduleEntry.update({
      where: { id: entryId },
      data: {
        ...(dto.schedule_type !== undefined && { schedule_type: dto.schedule_type }),
        ...(dto.every !== undefined && { every: dto.every }),
        ...(dto.days !== undefined && { days: dto.days }),
        ...(dto.month_days !== undefined && { month_days: dto.month_days }),
        ...(dto.yearly_dates !== undefined && { yearly_dates: dto.yearly_dates as never }),
        ...(dto.time !== undefined && { time: dto.time }),
        ...(dto.start_date !== undefined && { start_date: new Date(dto.start_date) }),
        ...(dto.end_condition !== undefined && { end_condition: dto.end_condition }),
        ...(dto.end_date !== undefined && { end_date: new Date(dto.end_date) }),
        ...(dto.end_after !== undefined && { end_after: dto.end_after }),
        ...(dto.order_index !== undefined && { order_index: dto.order_index }),
      },
    });
  }

  async deleteScheduleEntry(orgId: string, templateId: string, entryId: string) {
    await this.findTemplateOrFail(orgId, templateId);
    // Bind the entry to this template (and thereby this org) before touching it —
    // a bare `where: { id: entryId }` is a cross-parent/cross-org IDOR (AUTHORIZATION.md rule 2).
    const entry = await this.prisma.recurringScheduleEntry.findFirst({
      where: { id: entryId, recurring_template_id: templateId },
      select: { id: true },
    });
    if (!entry) throw new NotFoundException(`Schedule entry ${entryId} not found`);
    const count = await this.prisma.recurringScheduleEntry.count({
      where: { recurring_template_id: templateId },
    });
    if (count <= 1) {
      throw new BadRequestException('Cannot delete the last schedule entry. A template must have at least one.');
    }
    await this.prisma.recurringScheduleEntry.delete({ where: { id: entryId } });
    await this.prisma.recurringTemplate.update({
      where: { id: templateId },
      data: { has_multiple_schedules: count - 1 > 1 },
    });
    return { message: 'Schedule entry deleted' };
  }

  // ─── Pause / Resume ──────────────────────────────────────────────────────────

  async pauseTemplate(orgId: string, templateId: string) {
    await this.findTemplateOrFail(orgId, templateId);
    const updated = await this.prisma.recurringTemplate.update({
      where: { id: templateId },
      data: { is_active: false },
      include: { schedule_entries: ENTRY_INCLUDE },
    });
    return this.enrichTemplate(updated);
  }

  async resumeTemplate(orgId: string, templateId: string) {
    await this.findTemplateOrFail(orgId, templateId);
    const updated = await this.prisma.recurringTemplate.update({
      where: { id: templateId },
      data: { is_active: true },
      include: { schedule_entries: ENTRY_INCLUDE },
    });
    return this.enrichTemplate(updated);
  }


  // ─── Delete ──────────────────────────────────────────────────────────────────

  async deleteTemplate(orgId: string, templateId: string, mode: 'stop' | 'delete-future' | 'delete-all' = 'stop') {
    await this.findTemplateOrFail(orgId, templateId);

    if (mode === 'delete-all') {
      await this.prisma.task.updateMany({
        where: { organization_id: orgId, recurring_template_id: templateId, is_deleted: false },
        data: { is_deleted: true, deleted_at: new Date(), deletion_reason: 'Recurring template deleted' },
      });
      await this.prisma.recurringTemplate.delete({ where: { id: templateId } });
      return { message: 'Template and all instances deleted' };
    }

    if (mode === 'delete-future') {
      // Skip already-closed instances (completed OR incomplete) — only drop still-open future ones.
      const terminalStatuses = await this.prisma.taskStatus.findMany({
        where: { organization_id: orgId, type: { in: TERMINAL_TYPES } },
        select: { id: true },
      });
      await this.prisma.task.updateMany({
        where: {
          organization_id: orgId,
          recurring_template_id: templateId,
          is_deleted: false,
          status_id: { notIn: terminalStatuses.map((s) => s.id) },
        },
        data: { is_deleted: true, deleted_at: new Date(), deletion_reason: 'Recurring template stopped' },
      });
    }

    await this.prisma.recurringTemplate.update({
      where: { id: templateId },
      data: { is_active: false },
    });

    return { message: `Template ${mode === 'delete-future' ? 'stopped and future instances removed' : 'stopped'}` };
  }

  // ─── Instances ───────────────────────────────────────────────────────────────

  async getInstances(orgId: string, templateId: string) {
    await this.findTemplateOrFail(orgId, templateId);
    const tasks = await this.prisma.task.findMany({
      where: { organization_id: orgId, recurring_template_id: templateId, is_deleted: false },
      include: { status: true, priority: true, category: true, assignees: true },
      orderBy: { created_at: 'desc' },
    });

    // Enrich assignees with user name + dept/role (same shape as the task list API).
    const userIds = Array.from(new Set(tasks.flatMap((t) => t.assignees.map((a) => a.user_id))));
    if (userIds.length === 0) return tasks;
    const [users, profiles] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      }),
      this.prisma.employeeProfile.findMany({
        where: { organization_id: orgId, user_id: { in: userIds } },
        select: {
          user_id: true,
          department: { select: { name: true } },
          role: { select: { title: true } },
        },
      }),
    ]);
    const userMap = new Map(users.map((u) => [u.id, u]));
    const profileMap = new Map(profiles.map((p) => [p.user_id, p]));

    return tasks.map((task) => ({
      ...task,
      assignees: task.assignees.map((a) => {
        const u = userMap.get(a.user_id);
        const p = profileMap.get(a.user_id);
        return {
          ...a,
          user: u
            ? { ...u, department: p?.department?.name ?? null, role_title: p?.role?.title ?? null }
            : null,
        };
      }),
    }));
  }

  // ─── Stats / performance ─────────────────────────────────────────────────────

  /**
   * Timing verdict for one spawned instance. Mirrors the Work Overview taxonomy:
   * closed tasks use their persisted `completion_timing` (falling back to the
   * terminal phase), open tasks are `overdue` or `pending`.
   */
  private instanceTiming(task: {
    completion_timing: string | null;
    is_overdue: boolean;
    status: { type: string } | null;
  }): 'early' | 'on_time' | 'late' | 'partial' | 'incomplete' | 'overdue' | 'pending' {
    if (task.completion_timing) return task.completion_timing as never;
    const phase = task.status?.type;
    if (phase === 'completed') return 'on_time';
    if (phase === 'partially_completed') return 'partial';
    if (phase === 'incomplete') return 'incomplete';
    return task.is_overdue ? 'overdue' : 'pending';
  }

  async getStats(orgId: string, templateId: string, now: Date = new Date()) {
    const template = await this.findTemplateOrFail(orgId, templateId);

    const tasks = await this.prisma.task.findMany({
      where: { organization_id: orgId, recurring_template_id: templateId, is_deleted: false },
      select: {
        id: true,
        created_at: true,
        deadline: true,
        completion_timing: true,
        completed_by_user_id: true,
        is_overdue: true,
        completion_mode: true,
        status: { select: { type: true } },
        assignees: {
          where: { is_cc: false },
          select: {
            user_id: true,
            is_completed: true,
            completed_at: true,
            cannot_complete: true,
          },
        },
      },
      orderBy: { created_at: 'asc' },
    });

    const timings = tasks.map((t) => ({ task: t, timing: this.instanceTiming(t) }));
    const count = (k: string) => timings.filter((t) => t.timing === k).length;

    const total = tasks.length;
    const completed = count('early') + count('on_time') + count('late');
    const missed = count('partial') + count('incomplete');
    const open = count('overdue') + count('pending');
    const closed = completed + missed;
    const onTimeDone = count('early') + count('on_time');

    // Streaks over CLOSED instances, newest last (tasks are created_at asc):
    // an early/on-time completion extends the streak; late/partial/incomplete breaks it.
    let currentStreak = 0;
    let bestStreak = 0;
    let run = 0;
    for (const { timing } of timings) {
      if (timing === 'overdue' || timing === 'pending') continue; // still open — no verdict yet
      if (timing === 'early' || timing === 'on_time') {
        run += 1;
        if (run > bestStreak) bestStreak = run;
      } else {
        run = 0;
      }
    }
    currentStreak = run;

    // Last 10 instances (open ones included so "still running" shows in the strip).
    const recent = timings.slice(-10).map(({ task, timing }) => ({
      task_id: task.id,
      date: (task.deadline ?? task.created_at).toISOString(),
      timing,
    }));

    // Per-person record. all_must instances judge each person's own part;
    // any_can instances credit whoever actually closed the task.
    const byUser = new Map<string, { assigned: number; done: number; late: number; missed: number }>();
    const bump = (uid: string, key: 'assigned' | 'done' | 'late' | 'missed') => {
      const row = byUser.get(uid) ?? { assigned: 0, done: 0, late: 0, missed: 0 };
      row[key] += 1;
      byUser.set(uid, row);
    };
    for (const { task, timing } of timings) {
      const closedTask = timing !== 'overdue' && timing !== 'pending';
      for (const a of task.assignees) {
        bump(a.user_id, 'assigned');
        if (task.completion_mode === 'all_must_complete') {
          if (a.is_completed) {
            bump(a.user_id, 'done');
            if (a.completed_at && task.deadline && a.completed_at > task.deadline) bump(a.user_id, 'late');
          } else if (a.cannot_complete || closedTask) {
            bump(a.user_id, 'missed');
          }
        } else if (closedTask) {
          // any_can: the person who closed it owns the outcome; a missed instance
          // has no single owner, so nobody is charged for it.
          if ((timing === 'early' || timing === 'on_time' || timing === 'late') && task.completed_by_user_id === a.user_id) {
            bump(a.user_id, 'done');
            if (timing === 'late') bump(a.user_id, 'late');
          }
        }
      }
    }
    const userIds = Array.from(byUser.keys());
    const users = userIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : [];
    const nameMap = new Map(users.map((u) => [u.id, u.name]));
    const byAssignee = userIds
      .map((uid) => ({ user_id: uid, name: nameMap.get(uid) ?? 'Unknown', ...byUser.get(uid)! }))
      .sort((a, b) => b.assigned - a.assigned);

    // Monthly trend — last 6 calendar months including the current one.
    const months: { key: string; total: number; on_time: number; late: number; missed: number; open: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, total: 0, on_time: 0, late: 0, missed: 0, open: 0 });
    }
    const monthMap = new Map(months.map((m) => [m.key, m]));
    for (const { task, timing } of timings) {
      const d = task.created_at;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const bucket = monthMap.get(key);
      if (!bucket) continue; // older than the window
      bucket.total += 1;
      if (timing === 'early' || timing === 'on_time') bucket.on_time += 1;
      else if (timing === 'late') bucket.late += 1;
      else if (timing === 'partial' || timing === 'incomplete') bucket.missed += 1;
      else bucket.open += 1;
    }

    return {
      template_id: templateId,
      completion_mode: template.completion_mode,
      total_instances: total,
      completed,
      pending: open,
      missed,
      overdue_open: count('overdue'),
      completion_ratio_percent: total > 0 ? Math.round((completed / total) * 100) : 0,
      // Of the instances that have CLOSED, how many finished early/on time.
      on_time_rate_percent: closed > 0 ? Math.round((onTimeDone / closed) * 100) : 0,
      current_streak: currentStreak,
      best_streak: bestStreak,
      timing: {
        early: count('early'),
        on_time: count('on_time'),
        late: count('late'),
        partial: count('partial'),
        incomplete: count('incomplete'),
        overdue: count('overdue'),
        pending: count('pending'),
      },
      recent,
      by_assignee: byAssignee,
      trend_monthly: months.map(({ key, ...rest }) => ({ month: key, ...rest })),
    };
  }

  async getInstanceAttachments(orgId: string, templateId: string, principal: Principal) {
    await this.findTemplateOrFail(orgId, templateId);

    const tasks = await this.prisma.task.findMany({
      where: { organization_id: orgId, recurring_template_id: templateId, is_deleted: false },
      select: {
        id: true,
        title: true,
        created_at: true,
        deadline: true,
        created_by_user_id: true,
      },
    });

    const taskIds = tasks.map((t) => t.id);
    if (taskIds.length === 0) return [];

    const attachments = await this.prisma.taskAttachment.findMany({
      where: {
        organization_id: orgId,
        task_id: { in: taskIds },
        is_deleted: false,
        OR: [
          { comment_id: null },
          { comment: { is_deleted: false } }
        ]
      },
      orderBy: { created_at: 'desc' },
    });

    const userIds = Array.from(new Set(attachments.map((a) => a.uploaded_by_user_id)));
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u.name]));
    const taskMap = new Map(tasks.map((t) => [t.id, t]));

    const result = [];
    for (const att of attachments) {
      const task = taskMap.get(att.task_id);
      if (!task) continue;

      const isCreator = task.created_by_user_id === principal.userId;
      const isOwner = att.uploaded_by_user_id === principal.userId;
      const isAdmin = principal.isAdmin || false;

      const visible = !att.is_proof ||
        att.proof_visibility === 'everyone' ||
        isOwner ||
        isCreator ||
        isAdmin;

      if (!visible) continue;

      result.push({
        id: att.id,
        file_name: att.file_name,
        mime_type: att.mime_type,
        size_bytes: att.size_bytes,
        created_at: att.created_at,
        is_proof: att.is_proof,
        comment_id: att.comment_id,
        uploaded_by_user_id: att.uploaded_by_user_id,
        uploaded_by_name: userMap.get(att.uploaded_by_user_id) ?? 'Unknown',
        task_id: att.task_id,
        task_title: task.title,
        task_date: task.deadline ?? task.created_at,
      });
    }

    return result;
  }
}
