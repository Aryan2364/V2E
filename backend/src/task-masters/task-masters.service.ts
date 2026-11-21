import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isSingletonPhase } from '../tasks/status-phase';
import { UpdateConfigDto } from './dto/update-config.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreatePriorityDto } from './dto/create-priority.dto';
import { CreateStatusDto } from './dto/create-status.dto';
import { CreateChecklistTemplateDto } from './dto/create-checklist-template.dto';
import { seedTaskMasters } from './seed-task-masters';

@Injectable()
export class TaskMastersService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Config ─────────────────────────────────────────────────────────────────

  async getOrCreateConfig(orgId: string) {
    // Seeds the TaskMaster config row plus default priorities/statuses if absent.
    // Shared with org provisioning so brand-new firms get masters up-front.
    await seedTaskMasters(this.prisma, orgId);
    return this.prisma.taskMaster.findUniqueOrThrow({ where: { organization_id: orgId } });
  }

  async updateConfig(orgId: string, dto: UpdateConfigDto) {
    await this.getOrCreateConfig(orgId);
    return this.prisma.taskMaster.update({
      where: { organization_id: orgId },
      data: {
        ...(dto.task_creation_roles !== undefined && { task_creation_roles: dto.task_creation_roles }),
        ...(dto.task_edit_roles !== undefined && { task_edit_roles: dto.task_edit_roles }),
        ...(dto.task_delete_roles !== undefined && { task_delete_roles: dto.task_delete_roles }),
        ...(dto.default_reminder_days_before !== undefined && { default_reminder_days_before: dto.default_reminder_days_before }),
        ...(dto.default_reminder_frequency !== undefined && { default_reminder_frequency: dto.default_reminder_frequency }),
        ...(dto.reopen_window_minutes !== undefined && { reopen_window_minutes: dto.reopen_window_minutes }),
        ...(dto.escalation_levels !== undefined && { escalation_levels: dto.escalation_levels }),
        ...(dto.archive_view_roles !== undefined && { archive_view_roles: dto.archive_view_roles }),
      },
    });
  }

  // Authorization is enforced at the route layer via
  // @RequirePermission('tasks.config.assignee_visibility.manage', edit). The _userId
  // param is retained for call-site compatibility.
  async updateAssigneeVisibility(orgId: string, _userId: string, dto: {
    assignee_visibility_mode?: string;
    assignee_custom_rules?: Record<string, unknown>;
    assignee_visibility_config_roles?: string[];
  }) {
    await this.getOrCreateConfig(orgId);
    return this.prisma.taskMaster.update({
      where: { organization_id: orgId },
      data: {
        ...(dto.assignee_visibility_mode !== undefined && { assignee_visibility_mode: dto.assignee_visibility_mode }),
        ...(dto.assignee_custom_rules !== undefined && { assignee_custom_rules: dto.assignee_custom_rules as never }),
        ...(dto.assignee_visibility_config_roles !== undefined && { assignee_visibility_config_roles: dto.assignee_visibility_config_roles }),
      },
    });
  }

  // ─── Categories ─────────────────────────────────────────────────────────────

  async listCategories(orgId: string, userId: string) {
    const member = await this.prisma.organizationMember.findUnique({
      where: { organization_id_user_id: { organization_id: orgId, user_id: userId } },
    });

    const allCategories = await this.prisma.taskCategory.findMany({
      where: { organization_id: orgId, is_active: true },
      orderBy: { created_at: 'asc' },
    });

    if (!member) return allCategories;

    // Look up department via EmployeeProfile (which has department_id)
    const employeeProfile = await this.prisma.employeeProfile.findFirst({
      where: { user_id: userId, organization_id: orgId },
      select: { department_id: true },
    });

    return allCategories.filter((cat) => {
      const depts = cat.visible_to_departments as string[];
      const roles = cat.visible_to_roles as string[];
      const deptRestricted = Array.isArray(depts) && depts.length > 0;
      const roleRestricted = Array.isArray(roles) && roles.length > 0;
      if (!deptRestricted && !roleRestricted) return true;
      if (deptRestricted && employeeProfile?.department_id && depts.includes(employeeProfile.department_id)) return true;
      if (roleRestricted && (roles.includes('employee') || member.is_admin)) return true;
      return false;
    });
  }

  async createCategory(orgId: string, userId: string, dto: CreateCategoryDto) {
    return this.prisma.taskCategory.create({
      data: {
        organization_id: orgId,
        created_by_user_id: userId,
        name: dto.name,
        description: dto.description,
        color: dto.color ?? '#2563EB',
        visible_to_departments: dto.visible_to_departments ?? [],
        visible_to_roles: dto.visible_to_roles ?? [],
        is_active: dto.is_active ?? true,
      },
    });
  }

  async updateCategory(orgId: string, categoryId: string, dto: Partial<CreateCategoryDto>) {
    await this.findCategoryOrFail(orgId, categoryId);
    return this.prisma.taskCategory.update({
      where: { id: categoryId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.color !== undefined && { color: dto.color }),
        ...(dto.visible_to_departments !== undefined && { visible_to_departments: dto.visible_to_departments }),
        ...(dto.visible_to_roles !== undefined && { visible_to_roles: dto.visible_to_roles }),
        ...(dto.is_active !== undefined && { is_active: dto.is_active }),
      },
    });
  }

  async deactivateCategory(orgId: string, categoryId: string) {
    await this.findCategoryOrFail(orgId, categoryId);
    return this.prisma.taskCategory.update({
      where: { id: categoryId },
      data: { is_active: false },
    });
  }

  private async findCategoryOrFail(orgId: string, categoryId: string) {
    const cat = await this.prisma.taskCategory.findFirst({ where: { id: categoryId, organization_id: orgId } });
    if (!cat) throw new NotFoundException('Category not found');
    return cat;
  }

  // ─── Priorities ─────────────────────────────────────────────────────────────

  async listPriorities(orgId: string) {
    return this.prisma.taskPriority.findMany({
      where: { organization_id: orgId, is_active: true },
      orderBy: { order_index: 'asc' },
    });
  }

  async createPriority(orgId: string, dto: CreatePriorityDto) {
    return this.prisma.taskPriority.create({
      data: {
        organization_id: orgId,
        label: dto.label,
        color: dto.color ?? '#2563EB',
        order_index: dto.order_index ?? 0,
        is_active: dto.is_active ?? true,
      },
    });
  }

  async updatePriority(orgId: string, priorityId: string, dto: Partial<CreatePriorityDto>) {
    await this.findPriorityOrFail(orgId, priorityId);
    return this.prisma.taskPriority.update({
      where: { id: priorityId },
      data: {
        ...(dto.label !== undefined && { label: dto.label }),
        ...(dto.color !== undefined && { color: dto.color }),
        ...(dto.order_index !== undefined && { order_index: dto.order_index }),
        ...(dto.is_active !== undefined && { is_active: dto.is_active }),
      },
    });
  }

  async deactivatePriority(orgId: string, priorityId: string) {
    await this.findPriorityOrFail(orgId, priorityId);
    return this.prisma.taskPriority.update({
      where: { id: priorityId },
      data: { is_active: false },
    });
  }

  async reorderPriorities(orgId: string, items: { id: string; order_index: number }[]) {
    await Promise.all(
      items.map((item) =>
        this.prisma.taskPriority.updateMany({
          where: { id: item.id, organization_id: orgId },
          data: { order_index: item.order_index },
        }),
      ),
    );
    return this.listPriorities(orgId);
  }

  private async findPriorityOrFail(orgId: string, priorityId: string) {
    const p = await this.prisma.taskPriority.findFirst({ where: { id: priorityId, organization_id: orgId } });
    if (!p) throw new NotFoundException('Priority not found');
    return p;
  }

  // ─── Statuses ────────────────────────────────────────────────────────────────

  async listStatuses(orgId: string) {
    return this.prisma.taskStatus.findMany({
      where: { organization_id: orgId, is_active: true },
      orderBy: { order_index: 'asc' },
    });
  }

  async createStatus(orgId: string, dto: CreateStatusDto) {
    // Singleton phases (not_started / completed / incomplete) may exist only once per org.
    // Only `in_progress` may have multiple statuses ("stages"). New statuses created from the
    // config screen are always `in_progress`; the singletons come from the seed.
    if (isSingletonPhase(dto.type)) {
      const existing = await this.prisma.taskStatus.findFirst({
        where: { organization_id: orgId, type: dto.type, is_active: true },
      });
      if (existing) {
        throw new BadRequestException(
          `A "${dto.type}" status already exists. Only "In Progress" stages can have more than one.`,
        );
      }
    }
    return this.prisma.taskStatus.create({
      data: {
        organization_id: orgId,
        label: dto.label,
        type: dto.type,
        color: dto.color ?? '#2563EB',
        order_index: dto.order_index ?? 0,
        // The default is implicit: it is always the single `not_started` status. The client
        // never chooses it.
        is_default: dto.type === 'not_started',
        is_active: dto.is_active ?? true,
      },
    });
  }

  async updateStatus(orgId: string, statusId: string, dto: Partial<CreateStatusDto>) {
    const status = await this.findStatusOrFail(orgId, statusId);
    // Turning a status OFF through the edit form is a deactivation — it must pass the
    // exact same guards as the delete action. Otherwise an admin could switch off
    // "Completed" and silently break completion company-wide.
    if (dto.is_active === false && status.is_active) {
      await this.assertStatusDeactivatable(orgId, status);
    }
    // A status's phase (`type`) and its default-ness are immutable after creation — editing
    // only touches the presentation (label / colour / order) and active flag. This keeps the
    // phase invariants (one not_started/completed/incomplete, default == not_started) intact.
    return this.prisma.taskStatus.update({
      where: { id: statusId },
      data: {
        ...(dto.label !== undefined && { label: dto.label }),
        ...(dto.color !== undefined && { color: dto.color }),
        ...(dto.order_index !== undefined && { order_index: dto.order_index }),
        ...(dto.is_active !== undefined && { is_active: dto.is_active }),
      },
    });
  }

  /**
   * The single source of truth for whether a status may be switched off:
   *  - the singleton phases (Not Started / Completed / Partially Completed / Incomplete)
   *    are structural and can never be removed;
   *  - at least one active "In Progress" stage must remain;
   *  - no live task may currently sit in the status — its cards would silently vanish
   *    from the Kanban board (columns are built from active statuses only).
   */
  private async assertStatusDeactivatable(orgId: string, status: { id: string; type: string; label: string }) {
    if (isSingletonPhase(status.type)) {
      throw new BadRequestException(
        'Not Started, Completed, Partially Completed and Incomplete are required statuses and cannot be removed.',
      );
    }
    if (status.type === 'in_progress') {
      const activeInProgress = await this.prisma.taskStatus.count({
        where: { organization_id: orgId, type: 'in_progress', is_active: true },
      });
      if (activeInProgress <= 1) {
        throw new BadRequestException('At least one "In Progress" stage is required.');
      }
    }
    const liveTasks = await this.prisma.task.count({
      where: { organization_id: orgId, status_id: status.id, is_deleted: false },
    });
    if (liveTasks > 0) {
      throw new BadRequestException(
        `${liveTasks} task${liveTasks > 1 ? 's are' : ' is'} currently in "${status.label}". Move them to another status first — otherwise they would disappear from the board.`,
      );
    }
  }

  async getDefaultStatus(orgId: string) {
    // The single `not_started` status is the canonical birth state; fall back to the
    // is_default flag, then the first active status.
    const notStarted = await this.prisma.taskStatus.findFirst({
      where: { organization_id: orgId, type: 'not_started', is_active: true },
      orderBy: { order_index: 'asc' },
    });
    if (notStarted) return notStarted;
    const flagged = await this.prisma.taskStatus.findFirst({
      where: { organization_id: orgId, is_default: true, is_active: true },
      orderBy: { order_index: 'asc' },
    });
    if (flagged) return flagged;
    return this.prisma.taskStatus.findFirst({
      where: { organization_id: orgId, is_active: true },
      orderBy: { order_index: 'asc' },
    });
  }

  async deactivateStatus(orgId: string, statusId: string) {
    const status = await this.findStatusOrFail(orgId, statusId);
    await this.assertStatusDeactivatable(orgId, status);
    return this.prisma.taskStatus.update({
      where: { id: statusId },
      data: { is_active: false },
    });
  }

  async reorderStatuses(orgId: string, items: { id: string; order_index: number }[]) {
    await Promise.all(
      items.map((item) =>
        this.prisma.taskStatus.updateMany({
          where: { id: item.id, organization_id: orgId },
          data: { order_index: item.order_index },
        }),
      ),
    );
    return this.listStatuses(orgId);
  }

  private async findStatusOrFail(orgId: string, statusId: string) {
    const s = await this.prisma.taskStatus.findFirst({ where: { id: statusId, organization_id: orgId } });
    if (!s) throw new NotFoundException('Status not found');
    return s;
  }

  // ─── Checklist Templates ─────────────────────────────────────────────────────

  async listChecklistTemplates(orgId: string) {
    return this.prisma.taskChecklistTemplate.findMany({
      where: { organization_id: orgId },
      orderBy: { created_at: 'asc' },
      include: { access_rules: true },
    });
  }

  /** Build access-rule create rows from a DTO, dropping rules with no target. */
  private buildAccessRuleRows(orgId: string, templateId: string, dto: Partial<CreateChecklistTemplateDto>) {
    return (dto.access_rules ?? [])
      .filter((r) =>
        (r.kind === 'department' && r.department_id) ||
        ((r.kind === 'role' || r.kind === 'exclude_role') && r.role_id) ||
        ((r.kind === 'user' || r.kind === 'exclude_user') && r.user_id),
      )
      .map((r) => ({
        organization_id: orgId,
        template_id: templateId,
        kind: r.kind,
        department_id: r.kind === 'department' ? r.department_id ?? null : null,
        include_sub_departments: r.kind === 'department' ? r.include_sub_departments ?? true : true,
        role_id: r.kind === 'role' || r.kind === 'exclude_role' ? r.role_id ?? null : null,
        user_id: r.kind === 'user' || r.kind === 'exclude_user' ? r.user_id ?? null : null,
      }));
  }

  async createChecklistTemplate(orgId: string, userId: string, dto: CreateChecklistTemplateDto) {
    const mode = dto.access_mode ?? 'everyone';
    return this.prisma.$transaction(async (tx) => {
      const template = await tx.taskChecklistTemplate.create({
        data: {
          organization_id: orgId,
          created_by_user_id: userId,
          name: dto.name,
          items: (dto.items ?? []) as any,
          access_mode: mode,
          is_active: dto.is_active ?? true,
        },
      });
      if (mode === 'restricted') {
        const rows = this.buildAccessRuleRows(orgId, template.id, dto);
        if (rows.length > 0) await tx.checklistTemplateAccessRule.createMany({ data: rows });
      }
      return tx.taskChecklistTemplate.findUnique({
        where: { id: template.id },
        include: { access_rules: true },
      });
    });
  }

  async updateChecklistTemplate(orgId: string, templateId: string, dto: Partial<CreateChecklistTemplateDto>) {
    await this.findTemplateOrFail(orgId, templateId);
    return this.prisma.$transaction(async (tx) => {
      await tx.taskChecklistTemplate.update({
        where: { id: templateId },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.items !== undefined && { items: dto.items as any }),
          ...(dto.access_mode !== undefined && { access_mode: dto.access_mode }),
          ...(dto.is_active !== undefined && { is_active: dto.is_active }),
        },
      });
      // Replace-all access rules whenever access_mode or access_rules are supplied.
      if (dto.access_mode !== undefined || dto.access_rules !== undefined) {
        await tx.checklistTemplateAccessRule.deleteMany({ where: { template_id: templateId } });
        const restricted = (dto.access_mode ?? 'restricted') === 'restricted';
        if (restricted) {
          const rows = this.buildAccessRuleRows(orgId, templateId, dto);
          if (rows.length > 0) await tx.checklistTemplateAccessRule.createMany({ data: rows });
        }
      }
      return tx.taskChecklistTemplate.findUnique({
        where: { id: templateId },
        include: { access_rules: true },
      });
    });
  }

  async deleteChecklistTemplate(orgId: string, templateId: string) {
    await this.findTemplateOrFail(orgId, templateId);
    return this.prisma.taskChecklistTemplate.delete({ where: { id: templateId } });
  }

  private async findTemplateOrFail(orgId: string, templateId: string) {
    const t = await this.prisma.taskChecklistTemplate.findFirst({ where: { id: templateId, organization_id: orgId } });
    if (!t) throw new NotFoundException('Checklist template not found');
    return t;
  }
}
