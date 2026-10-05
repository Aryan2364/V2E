import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { TriggerRegistryService } from './trigger-registry/trigger-registry.service'
import { CreateTemplateDto } from './dto/create-template.dto'
import { UpdateTemplateDto } from './dto/update-template.dto'
import { CreateStepDto } from './dto/create-step.dto'
import { UpdateStepDto } from './dto/update-step.dto'
import { CreateTriggerDto } from './dto/create-trigger.dto'
import { flattenTags, TASK_TAG_REF_SELECT } from '../common/task-masters-usable'

@Injectable()
export class WorkflowTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly triggerRegistry: TriggerRegistryService,
  ) {}

  // ── Masters ──────────────────────────────────────────────────────────────────

  async getMaster(orgId: string) {
    let master = await this.prisma.workflowMaster.findUnique({ where: { organization_id: orgId } })
    if (!master) {
      master = await this.prisma.workflowMaster.create({ data: { organization_id: orgId } })
    }
    return master
  }

  async updateMaster(orgId: string, dto: Partial<{ workflow_creation_roles: string[]; default_overdue_action: string }>) {
    await this.getMaster(orgId)
    return this.prisma.workflowMaster.update({ where: { organization_id: orgId }, data: dto as never })
  }

  // ── Templates ────────────────────────────────────────────────────────────────

  async listTemplates(orgId: string, userId: string) {
    return this.prisma.workflowTemplate.findMany({
      where: {
        organization_id: orgId,
        status: { not: 'archived' },
        OR: [
          // creator
          { created_by_user_id: userId },
          // owner
          { owner_user_ids: { array_contains: userId } },
          // granted access
          { access: { some: { user_id: userId } } },
          // active templates visible to all org members
          { status: 'active' },
        ],
      },
      include: {
        steps: { orderBy: { order_index: 'asc' } },
        triggers: true,
        _count: { select: { instances: true } },
      },
      orderBy: { created_at: 'desc' },
    })
  }

  async getTemplate(orgId: string, id: string) {
    const t = await this.prisma.workflowTemplate.findFirst({
      where: { id, organization_id: orgId },
      include: {
        steps: { orderBy: { order_index: 'asc' } },
        triggers: true,
        access: true,
        _count: { select: { instances: { where: { status: 'running' } } } },
      },
    })
    if (!t) throw new NotFoundException('Workflow template not found')
    return t
  }

  async createTemplate(orgId: string, userId: string, dto: CreateTemplateDto) {
    return this.prisma.workflowTemplate.create({
      data: {
        organization_id: orgId,
        name: dto.name,
        description: dto.description,
        owner_user_ids: [userId] as never,
        created_by_user_id: userId,
        workflow_nature: dto.workflow_nature as never ?? 'one_time',
        recurring_type: dto.recurring_type as never ?? null,
        show_workflow_on_task_card: dto.show_workflow_on_task_card ?? true,
      },
    })
  }

  async updateTemplate(orgId: string, id: string, userId: string, dto: UpdateTemplateDto) {
    await this.assertEditable(orgId, id, userId)
    return this.prisma.workflowTemplate.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        owner_user_ids: dto.owner_user_ids as never ?? undefined,
        workflow_nature: dto.workflow_nature as never ?? undefined,
        recurring_type: dto.recurring_type as never ?? undefined,
        show_workflow_on_task_card: dto.show_workflow_on_task_card,
      },
    })
  }

  async publishTemplate(orgId: string, id: string, userId: string) {
    const t = await this.getTemplate(orgId, id)
    await this.assertEditable(orgId, id, userId)
    if (t.steps.length === 0) throw new BadRequestException('Workflow must have at least one step')
    if (t.triggers.length === 0) throw new BadRequestException('Workflow must have at least one trigger')
    return this.prisma.workflowTemplate.update({ where: { id }, data: { status: 'active' } })
  }

  async archiveTemplate(orgId: string, id: string, userId: string) {
    await this.assertEditable(orgId, id, userId)
    return this.prisma.workflowTemplate.update({ where: { id }, data: { status: 'archived' } })
  }

  // ── Steps ────────────────────────────────────────────────────────────────────

  async addStep(orgId: string, templateId: string, userId: string, dto: CreateStepDto) {
    await this.assertEditable(orgId, templateId, userId)
    const existing = await this.prisma.workflowStep.findMany({ where: { workflow_template_id: templateId }, orderBy: { order_index: 'asc' } })
    const order = dto.order_index ?? existing.length
    return this.prisma.workflowStep.create({
      data: {
        organization_id: orgId,
        workflow_template_id: templateId,
        order_index: order,
        title: dto.title,
        description: dto.description ?? null,
        assignee_type: dto.assignee_type as never ?? 'fixed_person',
        assignee_user_id: dto.assignee_user_id ?? null,
        assignee_role: dto.assignee_role ?? null,
        assigner_user_id: dto.assigner_user_id,
        deadline_config: dto.deadline_config as never,
        proof_required: dto.proof_required ?? false,
        priority_id: dto.priority_id ?? null,
        category_id: dto.category_id ?? null,
        checklist_items: dto.checklist_items as never ?? [],
        if_overdue_action: dto.if_overdue_action as never ?? 'block_next',
        branch_step_id: dto.branch_step_id ?? null,
      },
    })
  }

  async updateStep(orgId: string, templateId: string, stepId: string, userId: string, dto: UpdateStepDto) {
    await this.assertEditable(orgId, templateId, userId)
    await this.prisma.workflowStep.findFirstOrThrow({ where: { id: stepId, workflow_template_id: templateId } })
    return this.prisma.workflowStep.update({
      where: { id: stepId },
      data: {
        title: dto.title,
        description: dto.description,
        assignee_type: dto.assignee_type as never,
        assignee_user_id: dto.assignee_user_id,
        assignee_role: dto.assignee_role,
        assigner_user_id: dto.assigner_user_id,
        deadline_config: dto.deadline_config as never,
        proof_required: dto.proof_required,
        priority_id: dto.priority_id,
        category_id: dto.category_id,
        checklist_items: dto.checklist_items as never,
        if_overdue_action: dto.if_overdue_action as never,
        branch_step_id: dto.branch_step_id,
        order_index: dto.order_index,
      },
    })
  }

  async deleteStep(orgId: string, templateId: string, stepId: string, userId: string) {
    await this.assertEditable(orgId, templateId, userId)
    await this.prisma.workflowStep.findFirstOrThrow({ where: { id: stepId, workflow_template_id: templateId } })
    await this.prisma.workflowStep.delete({ where: { id: stepId } })
    // Reorder remaining
    const remaining = await this.prisma.workflowStep.findMany({ where: { workflow_template_id: templateId }, orderBy: { order_index: 'asc' } })
    for (let i = 0; i < remaining.length; i++) {
      await this.prisma.workflowStep.update({ where: { id: remaining[i].id }, data: { order_index: i } })
    }
  }

  async reorderSteps(orgId: string, templateId: string, userId: string, items: { id: string; order_index: number }[]) {
    await this.assertEditable(orgId, templateId, userId)
    for (const item of items) {
      await this.prisma.workflowStep.updateMany({
        where: { id: item.id, workflow_template_id: templateId },
        data: { order_index: item.order_index },
      })
    }
    return this.prisma.workflowStep.findMany({ where: { workflow_template_id: templateId }, orderBy: { order_index: 'asc' } })
  }

  async swapSteps(orgId: string, templateId: string, userId: string, stepId1: string, stepId2: string) {
    await this.assertEditable(orgId, templateId, userId)
    const [s1, s2] = await Promise.all([
      this.prisma.workflowStep.findFirstOrThrow({ where: { id: stepId1, workflow_template_id: templateId } }),
      this.prisma.workflowStep.findFirstOrThrow({ where: { id: stepId2, workflow_template_id: templateId } }),
    ])
    await this.prisma.workflowStep.update({ where: { id: stepId1 }, data: { order_index: s2.order_index } })
    await this.prisma.workflowStep.update({ where: { id: stepId2 }, data: { order_index: s1.order_index } })
    return this.prisma.workflowStep.findMany({ where: { workflow_template_id: templateId }, orderBy: { order_index: 'asc' } })
  }

  // ── Triggers ─────────────────────────────────────────────────────────────────

  async listTriggers(orgId: string, templateId: string) {
    return this.prisma.workflowTrigger.findMany({ where: { workflow_template_id: templateId, organization_id: orgId } })
  }

  async addTrigger(orgId: string, templateId: string, userId: string, dto: CreateTriggerDto) {
    await this.assertEditable(orgId, templateId, userId)
    if (!this.triggerRegistry.isValid(dto.type)) {
      throw new BadRequestException(`Unknown trigger type: ${dto.type}. Valid: ${this.triggerRegistry.listTypes().join(', ')}`)
    }
    return this.prisma.workflowTrigger.create({
      data: {
        organization_id: orgId,
        workflow_template_id: templateId,
        type: dto.type,
        config: dto.config as never,
        is_active: dto.is_active ?? true,
      },
    })
  }

  async updateTrigger(orgId: string, templateId: string, triggerId: string, userId: string, dto: Partial<CreateTriggerDto>) {
    await this.assertEditable(orgId, templateId, userId)
    await this.prisma.workflowTrigger.findFirstOrThrow({ where: { id: triggerId, workflow_template_id: templateId } })
    return this.prisma.workflowTrigger.update({ where: { id: triggerId }, data: dto as never })
  }

  async deleteTrigger(orgId: string, templateId: string, triggerId: string, userId: string) {
    await this.assertEditable(orgId, templateId, userId)
    await this.prisma.workflowTrigger.findFirstOrThrow({ where: { id: triggerId, workflow_template_id: templateId } })
    await this.prisma.workflowTrigger.delete({ where: { id: triggerId } })
  }

  // ── Access ───────────────────────────────────────────────────────────────────

  async listAccess(orgId: string, templateId: string) {
    return this.prisma.workflowAccess.findMany({ where: { workflow_template_id: templateId, organization_id: orgId } })
  }

  async grantAccess(orgId: string, templateId: string, userId: string, dto: { user_id: string; access_type: string }) {
    await this.assertEditable(orgId, templateId, userId)
    return this.prisma.workflowAccess.upsert({
      where: { workflow_template_id_user_id_access_type: { workflow_template_id: templateId, user_id: dto.user_id, access_type: dto.access_type as never } },
      update: {},
      create: { organization_id: orgId, workflow_template_id: templateId, user_id: dto.user_id, access_type: dto.access_type as never },
    })
  }

  async revokeAccess(orgId: string, templateId: string, userId: string, targetUserId: string) {
    await this.assertEditable(orgId, templateId, userId)
    await this.prisma.workflowAccess.deleteMany({ where: { workflow_template_id: templateId, user_id: targetUserId } })
  }

  // ── My workflows ─────────────────────────────────────────────────────────────

  async getOwnedWorkflows(orgId: string, userId: string) {
    return this.prisma.workflowTemplate.findMany({
      where: { organization_id: orgId, owner_user_ids: { array_contains: userId } },
      include: { _count: { select: { instances: true } }, steps: { orderBy: { order_index: 'asc' } } },
      orderBy: { created_at: 'desc' },
    })
  }

  async getOwnedInstances(orgId: string, userId: string) {
    const owned = await this.prisma.workflowTemplate.findMany({
      where: { organization_id: orgId, owner_user_ids: { array_contains: userId } },
      select: { id: true },
    })
    const templateIds = owned.map((t) => t.id)
    return this.prisma.workflowInstance.findMany({
      where: { workflow_template_id: { in: templateIds }, status: 'running' },
      include: { template: { select: { name: true } }, steps: { orderBy: { created_at: 'asc' } } },
      orderBy: { started_at: 'desc' },
    })
  }

  // ── Instances ────────────────────────────────────────────────────────────────

  async listInstances(orgId: string, templateId: string) {
    return this.prisma.workflowInstance.findMany({
      where: { workflow_template_id: templateId, organization_id: orgId },
      include: { steps: { orderBy: { created_at: 'asc' } } },
      orderBy: { started_at: 'desc' },
    })
  }

  async getInstance(orgId: string, templateId: string, instanceId: string) {
    const inst = await this.prisma.workflowInstance.findFirst({
      where: { id: instanceId, workflow_template_id: templateId, organization_id: orgId },
      include: {
        template: { include: { steps: { orderBy: { order_index: 'asc' } } } },
        steps: { orderBy: { created_at: 'asc' } },
      },
    })
    if (!inst) throw new NotFoundException('Instance not found')
    return inst
  }

  async getInstanceTasks(orgId: string, instanceId: string) {
    const steps = await this.prisma.workflowInstanceStep.findMany({
      where: { workflow_instance_id: instanceId, organization_id: orgId, task_id: { not: null } },
      select: { task_id: true },
    })
    const taskIds = steps.map((s) => s.task_id!)
    const tasks = await this.prisma.task.findMany({
      where: { id: { in: taskIds }, organization_id: orgId },
      include: { status: true, priority: true, category: true, assignees: true, ...TASK_TAG_REF_SELECT },
    })
    // Flat `tags: TaskTagRef[]` — the join row never leaves the API (TASK_TAGS_PLAN.md §10.1).
    return tasks.map((t) => flattenTags(t))
  }

  async cancelInstance(orgId: string, templateId: string, userId: string, instanceId: string) {
    await this.assertEditable(orgId, templateId, userId)
    const instance = await this.prisma.workflowInstance.findFirst({
      where: { id: instanceId, workflow_template_id: templateId, organization_id: orgId },
      select: { id: true },
    })
    if (!instance) throw new NotFoundException('Workflow instance not found')
    return this.prisma.workflowInstance.update({
      where: { id: instanceId },
      data: { status: 'cancelled' },
    })
  }

  /**
   * Manual-trigger gate: only the creator, an owner, or a user with an explicit
   * access grant may spawn an instance — and the template must belong to the
   * caller's org (fail closed; the engine itself is org-blind for cron use).
   */
  async assertCanTrigger(orgId: string, templateId: string, userId: string) {
    const t = await this.prisma.workflowTemplate.findFirst({ where: { id: templateId, organization_id: orgId } })
    if (!t) throw new NotFoundException('Workflow template not found')
    const isOwner = (t.owner_user_ids as string[]).includes(userId)
    const isCreator = t.created_by_user_id === userId
    if (isOwner || isCreator) return
    const access = await this.prisma.workflowAccess.findFirst({ where: { workflow_template_id: templateId, user_id: userId } })
    if (!access) throw new ForbiddenException('No access to trigger this workflow')
  }

  // ── Guard ────────────────────────────────────────────────────────────────────

  private async assertEditable(orgId: string, templateId: string, userId: string) {
    const t = await this.prisma.workflowTemplate.findFirst({ where: { id: templateId, organization_id: orgId } })
    if (!t) throw new NotFoundException('Workflow template not found')
    const isOwner = (t.owner_user_ids as string[]).includes(userId)
    const isCreator = t.created_by_user_id === userId
    if (!isOwner && !isCreator) {
      const access = await this.prisma.workflowAccess.findFirst({ where: { workflow_template_id: templateId, user_id: userId, access_type: 'edit' } })
      if (!access) throw new ForbiddenException('No edit access to this workflow')
    }
  }
}
