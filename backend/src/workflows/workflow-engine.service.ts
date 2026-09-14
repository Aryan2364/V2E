import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import { HolidaysService } from '../holidays/holidays.service'
import { NotificationsService } from '../notifications/notifications.service'
import { AuditWriterService } from '../audit/audit-writer.service'

@Injectable()
export class WorkflowEngineService {
  private readonly logger = new Logger(WorkflowEngineService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly holidaysService: HolidaysService,
    private readonly notifications: NotificationsService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  private async automationEnabled(orgId: string): Promise<boolean> {
    const entitlement = await this.prisma.orgModuleEntitlement.findUnique({
      where: { organization_id_module_key: { organization_id: orgId, module_key: 'workflows' } },
      select: { state: true },
    })
    return entitlement?.state === 'full'
  }

  // ── Instance naming ─────────────────────────────────────────────────────────

  private formatDate(d: Date): string {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    return `${String(d.getDate()).padStart(2,'0')} ${months[d.getMonth()]} ${d.getFullYear()}`
  }

  private async uniqueName(templateId: string, baseName: string): Promise<string> {
    const existing = await this.prisma.workflowInstance.findMany({
      where: { workflow_template_id: templateId, name: { startsWith: baseName } },
      select: { name: true },
    })
    if (existing.length === 0) return baseName
    const nums = existing
      .map((e) => {
        const m = e.name.match(/— #(\d+)$/)
        return m ? parseInt(m[1], 10) : 1
      })
    const next = Math.max(...nums) + 1
    return `${baseName} — #${next}`
  }

  private async buildInstanceName(
    templateName: string,
    templateId: string,
    triggerType: string,
    context: Record<string, unknown>,
  ): Promise<string> {
    const today = this.formatDate(new Date())
    let base: string
    switch (triggerType) {
      case 'date_trigger':
        base = `${templateName} — ${today}`
        break
      case 'manual_trigger':
        return (context.name as string) ?? `${templateName} — ${today}`
      case 'task_completed_trigger':
        base = `${templateName} — ${context.taskTitle ?? 'Task'} — ${today}`
        break
      case 'task_overdue_trigger':
        base = `${templateName} — Escalation — ${today}`
        break
      default:
        base = `${templateName} — ${today}`
    }
    return this.uniqueName(templateId, base)
  }

  // ── Deadline resolution ──────────────────────────────────────────────────────

  private resolveDeadline(
    deadlineConfig: Record<string, unknown>,
    prevCompletedAt?: Date | null,
    prevScheduledAt?: Date | null,
    startAt?: Date,
  ): Date {
    const cfg = deadlineConfig as {
      type: string
      date?: string
      time?: string
      days?: number
      day?: number
      day_of_month?: number
      month?: number
    }
    const timeStr = cfg.time ?? '09:00'
    const [hh, mm] = timeStr.split(':').map(Number)

    const withTime = (d: Date): Date => {
      const r = new Date(d)
      r.setHours(hh, mm, 0, 0)
      return r
    }

    const addDays = (base: Date, n: number): Date => {
      const r = new Date(base)
      r.setDate(r.getDate() + n)
      return withTime(r)
    }

    switch (cfg.type) {
      case 'fixed_date':
        return withTime(new Date(cfg.date!))
      case 'daily':
        return withTime(startAt ?? new Date())
      case 'weekly': {
        const base = startAt ?? new Date()
        const d = new Date(base)
        const diff = ((cfg.day! - d.getDay()) + 7) % 7 || 7
        d.setDate(d.getDate() + diff)
        return withTime(d)
      }
      case 'monthly': {
        const base = startAt ?? new Date()
        const d = new Date(base.getFullYear(), base.getMonth(), cfg.day_of_month!)
        if (d <= base) d.setMonth(d.getMonth() + 1)
        return withTime(d)
      }
      case 'yearly': {
        const base = startAt ?? new Date()
        const d = new Date(base.getFullYear(), (cfg.month ?? 1) - 1, cfg.day!)
        if (d <= base) d.setFullYear(d.getFullYear() + 1)
        return withTime(d)
      }
      case 'x_days_after_start':
        return addDays(startAt ?? new Date(), cfg.days ?? 1)
      case 'x_days_after_prev_completed':
        return addDays(prevCompletedAt ?? new Date(), cfg.days ?? 1)
      case 'x_days_after_prev_deadline':
        return addDays(prevScheduledAt ?? new Date(), cfg.days ?? 1)
      default:
        return addDays(startAt ?? new Date(), 1)
    }
  }

  // ── Assignee resolution ──────────────────────────────────────────────────────

  private async resolveAssignee(
    step: {
      id: string
      organization_id: string
      workflow_template_id: string
      assignee_type: string
      assignee_user_id: string | null
      assignee_role: string | null
      assigner_user_id: string
    },
  ): Promise<string> {
    // The step's assigner always exists and is the natural owner of the work, so
    // it's the safe fallback whenever we can't resolve the intended assignee.
    // This guarantees we never emit '' (which neither assigned_to_user_id nor
    // task_assignees.user_id has a FK to catch — it would create a ghost task
    // assigned to nobody, with notifications routed to a non-existent user).
    const fallback = step.assignee_user_id || step.assigner_user_id

    if (step.assignee_type === 'fixed_person') {
      return step.assignee_user_id || step.assigner_user_id
    }
    // Role-based round-robin. MemberRole was removed; a legacy `assignee_role` of
    // org_admin now targets admins, anything else targets any active member.
    const role = step.assignee_role!
    const members = await this.prisma.organizationMember.findMany({
      where: { organization_id: step.organization_id, is_active: true, ...(role === 'org_admin' ? { is_admin: true } : {}) },
      select: { user_id: true },
    })
    if (members.length === 0) {
      this.logger.warn(
        `Workflow step ${step.id}: role "${role}" has no active members; ` +
          `falling back to assigner ${fallback}.`,
      )
      return fallback
    }

    const tracker = await this.prisma.workflowRoundRobinTracker.findUnique({
      where: {
        workflow_template_id_workflow_step_id_role: {
          workflow_template_id: step.workflow_template_id,
          workflow_step_id: step.id,
          role,
        },
      },
    })

    const userIds = members.map((m) => m.user_id)
    let nextIdx = 0
    if (tracker) {
      const lastIdx = userIds.indexOf(tracker.last_assigned_user_id)
      nextIdx = (lastIdx + 1) % userIds.length
    }
    const assignedUserId = userIds[nextIdx]

    await this.prisma.workflowRoundRobinTracker.upsert({
      where: {
        workflow_template_id_workflow_step_id_role: {
          workflow_template_id: step.workflow_template_id,
          workflow_step_id: step.id,
          role,
        },
      },
      update: { last_assigned_user_id: assignedUserId, assignment_count: { increment: 1 } },
      create: {
        organization_id: step.organization_id,
        workflow_template_id: step.workflow_template_id,
        workflow_step_id: step.id,
        role,
        last_assigned_user_id: assignedUserId,
        assignment_count: 1,
      },
    })

    return assignedUserId
  }

  // ── Create task for a step ───────────────────────────────────────────────────

  private async createTaskForStep(
    instanceStep: { id: string; assigned_to_user_id: string; scheduled_at: Date | null },
    step: {
      organization_id: string
      title: string
      description: string | null
      priority_id: string | null
      category_id: string | null
      proof_required: boolean
      checklist_items: unknown
      assigner_user_id: string
    },
    defaultStatusId: string,
  ): Promise<string> {
    const items = (step.checklist_items as { title: string; order_index: number }[]) ?? []
    const task = await this.prisma.task.create({
      data: {
        organization_id: step.organization_id,
        title: step.title,
        description: step.description ?? undefined,
        // WorkflowStep has no quadrant of its own; use the app-wide default
        // (matches Task.quadrant @default(Q2) and tasks.service).
        quadrant: 'Q2',
        type: 'one_time',
        status_id: defaultStatusId,
        priority_id: step.priority_id ?? undefined,
        category_id: step.category_id ?? undefined,
        proof_required: step.proof_required,
        completion_mode: 'any_can_complete',
        created_by_user_id: step.assigner_user_id,
        deadline: instanceStep.scheduled_at ?? undefined,
        // Frozen compliance baseline — the date this step is born committed to. Kept
        // in step with every other task-creation path so a later deadline revision
        // can't retroactively turn a late task on-time.
        original_deadline: instanceStep.scheduled_at ?? undefined,
        workflow_instance_step_id: instanceStep.id,
        assignees: {
          create: [{ organization_id: step.organization_id, user_id: instanceStep.assigned_to_user_id, is_cc: false }],
        },
        checklist: items.length > 0
          ? { create: items.map((it) => ({ organization_id: step.organization_id, title: it.title, order_index: it.order_index })) }
          : undefined,
      },
    })
    return task.id
  }

  private async getDefaultStatusId(orgId: string): Promise<string> {
    const status = await this.prisma.taskStatus.findFirst({
      where: { organization_id: orgId, is_default: true, is_active: true },
      select: { id: true },
    })
    return status?.id ?? ''
  }

  // ── Notifications ────────────────────────────────────────────────────────────

  // Routes all workflow notifications through the unified notification service.
  // (The legacy workflow_notifications table is no longer written — nothing reads it.)
  private async notify(
    instanceId: string,
    orgId: string,
    userIds: string[],
    type: string,
    message: string,
  ): Promise<void> {
    if (userIds.length === 0) return
    const eventMap: Record<string, { event: string; title: string }> = {
      instance_completed: { event: 'workflow_completed', title: 'Workflow completed' },
      upstream_delay: { event: 'workflow_upstream_delay', title: 'Upstream step delayed' },
      instance_stuck: { event: 'workflow_step_overdue', title: 'Workflow step overdue' },
      instance_triggered: { event: 'workflow_triggered', title: 'Workflow started' },
      step_assigned: { event: 'workflow_step_assigned', title: 'Workflow step assigned to you' },
    }
    const mapped = eventMap[type] ?? { event: 'workflow_triggered', title: 'Workflow update' }
    await this.notifications.emit({
      orgId,
      module: 'workflows',
      event_type: mapped.event,
      recipients: userIds,
      title: mapped.title,
      body: message,
      link: '/dashboard/tasks/workflows/my',
      entity: { type: 'workflow_instance', id: instanceId },
    })
  }

  // ── Create instance ──────────────────────────────────────────────────────────

  async createInstance(
    workflowTemplateId: string,
    triggerType: string,
    context: Record<string, unknown>,
    triggeredByUserId?: string,
  ): Promise<{ id: string }> {
    const template = await this.prisma.workflowTemplate.findUniqueOrThrow({
      where: { id: workflowTemplateId },
      include: { steps: { orderBy: { order_index: 'asc' } } },
    })
    if (!(await this.automationEnabled(template.organization_id))) {
      throw new Error('Workflow execution is disabled for this organization')
    }

    const instanceName = await this.buildInstanceName(
      template.name,
      workflowTemplateId,
      triggerType,
      context,
    )

    const instance = await this.prisma.workflowInstance.create({
      data: {
        organization_id: template.organization_id,
        workflow_template_id: workflowTemplateId,
        name: instanceName,
        trigger_type: triggerType,
        triggered_by_user_id: triggeredByUserId ?? null,
        status: 'running',
        metadata: context as never,
      },
    })

    const defaultStatusId = await this.getDefaultStatusId(template.organization_id)
    const startAt = new Date()
    let prevScheduledAt: Date | null = null

    // Create all instance steps
    const createdSteps: { id: string; order_index: number; scheduled_at: Date | null; assigned_to_user_id: string }[] = []
    for (const step of template.steps) {
      const assignedTo = await this.resolveAssignee({ ...step, organization_id: template.organization_id })
      const rawScheduledAt = this.resolveDeadline(
        step.deadline_config as Record<string, unknown>,
        null,
        prevScheduledAt,
        startAt,
      )
      // Adjust for holidays — workflows always create (never skip), so use ?? rawScheduledAt
      const instanceStepPlaceholder = { id: 'pending', order_index: step.order_index }
      const scheduledAt = await this.holidaysService.adjustDeadline(
        rawScheduledAt, template.organization_id,
      ).then((adj) => adj ?? rawScheduledAt)
      const instanceStep = await this.prisma.workflowInstanceStep.create({
        data: {
          organization_id: template.organization_id,
          workflow_instance_id: instance.id,
          workflow_step_id: step.id,
          assigned_to_user_id: assignedTo,
          status: 'pending',
          scheduled_at: scheduledAt,
        },
      })
      // Write audit log now that we have instanceStep.id
      if (scheduledAt.getTime() !== rawScheduledAt.getTime()) {
        await this.holidaysService.adjustDeadline(
          rawScheduledAt, template.organization_id,
          undefined, undefined,
          'workflow_step', instanceStep.id, step.title,
        )
      }
      createdSteps.push({ id: instanceStep.id, order_index: step.order_index, scheduled_at: scheduledAt, assigned_to_user_id: assignedTo })
      prevScheduledAt = scheduledAt
    }

    // Activate first step
    if (createdSteps.length > 0) {
      const first = createdSteps[0]
      const step = template.steps[0]
      const taskId = await this.createTaskForStep(
        { id: first.id, assigned_to_user_id: first.assigned_to_user_id, scheduled_at: first.scheduled_at },
        { ...step, organization_id: template.organization_id },
        defaultStatusId,
      )
      await this.prisma.workflowInstanceStep.update({
        where: { id: first.id },
        data: { status: 'active', task_id: taskId, task_created_at: new Date() },
      })
      await this.prisma.workflowInstance.update({
        where: { id: instance.id },
        data: { current_step_id: first.id },
      })

      const ownerIds = (template.owner_user_ids as string[]) ?? []
      await this.notify(
        instance.id,
        template.organization_id,
        Array.from(new Set([...ownerIds, first.assigned_to_user_id])),
        'instance_triggered',
        `Workflow "${template.name}" started — instance "${instanceName}". First step: "${template.steps[0].title}".`,
      )
      await this.notify(
        instance.id,
        template.organization_id,
        [first.assigned_to_user_id],
        'step_assigned',
        `You're assigned step "${template.steps[0].title}" in workflow "${template.name}".`,
      )
    }

    return { id: instance.id }
  }

  // ── Handle step completed ────────────────────────────────────────────────────

  async handleStepCompleted(workflowInstanceStepId: string): Promise<void> {
    const instanceStep = await this.prisma.workflowInstanceStep.findUnique({
      where: { id: workflowInstanceStepId },
      include: { instance: { include: { template: true } } },
    })
    if (!instanceStep || instanceStep.status === 'completed') return

    await this.prisma.workflowInstanceStep.update({
      where: { id: workflowInstanceStepId },
      data: { status: 'completed', completed_at: new Date() },
    })

    const instance = instanceStep.instance
    const template = instance.template

    // Find all steps in order
    const allSteps = await this.prisma.workflowInstanceStep.findMany({
      where: { workflow_instance_id: instance.id },
      include: { instance: false },
      orderBy: { created_at: 'asc' },
    })

    const currentIdx = allSteps.findIndex((s) => s.id === workflowInstanceStepId)
    const nextStep = allSteps[currentIdx + 1]

    if (!nextStep) {
      await this.prisma.workflowInstance.update({
        where: { id: instance.id },
        data: { status: 'completed', completed_at: new Date() },
      })
      const ownerIds = (template.owner_user_ids as string[]) ?? []
      await this.notify(
        instance.id,
        instance.organization_id,
        ownerIds,
        'instance_completed',
        `Workflow "${template.name}" — instance "${instance.name}" has been completed.`,
      )
      return
    }

    // Recalculate deadline relative to just-completed step
    const workflowStep = await this.prisma.workflowStep.findUnique({ where: { id: nextStep.workflow_step_id } })
    if (!workflowStep) return

    const scheduledAt = this.resolveDeadline(
      workflowStep.deadline_config as Record<string, unknown>,
      new Date(),
      instanceStep.scheduled_at,
      instance.started_at,
    )

    const defaultStatusId = await this.getDefaultStatusId(instance.organization_id)
    const taskId = await this.createTaskForStep(
      { id: nextStep.id, assigned_to_user_id: nextStep.assigned_to_user_id, scheduled_at: scheduledAt },
      { ...workflowStep, organization_id: instance.organization_id },
      defaultStatusId,
    )

    await this.prisma.workflowInstanceStep.update({
      where: { id: nextStep.id },
      data: { status: 'active', task_id: taskId, task_created_at: new Date(), scheduled_at: scheduledAt },
    })
    await this.prisma.workflowInstance.update({
      where: { id: instance.id },
      data: { current_step_id: nextStep.id },
    })

    await this.notify(
      instance.id,
      instance.organization_id,
      [nextStep.assigned_to_user_id],
      'step_assigned',
      `You're assigned step "${workflowStep.title}" in workflow "${template.name}".`,
    )
  }

  // ── Cron: overdue steps ──────────────────────────────────────────────────────

  @Cron('*/15 * * * *')
  async processOverdueSteps(): Promise<void> {
    const now = new Date()
    const orgs = await this.prisma.organization.findMany({ where: { is_test: false }, select: { id: true } })
    for (const org of orgs) await this.processOverdueStepsForOrg(org.id, now)
  }

  // Org-scoped, now-injected — cron passes real now, ReplayService passes sim now.
  async processOverdueStepsForOrg(orgId: string, now: Date): Promise<void> {
    if (!(await this.automationEnabled(orgId))) return
    return this.auditWriter.runAsSystem(
      { orgId, triggerSource: 'workflow_overdue', occurredAt: now },
      () => this.processOverdueStepsForOrgImpl(orgId, now),
    )
  }

  private async processOverdueStepsForOrgImpl(orgId: string, now: Date): Promise<void> {
    const activeSteps = await this.prisma.workflowInstanceStep.findMany({
      where: { organization_id: orgId, status: 'active', scheduled_at: { lt: now } },
      include: { instance: { include: { template: { include: { steps: { orderBy: { order_index: 'asc' } } } } } } },
    })

    for (const step of activeSteps) {
      const workflowStep = await this.prisma.workflowStep.findUnique({ where: { id: step.workflow_step_id } })
      if (!workflowStep) continue

      const action = workflowStep.if_overdue_action
      const instance = step.instance
      const template = instance.template
      const ownerIds = (template.owner_user_ids as string[]) ?? []

      if (action === 'block_next') {
        await this.prisma.workflowInstanceStep.update({ where: { id: step.id }, data: { status: 'overdue' } })
        await this.prisma.workflowInstance.update({ where: { id: instance.id }, data: { status: 'stuck' } })

        // Find the next step and notify its assignee
        const allSteps = await this.prisma.workflowInstanceStep.findMany({
          where: { workflow_instance_id: instance.id },
          orderBy: { created_at: 'asc' },
        })
        const currentIdx = allSteps.findIndex((s) => s.id === step.id)
        const nextInstanceStep = allSteps[currentIdx + 1]

        if (nextInstanceStep) {
          const nextWorkflowStep = await this.prisma.workflowStep.findUnique({ where: { id: nextInstanceStep.workflow_step_id } })
          const assigneeName = await this.prisma.user
            .findUnique({ where: { id: step.assigned_to_user_id }, select: { name: true } })
            .then((u) => u?.name ?? 'Unknown')

          await this.notify(
            instance.id,
            instance.organization_id,
            [nextInstanceStep.assigned_to_user_id],
            'upstream_delay',
            `Your upcoming task '${nextWorkflowStep?.title ?? ''}' is delayed because '${workflowStep.title}' assigned to ${assigneeName} is overdue.`,
          )
        }

        await this.notify(instance.id, instance.organization_id, ownerIds, 'instance_stuck', `Workflow "${template.name}" — instance "${instance.name}" is stuck at step "${workflowStep.title}".`)

      } else if (action === 'proceed_anyway') {
        await this.prisma.workflowInstanceStep.update({ where: { id: step.id }, data: { status: 'overdue' } })
        await this.handleStepCompleted(step.id)

      } else if (action === 'trigger_branch' && workflowStep.branch_step_id) {
        await this.prisma.workflowInstanceStep.update({ where: { id: step.id }, data: { status: 'branched', branch_taken: true } })

        const branchWorkflowStep = await this.prisma.workflowStep.findUnique({ where: { id: workflowStep.branch_step_id } })
        if (!branchWorkflowStep) continue

        const assignedTo = await this.resolveAssignee({ ...branchWorkflowStep, organization_id: instance.organization_id })
        const scheduledAt = this.resolveDeadline(branchWorkflowStep.deadline_config as Record<string, unknown>, null, step.scheduled_at, instance.started_at)
        const defaultStatusId = await this.getDefaultStatusId(instance.organization_id)

        const branchInstanceStep = await this.prisma.workflowInstanceStep.create({
          data: {
            organization_id: instance.organization_id,
            workflow_instance_id: instance.id,
            workflow_step_id: workflowStep.branch_step_id,
            assigned_to_user_id: assignedTo,
            status: 'active',
            scheduled_at: scheduledAt,
          },
        })
        const taskId = await this.createTaskForStep(
          { id: branchInstanceStep.id, assigned_to_user_id: assignedTo, scheduled_at: scheduledAt },
          { ...branchWorkflowStep, organization_id: instance.organization_id },
          defaultStatusId,
        )
        await this.prisma.workflowInstanceStep.update({ where: { id: branchInstanceStep.id }, data: { task_id: taskId, task_created_at: now } })
        await this.prisma.workflowInstance.update({ where: { id: instance.id }, data: { current_step_id: branchInstanceStep.id } })
      }
    }
  }

  // ── Cron: date triggers ──────────────────────────────────────────────────────

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async processDateTriggers(): Promise<void> {
    const now = new Date()
    const orgs = await this.prisma.organization.findMany({ where: { is_test: false }, select: { id: true } })
    for (const org of orgs) await this.processDateTriggersForOrg(org.id, now)
  }

  // Org-scoped, now-injected — cron passes real now, ReplayService passes sim now.
  async processDateTriggersForOrg(orgId: string, now: Date): Promise<void> {
    if (!(await this.automationEnabled(orgId))) return
    return this.auditWriter.runAsSystem(
      { orgId, triggerSource: 'date_trigger', occurredAt: now },
      () => this.processDateTriggersForOrgImpl(orgId, now),
    )
  }

  private async processDateTriggersForOrgImpl(orgId: string, now: Date): Promise<void> {
    const today = new Date(now)
    today.setHours(0, 0, 0, 0)
    const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`

    const triggers = await this.prisma.workflowTrigger.findMany({
      where: { organization_id: orgId, type: 'date_trigger', is_active: true },
      include: { template: { select: { status: true, name: true } } },
    })

    for (const trigger of triggers) {
      if (trigger.template.status !== 'active') continue
      const cfg = trigger.config as { date?: string; repeat?: boolean }
      if (cfg.date && cfg.date.startsWith(todayStr)) {
        try {
          await this.createInstance(trigger.workflow_template_id, 'date_trigger', {}, undefined)
          if (!cfg.repeat) {
            await this.prisma.workflowTrigger.update({ where: { id: trigger.id }, data: { is_active: false } })
          }
        } catch (err) {
          this.logger.error(`Date trigger failed for template ${trigger.workflow_template_id}`, err)
        }
      }
    }
  }

  // ── Get notifications ────────────────────────────────────────────────────────

  async getNotifications(orgId: string, userId: string) {
    return this.prisma.workflowNotification.findMany({
      where: { organization_id: orgId, user_id: userId },
      orderBy: { created_at: 'desc' },
      take: 50,
    })
  }

  async markNotificationRead(orgId: string, userId: string, id: string): Promise<void> {
    const result = await this.prisma.workflowNotification.updateMany({
      where: { id, organization_id: orgId, user_id: userId },
      data: { is_read: true },
    })
    if (!result.count) throw new NotFoundException('Notification not found')
  }
}
