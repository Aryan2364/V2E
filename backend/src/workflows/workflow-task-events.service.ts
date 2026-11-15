import { ClockService } from '../clock/clock.service'
import { Injectable, Logger } from '@nestjs/common'
import { OPEN_ROW, StepRow, TX_OPTIONS, errorMessage, loadInstanceCtx, lockInstance, titleOf, userName, userNames } from './workflow-engine.shared'
import { PrismaService } from '../prisma/prisma.service'
import { WorkflowEngineRowsService } from './workflow-engine-rows.service'
import { WorkflowEngineSupportService } from './workflow-engine-support.service'
import { formatHumanDate } from './engine/tz'
import { isBranchRow } from './engine/snapshot'
import { isOpen } from './engine/dag'

/**
 * Task-event hooks: what happens to a run when the task behind one of its steps is completed,
 * closed incomplete, reopened, deleted, edited or escalated. Nothing here throws into the
 * task action that triggered it (`safely`).
 */
@Injectable()
export class WorkflowTaskEventsService {
  private readonly logger = new Logger(WorkflowTaskEventsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly support: WorkflowEngineSupportService,
    private readonly rows: WorkflowEngineRowsService,
  ) {}

  /**
   * A step's task completed → complete the row and settle the graph. Idempotent
   * (guarded) and transactional; NEVER throws (a failure parks the run as stuck).
   * Pass the task id so a stale task (replaced by retry) can't complete the row.
   */
  async handleStepCompleted(workflowInstanceStepId: string, taskId?: string): Promise<void> {
    let orgId: string | null = null
    let instanceId: string | null = null
    try {
      const row = await this.prisma.workflowInstanceStep.findUnique({ where: { id: workflowInstanceStepId } })
      if (!row) return
      orgId = row.organization_id
      instanceId = row.workflow_instance_id
      if (taskId && row.task_id !== taskId) return
      if (!isOpen(row.status)) return
      await this.rows.completeRowNow(row)
    } catch (err) {
      this.logger.error(`Advancing workflow step ${workflowInstanceStepId} failed: ${(err as Error)?.stack ?? err}`)
      if (orgId && instanceId) await this.support.markStuck(orgId, instanceId, workflowInstanceStepId, errorMessage(err))
    }
  }

  /** The workflow row a task drives, only if the task is still that row's task. */
  private async rowForTask(orgId: string, taskId: string): Promise<StepRow | null> {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organization_id: orgId },
      select: { workflow_instance_step_id: true },
    })
    if (!task?.workflow_instance_step_id) return null
    const row = await this.prisma.workflowInstanceStep.findFirst({
      where: { id: task.workflow_instance_step_id, organization_id: orgId },
    })
    return row && row.task_id === taskId ? row : null
  }

  private async safely(what: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn()
    } catch (err) {
      this.logger.error(`Workflow hook (${what}) failed: ${(err as Error)?.stack ?? err}`)
    }
  }

  /**
   * A task reached `completed`. A workflow step task completes its step; any other
   * task is not the engine's business. Never throws.
   */
  async onTaskCompleted(orgId: string, taskId: string): Promise<void> {
    await this.safely('task completed', async () => {
      const task = await this.prisma.task.findFirst({
        where: { id: taskId, organization_id: orgId },
        select: { workflow_instance_step_id: true },
      })
      if (task?.workflow_instance_step_id) {
        await this.handleStepCompleted(task.workflow_instance_step_id, taskId)
      }
    })
  }

  /**
   * A workflow task was closed as Incomplete / Partially Completed. The step can't
   * count as done on an unfinished task, so the run needs attention (stuck) and its
   * owners are told: reopen and complete the task, Retry for a fresh task, or Skip.
   * A legacy escalation task closed incomplete is simply recorded as skipped.
   */
  async onTaskClosedIncomplete(orgId: string, taskId: string): Promise<void> {
    await this.safely('task incomplete', async () => {
      const row = await this.rowForTask(orgId, taskId)
      if (!row || !isOpen(row.status)) return
      if (isBranchRow(row)) {
        await this.prisma.workflowInstanceStep.updateMany({
          where: { id: row.id, status: { in: OPEN_ROW } },
          data: { status: 'skipped', last_error: 'Task closed as incomplete' },
        })
        return
      }
      await this.prisma.workflowInstanceStep.update({ where: { id: row.id }, data: { last_error: 'Task closed as incomplete' } })
      await this.support.markStuck(
        orgId,
        row.workflow_instance_id,
        null,
        `“${titleOf(row)}” was closed as incomplete. Reopen its task, retry the instance, or skip the step.`,
      )
    })
  }

  /**
   * A workflow task was reopened by a person (not a send back — that path reopens
   * without calling this hook).
   *  - Its step had completed → the step is in progress again (a completed run
   *    resumes `running`). Steps after it that already started are left alone —
   *    "send back" is the way to redo work in order.
   *  - Its step was open with a closed-unfinished task (run stuck) → the run resumes.
   */
  async onTaskReopened(orgId: string, taskId: string, actorUserId: string): Promise<void> {
    await this.safely('task reopened', async () => {
      const row = await this.rowForTask(orgId, taskId)
      if (!row) return
      const inst = await loadInstanceCtx(this.prisma, orgId, row.workflow_instance_id)
      if (!inst || inst.status === 'cancelled') return
      const now = await this.clock.now(orgId)
      const title = titleOf(row)

      if (isBranchRow(row)) {
        if (row.status === 'completed' || row.status === 'skipped') {
          await this.prisma.workflowInstanceStep.updateMany({
            where: { id: row.id, status: { in: ['completed', 'skipped'] } },
            data: { status: 'active', completed_at: null, last_error: null },
          })
        }
        return
      }

      if (isOpen(row.status)) {
        await this.prisma.$transaction(async (tx) => {
          await lockInstance(tx, inst.id)
          await tx.workflowInstanceStep.update({ where: { id: row.id }, data: { last_error: null } })
          const others = await tx.workflowInstanceStep.count({
            where: { workflow_instance_id: inst.id, id: { not: row.id }, last_error: { not: null }, status: { in: OPEN_ROW } },
          })
          if (inst.status === 'stuck' && others === 0) {
            await tx.workflowInstance.updateMany({ where: { id: inst.id, status: 'stuck' }, data: { status: 'running', last_error: null } })
          }
        }, TX_OPTIONS)
        return
      }

      if (row.status !== 'completed') return
      if (!['running', 'stuck', 'completed'].includes(inst.status)) return
      await this.prisma.$transaction(async (tx) => {
        await lockInstance(tx, inst.id)
        const back = await tx.workflowInstanceStep.updateMany({
          where: { id: row.id, status: 'completed' },
          data: { status: 'active', completed_at: null, last_error: null },
        })
        if (back.count !== 1) return
        await tx.workflowInstance.updateMany({
          where: { id: inst.id, status: { in: ['running', 'stuck', 'completed'] } },
          data: { status: 'running', completed_at: null, last_error: null, current_step_id: row.id },
        })
        const actorName = await userName(tx, actorUserId)
        await this.support.event(tx, {
          orgId,
          instanceId: inst.id,
          rowId: row.id,
          type: 'step_started',
          actorUserId,
          message: `${actorName} reopened “${title}”.`,
          metadata: { reopened: true, task_id: taskId },
          at: now,
        })
      }, TX_OPTIONS)
    })
  }

  /** A workflow task was deleted: the run can't continue on it → stuck (Retry recreates it). */
  async onTaskDeleted(orgId: string, taskId: string): Promise<void> {
    await this.safely('task deleted', async () => {
      const row = await this.rowForTask(orgId, taskId)
      if (!row || !isOpen(row.status)) return
      if (isBranchRow(row)) {
        await this.prisma.workflowInstanceStep.updateMany({
          where: { id: row.id, status: { in: OPEN_ROW } },
          data: { status: 'skipped', last_error: 'Task was deleted' },
        })
        return
      }
      await this.prisma.workflowInstanceStep.update({ where: { id: row.id }, data: { last_error: 'Task was deleted' } })
      await this.support.markStuck(
        orgId,
        row.workflow_instance_id,
        null,
        `The task for “${titleOf(row)}” was deleted. Retry the instance, skip the step, or cancel the instance.`,
      )
    })
  }

  /**
   * Keep an open step in sync after its task was edited: reassignment updates
   * `assigned_to_user_id`; a deadline change updates `scheduled_at`, and a step that
   * was waiting as late comes back to in progress when its new deadline is ahead.
   */
  async syncStepFromTask(orgId: string, taskId: string): Promise<void> {
    await this.safely('task updated', async () => {
      const row = await this.rowForTask(orgId, taskId)
      if (!row || !isOpen(row.status)) return
      const task = await this.prisma.task.findFirst({
        where: { id: taskId, organization_id: orgId, is_deleted: false },
        select: { deadline: true, assignees: { where: { is_cc: false, removed_at: null }, select: { user_id: true } } },
      })
      if (!task) return
      const workers = task.assignees.map((a) => a.user_id)
      const assignee =
        row.assigned_to_user_id && workers.includes(row.assigned_to_user_id)
          ? row.assigned_to_user_id
          : workers[0] ?? row.assigned_to_user_id
      const now = await this.clock.now(orgId)
      const backOnTime = row.status === 'overdue' && !!task.deadline && task.deadline.getTime() > now.getTime()
      const res = await this.prisma.workflowInstanceStep.updateMany({
        where: { id: row.id, status: row.status },
        data: {
          assigned_to_user_id: assignee,
          scheduled_at: task.deadline,
          ...(backOnTime ? { status: 'active' as const } : {}),
        },
      })
      if (backOnTime && res.count === 1) {
        await this.support.event(this.prisma, {
          orgId,
          instanceId: row.workflow_instance_id,
          rowId: row.id,
          type: 'step_started',
          message: `“${titleOf(row)}” has a new deadline (${formatHumanDate(task.deadline!, await this.support.orgTimeZone(orgId))}) and is on time.`,
          metadata: { back_on_time: true, deadline: task.deadline!.toISOString() },
          at: now,
        })
      }
    })
  }

  /**
   * The scheduler fired TaskEscalation rows on a task → run history for workflow
   * tasks (the escalation itself is the scheduler's job). Never throws.
   */
  async onTaskEscalated(orgId: string, taskId: string, level: number, contactIds: string[]): Promise<void> {
    await this.safely('task escalated', async () => {
      const row = await this.rowForTask(orgId, taskId)
      if (!row) return
      const now = await this.clock.now(orgId)
      await this.support.event(this.prisma, {
        orgId,
        instanceId: row.workflow_instance_id,
        rowId: row.id,
        type: 'step_escalated',
        message: `“${titleOf(row)}” is late and was escalated to ${await userNames(this.prisma, contactIds)}${level > 1 ? ` (level ${level})` : ''}.`,
        metadata: { level, contact_ids: contactIds, task_id: taskId },
        at: now,
      })
    })
  }

  // ═══ Cron: late steps ════════════════════════════════════════════════════════
}
