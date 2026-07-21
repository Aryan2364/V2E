import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PermissionAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertActiveOrgMembers } from '../common/org-members';
import { PermissionsService, type Principal } from '../access-rights/permissions.service';

const DELEGATION_LEAF = 'delegation.delegation.manage';
import {
  CreateDelegationDto,
  UpdateDelegationDto,
  CriterionInput,
} from './dto/delegation.dto';

// Delegation has no permission leaf (like Workflows) — its authorization is a
// simple participation model: the delegator (creator) and the owner are the
// participants. Admins see everything in the org. Everyone else is walled out.
// The `delegation` entitlement ceiling is enforced upstream by OrgScopeGuard.

type DelegationView = 'mine' | 'incoming' | 'all';

@Injectable()
export class DelegationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  // ─── List ─────────────────────────────────────────────────────────────────

  async list(orgId: string, principal: Principal, view: DelegationView = 'all') {
    const me = principal.userId;
    // Base visibility: a non-admin only ever sees delegations they're on. An admin
    // may see all in the org (still filtered by the requested view).
    let where: any = { organization_id: orgId };
    if (view === 'mine') {
      where.created_by_user_id = me;
    } else if (view === 'incoming') {
      where.owner_user_id = me;
    } else {
      // "all" — admins see the whole org; members fall back to their own two sides.
      if (!principal.isAdmin && !principal.isSuperAdmin) {
        where.OR = [{ created_by_user_id: me }, { owner_user_id: me }];
      }
    }

    const rows = await this.prisma.delegation.findMany({
      where,
      include: { criteria: { orderBy: { order_index: 'asc' } } },
      orderBy: { created_at: 'desc' },
    });
    return this.enrichMany(orgId, rows);
  }

  // ─── Detail ───────────────────────────────────────────────────────────────

  async getOne(orgId: string, id: string, principal: Principal) {
    const row = await this.loadParticipant(orgId, id, principal, 'view');
    const [enriched] = await this.enrichMany(orgId, [row]);
    return enriched;
  }

  // ─── Create ─────────────────────────────────────────────────────────────────

  async create(orgId: string, principal: Principal, dto: CreateDelegationDto) {
    // Who may delegate is a controlled right (Access Rights → Delegations → Create).
    // Admins hold it implicitly; everyone else needs it granted on their role.
    const canDelegate = await this.permissions.hasEffective(
      orgId,
      principal,
      DELEGATION_LEAF,
      PermissionAction.write,
    );
    if (!canDelegate) {
      throw new ForbiddenException('You do not have permission to create delegations.');
    }
    // Owner may be anyone in the company, but must be an active member of this org
    // (never a pasted foreign id).
    await assertActiveOrgMembers(this.prisma, orgId, [dto.owner_user_id], 'delegation owner');

    const created = await this.prisma.delegation.create({
      data: {
        organization_id: orgId,
        title: dto.title.trim(),
        outcome: dto.outcome.trim(),
        owner_user_id: dto.owner_user_id,
        created_by_user_id: principal.userId,
        kra: dto.kra?.trim() || null,
        running_by: dto.running_by ? new Date(dto.running_by) : null,
        first_check_in: dto.first_check_in ? new Date(dto.first_check_in) : null,
        criteria: {
          create: this.normaliseCriteria(orgId, dto.criteria),
        },
      },
      include: { criteria: { orderBy: { order_index: 'asc' } } },
    });

    // Spawn the delegator's review task (best-effort — a delegation must still
    // succeed even if task-status config is missing for the org).
    const reviewTaskId = await this.createReviewTask(orgId, principal.userId, created).catch(
      () => null,
    );
    if (reviewTaskId) {
      await this.prisma.delegation.update({
        where: { id: created.id },
        data: { review_task_id: reviewTaskId },
      });
      (created as any).review_task_id = reviewTaskId;
    }

    const [enriched] = await this.enrichMany(orgId, [created]);
    return enriched;
  }

  // ─── Update (delegator/admin) ────────────────────────────────────────────────

  async update(orgId: string, id: string, principal: Principal, dto: UpdateDelegationDto) {
    const row = await this.loadParticipant(orgId, id, principal, 'manage');
    if (row.status !== 'active') {
      throw new BadRequestException('Only an active delegation can be edited.');
    }
    if (dto.owner_user_id && dto.owner_user_id !== row.owner_user_id) {
      await assertActiveOrgMembers(this.prisma, orgId, [dto.owner_user_id], 'delegation owner');
    }

    await this.prisma.delegation.update({
      where: { id, organization_id: orgId },
      data: {
        title: dto.title?.trim(),
        outcome: dto.outcome?.trim(),
        owner_user_id: dto.owner_user_id,
        kra: dto.kra !== undefined ? dto.kra.trim() || null : undefined,
        running_by: dto.running_by !== undefined ? (dto.running_by ? new Date(dto.running_by) : null) : undefined,
        first_check_in: dto.first_check_in !== undefined ? (dto.first_check_in ? new Date(dto.first_check_in) : null) : undefined,
      },
    });

    // Criteria are replaced as a whole set when provided.
    if (dto.criteria) {
      await this.prisma.delegationCriterion.deleteMany({ where: { delegation_id: id, organization_id: orgId } });
      const data = this.normaliseCriteria(orgId, dto.criteria).map((c) => ({ ...c, delegation_id: id }));
      if (data.length > 0) await this.prisma.delegationCriterion.createMany({ data });
    }

    return this.getOne(orgId, id, principal);
  }

  // ─── Lifecycle transitions (delegator/admin) ──────────────────────────────────

  async complete(orgId: string, id: string, principal: Principal) {
    const row = await this.loadParticipant(orgId, id, principal, 'manage');
    if (row.status !== 'active') throw new BadRequestException('This delegation is not active.');
    await this.prisma.delegation.update({
      where: { id, organization_id: orgId },
      data: { status: 'completed', completed_at: new Date() },
    });
    return this.getOne(orgId, id, principal);
  }

  async remove(orgId: string, id: string, principal: Principal) {
    // Deletion is destructive and permission-gated: whoever holds the `delete`
    // action on the Delegations leaf (configured on the Access Rights page; admins
    // hold it implicitly) may delete any delegation. AUTHORIZATION.md rule 5 — no
    // participant shortcut for delete.
    const canDelete = await this.permissions.hasEffective(
      orgId,
      principal,
      DELEGATION_LEAF,
      PermissionAction.delete,
    );
    if (!canDelete) {
      throw new ForbiddenException('You do not have permission to delete delegations.');
    }
    const row = await this.prisma.delegation.findFirst({
      where: { id, organization_id: orgId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Delegation not found');
    await this.prisma.delegation.delete({ where: { id, organization_id: orgId } });
    return { success: true };
  }

  // ─── Criterion toggle (delegator, owner, or admin) ────────────────────────────

  async toggleCriterion(
    orgId: string,
    id: string,
    criterionId: string,
    principal: Principal,
    isMet: boolean,
  ) {
    // View-level participation is enough to report progress (owner ticks their own).
    await this.loadParticipant(orgId, id, principal, 'view');
    // Sub-resource MUST be scoped to its parent + org (never a bare where:{id}).
    const criterion = await this.prisma.delegationCriterion.findFirst({
      where: { id: criterionId, delegation_id: id, organization_id: orgId },
    });
    if (!criterion) throw new NotFoundException('Criterion not found');
    await this.prisma.delegationCriterion.update({
      where: { id: criterionId },
      data: { is_met: isMet },
    });
    return this.getOne(orgId, id, principal);
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  /**
   * Load a delegation and enforce object-level authorization.
   *  - `view`   → participant (creator OR owner) or admin.
   *  - `manage` → creator (delegator) or admin only. The owner cannot edit/close.
   * Fails closed with NotFound (never leaks the row on a denial).
   */
  private async loadParticipant(
    orgId: string,
    id: string,
    principal: Principal,
    level: 'view' | 'manage',
  ) {
    const row = await this.prisma.delegation.findFirst({
      where: { id, organization_id: orgId },
      include: { criteria: { orderBy: { order_index: 'asc' } } },
    });
    if (!row) throw new NotFoundException('Delegation not found');

    const isAdmin = principal.isAdmin || principal.isSuperAdmin;
    const isCreator = row.created_by_user_id === principal.userId;
    const isOwner = row.owner_user_id === principal.userId;

    if (level === 'manage') {
      if (!isAdmin && !isCreator) {
        throw new ForbiddenException('Only the delegator can manage this delegation.');
      }
    } else {
      if (!isAdmin && !isCreator && !isOwner) {
        throw new NotFoundException('Delegation not found');
      }
    }
    return row;
  }

  private normaliseCriteria(orgId: string, criteria: CriterionInput[] | undefined) {
    return (criteria ?? [])
      .map((c) => ({ description: c.description?.trim() ?? '', target: c.target?.trim() || null }))
      .filter((c) => c.description.length > 0)
      .map((c, i) => ({
        organization_id: orgId,
        description: c.description,
        target: c.target,
        order_index: i,
      }));
  }

  /**
   * Create the delegator's review task directly (a system-generated task, so it is
   * not gated by the creator's task-creation permission). Assigned to the delegator,
   * due on the first check-in date. Returns the new task id, or throws if the org has
   * no task statuses configured (the caller swallows that into a best-effort null).
   */
  private async createReviewTask(
    orgId: string,
    delegatorId: string,
    delegation: { id: string; title: string; outcome: string; owner_user_id: string; first_check_in: Date | null },
  ): Promise<string> {
    const statusId = await this.getDefaultTaskStatusId(orgId);

    const ownerName = await this.displayName(delegation.owner_user_id);
    const task = await this.prisma.task.create({
      data: {
        organization_id: orgId,
        created_by_user_id: delegatorId,
        title: `Review delegation: ${delegation.title}`,
        description:
          `Check in on the delegation "${delegation.title}" owned by ${ownerName}.\n\n` +
          `Outcome: ${delegation.outcome}`,
        status_id: statusId,
        type: 'one_time',
        completion_mode: 'any_can_complete',
        deadline: delegation.first_check_in ?? undefined,
      },
    });

    await this.prisma.taskAssignee.create({
      data: { organization_id: orgId, task_id: task.id, user_id: delegatorId, is_cc: false },
    });
    return task.id;
  }

  private async getDefaultTaskStatusId(orgId: string): Promise<string> {
    const notStarted = await this.prisma.taskStatus.findFirst({
      where: { organization_id: orgId, type: 'not_started', is_active: true },
      orderBy: { order_index: 'asc' },
    });
    if (notStarted) return notStarted.id;
    const flagged = await this.prisma.taskStatus.findFirst({
      where: { organization_id: orgId, is_default: true, is_active: true },
      orderBy: { order_index: 'asc' },
    });
    if (flagged) return flagged.id;
    const fallback = await this.prisma.taskStatus.findFirst({
      where: { organization_id: orgId, is_active: true },
      orderBy: { order_index: 'asc' },
    });
    if (!fallback) throw new BadRequestException('No task statuses configured for this organization');
    return fallback.id;
  }

  private async displayName(userId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
    return u?.name || u?.email || 'someone';
  }

  /** Attach owner/creator display info so the UI never has to resolve ids itself. */
  private async enrichMany<T extends { owner_user_id: string; created_by_user_id: string }>(
    orgId: string,
    rows: T[],
  ) {
    const ids = Array.from(new Set(rows.flatMap((r) => [r.owner_user_id, r.created_by_user_id])));
    const users = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({
      ...r,
      owner: byId.get(r.owner_user_id) ?? null,
      created_by: byId.get(r.created_by_user_id) ?? null,
    }));
  }
}
