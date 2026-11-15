import { ACTIVE_ASSIGNEE } from '../tasks/active-assignee'
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common'
import { ClockService } from '../clock/clock.service'
import { DEFAULT_TZ, InstanceStepRow, MSG_ARCHIVED, MSG_EDIT, MSG_INSTANCE_VIEW, MSG_NOT_FOUND, MSG_RUN_NOT_FOUND, SendBackEvent, accessSelect, instanceInclude } from './workflow-template.types'
import { ModuleRef } from '@nestjs/core'
import { Principal } from '../access-rights/permissions.service'
import { PrismaService } from '../prisma/prisma.service'
import { TasksService } from '../tasks/tasks.service'
import { capabilitiesFor } from './workflow-access'
import { isRunParticipant, taskParticipantWhere } from './run-access'
import { unique } from './workflow-view.formatter'


/**
 * The lookups every workflow service shares: load a template/instance behind its access check
 * (loadEditable / loadInstance), who is an active member, user names, the org schedule context.
 */
@Injectable()
export class WorkflowAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    // Resolves TasksService lazily (TasksModule imports WorkflowsModule, so it can't
    // be injected directly without a module cycle) — see `assertCanViewTask`.
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  async loadEditable(orgId: string, templateId: string, p: Principal, opts: { allowArchived?: boolean } = {}) {
    const t = await this.prisma.workflowTemplate.findFirst({
      where: { id: templateId, organization_id: orgId },
      select: accessSelect(p.userId),
    })
    if (!t) throw new NotFoundException(MSG_NOT_FOUND)
    const loaded = { t, caps: capabilitiesFor(t, p) }
    // People who see an instance but can't change the workflow get the "who may" answer.
    if (!loaded.caps.can_edit) throw new ForbiddenException(MSG_EDIT)
    if (!opts.allowArchived && loaded.t.status === 'archived') throw new BadRequestException(MSG_ARCHIVED)
    return loaded
  }

  async activeMemberSet(orgId: string, ids: Iterable<string>): Promise<Set<string>> {
    const list = unique([...ids].filter(Boolean))
    if (!list.length) return new Set()
    const rows = await this.prisma.organizationMember.findMany({
      where: { organization_id: orgId, user_id: { in: list }, is_active: true },
      select: { user_id: true },
    })
    return new Set(rows.map((r) => r.user_id))
  }

  /**
   * The task-detail gate (TasksService.assertCanViewTask), resolved lazily. Fails
   * closed when the tasks module isn't available.
   */
  async assertCanViewTask(orgId: string, p: Principal, taskId: string): Promise<void> {
    let tasks: TasksService | null = null
    try {
      tasks = this.moduleRef?.get(TasksService, { strict: false }) ?? null
    } catch {
      tasks = null
    }
    if (!tasks) throw new ForbiddenException("You don't have access to this task.")
    await tasks.assertCanViewTask(orgId, p, taskId)
  }

  async userNames(ids: Iterable<string | null | undefined>): Promise<Map<string, string>> {
    const list = unique([...ids].filter((x): x is string => !!x))
    if (!list.length) return new Map()
    const users = await this.prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true } })
    return new Map(users.map((u) => [u.id, u.name]))
  }

  /** Org tz + org clock "now", loaded lazily only when a schedule needs a next run. */
  async scheduleContext(orgId: string): Promise<{ tz: string; now: Date }> {
    const [org, now] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: orgId }, select: { timezone: true } }),
      this.clock.now(orgId),
    ])
    return { tz: org?.timezone || DEFAULT_TZ, now }
  }

  /**
   * Instance gate: `can_view` on its workflow (admins, editors, viewers) OR the person
   * who ran it OR someone working in it (`run-access.ts`). Scoped by org + parent
   * template id (404 otherwise). `mayAct()` = may add documents: anyone who can see
   * it except a pure viewer.
   */
  async loadInstance(orgId: string, templateId: string, instanceId: string, p: Principal) {
    const inst = await this.prisma.workflowInstance.findFirst({
      where: { id: instanceId, workflow_template_id: templateId, organization_id: orgId },
      include: instanceInclude(p.userId),
    })
    if (!inst) throw new NotFoundException(MSG_RUN_NOT_FOUND)
    const caps = capabilitiesFor(inst.template, p)
    if (!caps.can_view && !(await isRunParticipant(this.prisma, orgId, instanceId, p.userId))) {
      throw new ForbiddenException(MSG_INSTANCE_VIEW)
    }
    let actCache: boolean | null = null
    const mayAct = async () => {
      if (actCache === null) {
        actCache =
          caps.can_edit ||
          inst.triggered_by_user_id === p.userId ||
          (await this.worksInInstance(orgId, instanceId, p.userId))
      }
      return actCache
    }
    return { inst, caps, mayAct }
  }

  /** Is the caller on any task of the instance (assignee / CC / escalation contact)? */
  private async worksInInstance(orgId: string, instanceId: string, userId: string): Promise<boolean> {
    const rows = await this.prisma.workflowInstanceStep.findMany({
      where: { workflow_instance_id: instanceId, organization_id: orgId, task_id: { not: null } },
      select: { task_id: true },
    })
    const taskIds = unique(rows.map((r) => r.task_id).filter((x): x is string => !!x))
    if (!taskIds.length) return false
    const hit = await this.prisma.task.findFirst({
      where: { id: { in: taskIds }, organization_id: orgId, ...taskParticipantWhere(userId) },
      select: { id: true },
    })
    return !!hit
  }

  /**
   * The latest `sent_back` event of every open send-back among `rows` (keyed by the
   * sender row): senders still waiting (`sent_back` + `waiting_on_row_id`) and the
   * senders reopened targets owe (`returned_to_row_id`). One query whatever the number
   * of instances; org- and instance-scoped. Callers pass only rows the caller may see.
   */
  async openSendBackEvents(orgId: string, rows: InstanceStepRow[]): Promise<Map<string, SendBackEvent>> {
    const senders = unique(
      rows
        .flatMap((r) => [r.status === 'sent_back' && r.waiting_on_row_id ? r.id : null, r.returned_to_row_id ?? null])
        .filter((x): x is string => !!x),
    )
    const out = new Map<string, SendBackEvent>()
    if (!senders.length) return out
    const events = await this.prisma.workflowInstanceEvent.findMany({
      where: {
        organization_id: orgId,
        workflow_instance_id: { in: unique(rows.map((r) => r.workflow_instance_id)) },
        instance_step_id: { in: senders },
        type: 'sent_back',
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      select: { instance_step_id: true, actor_user_id: true, created_at: true, metadata: true },
    })
    for (const e of events) {
      if (!e.instance_step_id || out.has(e.instance_step_id)) continue
      const meta = (e.metadata ?? {}) as { reason?: unknown; to_row_id?: unknown }
      out.set(e.instance_step_id, {
        actor_user_id: e.actor_user_id,
        created_at: e.created_at,
        reason: typeof meta.reason === 'string' && meta.reason.trim() ? meta.reason : null,
        to_row_id: typeof meta.to_row_id === 'string' ? meta.to_row_id : null,
      })
    }
    return out
  }

  /** Is the caller a non-CC live assignee of this row's task? */
  async isRowWorker(orgId: string, taskId: string | null, userId: string): Promise<boolean> {
    if (!taskId) return false
    const hit = await this.prisma.taskAssignee.findFirst({
      where: { task_id: taskId, organization_id: orgId, user_id: userId, is_cc: false, ...ACTIVE_ASSIGNEE },
      select: { id: true },
    })
    return !!hit
  }
}
