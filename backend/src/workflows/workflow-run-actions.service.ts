import { ADVANCEABLE, Effect, OPEN_ROW, REASON_MAX, REASON_MIN, SENDABLE_ROW, StepRow, TERMINAL_TASK_TYPES, TX_OPTIONS, errorMessage, instanceLink, isWaitingRow, loadInstanceCtx, lockInstance, sendBackCandidates, snapshotFor, taskWorkers, titleOf, userName, withdrawTask } from './workflow-engine.shared'
import { BadRequestException, ForbiddenException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { ClockService } from '../clock/clock.service'
import { HolidaysService } from '../holidays/holidays.service'
import { PrismaService } from '../prisma/prisma.service'
import { WorkflowEngineRowsService } from './workflow-engine-rows.service'
import { WorkflowEngineSupportService } from './workflow-engine-support.service'
import { computeDueDeadline } from './engine/deadline'
import { flowRows, isOpen, isSatisfied, readyRows, rowDependencies, runFinished } from './engine/dag'
import { formatHumanDate } from './engine/tz'
import { isBranchRow } from './engine/snapshot'
import { reopenTaskForWorkflow, setEscalationsPaused } from './engine/step-task'

/** Run-level actions on a live instance: send back, cancel, retry, skip a step, start a waiting step now. */
@Injectable()
export class WorkflowRunActionsService {
  private readonly logger = new Logger(WorkflowRunActionsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly holidaysService: HolidaysService,
    private readonly clock: ClockService,
    private readonly support: WorkflowEngineSupportService,
    private readonly rows: WorkflowEngineRowsService,
  ) {}

  /**
   * Where `fromRowId` may send the run back to: completed steps upstream of it,
   * direct predecessors first. Empty when the step can't send back (not in progress,
   * nothing upstream completed).
   */
  async sendBackTargets(orgId: string, instanceId: string, fromRowId: string): Promise<{ row_id: string; title: string }[]> {
    const inst = await this.prisma.workflowInstance.findFirst({
      where: { id: instanceId, organization_id: orgId },
      select: { id: true, status: true },
    })
    if (!inst) throw new NotFoundException('Instance not found')
    const rows = await this.prisma.workflowInstanceStep.findMany({ where: { workflow_instance_id: instanceId, organization_id: orgId } })
    const from = rows.find((r) => r.id === fromRowId)
    if (!from || isBranchRow(from)) throw new NotFoundException('That step isn’t part of this instance')
    if (!ADVANCEABLE.includes(inst.status as 'running') || !SENDABLE_ROW.includes(from.status as 'active')) return []
    return sendBackCandidates(rows, fromRowId).map((r) => ({ row_id: r.id, title: titleOf(r) }))
  }

  /**
   * Send the run back from an in-progress step to an earlier completed step upstream
   * of it, with a reason. One transaction:
   *  - the sender row → `sent_back` (waiting_on = target, count + 1); its task's
   *    unfired escalations pause;
   *  - the target row → `active` (returned_to = sender); its task is reopened as a
   *    system reopen with a new deadline = now + the target's due rule (holiday-
   *    adjusted, recorded as a revision); the reason is posted on it as a comment by
   *    the actor;
   *  - other steps downstream of the target are untouched;
   *  - a `sent_back` event; the target's people and the owners are told.
   *
   * Who may: a live non-CC assignee of the sender's task, or someone who can edit
   * the workflow — the API resolves that capability and passes `opts.canEdit`.
   */
  async sendBack(
    orgId: string,
    instanceId: string,
    fromRowId: string,
    toRowId: string,
    reason: string,
    actorUserId: string,
    opts: { canEdit?: boolean } = {},
  ): Promise<void> {
    const inst = await loadInstanceCtx(this.prisma, orgId, instanceId)
    if (!inst) throw new NotFoundException('Instance not found')
    if (!ADVANCEABLE.includes(inst.status as 'running')) {
      throw new BadRequestException(`This instance is ${inst.status}, so it can’t be sent back.`)
    }
    const why = (reason ?? '').trim()
    if (why.length < REASON_MIN) {
      throw new BadRequestException(`Enter a reason of at least ${REASON_MIN} characters.`)
    }
    if (why.length > REASON_MAX) throw new BadRequestException(`Keep the reason under ${REASON_MAX} characters.`)

    const rows = await this.prisma.workflowInstanceStep.findMany({ where: { workflow_instance_id: instanceId, organization_id: orgId } })
    const from = rows.find((r) => r.id === fromRowId)
    const to = rows.find((r) => r.id === toRowId)
    if (!from || isBranchRow(from)) throw new NotFoundException('That step isn’t part of this instance')
    if (!to || isBranchRow(to)) throw new NotFoundException('The step to send back to isn’t part of this instance')
    const fromTitle = titleOf(from)
    const toTitle = titleOf(to)
    if (!SENDABLE_ROW.includes(from.status as 'active')) {
      throw new BadRequestException(`“${fromTitle}” isn’t in progress, so it can’t send the instance back.`)
    }
    if (!sendBackCandidates(rows, fromRowId).some((r) => r.id === toRowId)) {
      throw new BadRequestException(
        to.status === 'completed'
          ? `“${fromTitle}” can only send the instance back to an earlier step.`
          : `“${toTitle}” isn’t done, so the instance can’t be sent back to it.`,
      )
    }
    const workers = await taskWorkers(this.prisma, orgId, from.task_id)
    if (!workers.includes(actorUserId) && !opts.canEdit) {
      throw new ForbiddenException(`Only the assignees of “${fromTitle}”, editors and admins can send it back.`)
    }
    if (!to.task_id) throw new BadRequestException(`“${toTitle}” has no task to reopen, so the instance can’t be sent back to it.`)

    const now = await this.clock.now(orgId)
    const tz = await this.support.orgTimeZone(orgId)
    const effects: Effect[] = []
    const link = instanceLink(inst.workflow_template_id, inst.id)
    await this.prisma.$transaction(async (tx) => {
      await lockInstance(tx, inst.id)
      const paused = await tx.workflowInstanceStep.updateMany({
        where: { id: from.id, status: { in: SENDABLE_ROW } },
        data: { status: 'sent_back', waiting_on_row_id: to.id, sent_back_count: { increment: 1 } },
      })
      if (paused.count !== 1) throw new BadRequestException('This step just changed. Refresh and try again.')
      const reopened = await tx.workflowInstanceStep.updateMany({
        where: { id: to.id, status: 'completed' },
        data: { status: 'active', returned_to_row_id: from.id, completed_at: null, last_error: null },
      })
      if (reopened.count !== 1) throw new BadRequestException(`“${toTitle}” just changed. Refresh and try again.`)

      const toSnap = await snapshotFor(tx, to, inst.workflow_template_id)
      const toWorkers = await taskWorkers(tx, orgId, to.task_id)
      const raw = toSnap ? computeDueDeadline(now, toSnap.due_days, toSnap.due_time, tz) : new Date(now.getTime() + 86_400_000)
      const deadline = (await this.holidaysService.adjustDeadline(raw, orgId, undefined, toWorkers[0])) ?? raw
      const body = `Sent back from “${fromTitle}”: ${why}`
      await reopenTaskForWorkflow(tx, { orgId, taskId: to.task_id!, actorUserId, newDeadline: deadline, now, reason: body })
      await tx.workflowInstanceStep.update({ where: { id: to.id }, data: { scheduled_at: deadline } })
      // The reason joins the instance discussion, on the reopened step's task, marked as a
      // send-back ("↩ Sent back to “…”") — its text is the reason alone.
      const comment = await tx.taskComment.create({
        data: {
          organization_id: orgId,
          task_id: to.task_id!,
          workflow_instance_id: inst.id,
          sent_back_from_row_id: from.id,
          sent_back_to_row_id: to.id,
          user_id: actorUserId,
          body: why,
          created_at: now,
        },
        select: { id: true },
      })
      await tx.taskActivityLog.create({
        data: {
          organization_id: orgId,
          task_id: to.task_id!,
          performed_by_user_id: actorUserId,
          action: 'comment_added',
          metadata: { comment_id: comment.id, source: 'workflow' },
        },
      })
      if (from.task_id) await setEscalationsPaused(tx, orgId, from.task_id, true)
      await tx.workflowInstance.update({ where: { id: inst.id }, data: { current_step_id: to.id } })

      const actorName = await userName(tx, actorUserId)
      await this.support.event(tx, {
        orgId,
        instanceId: inst.id,
        rowId: from.id,
        type: 'sent_back',
        actorUserId,
        message: `${actorName} sent the instance back from “${fromTitle}” to “${toTitle}”: ${why}`,
        metadata: {
          from_row_id: from.id,
          to_row_id: to.id,
          reason: why,
          from_status: from.status,
          comment_id: comment.id,
          new_deadline: deadline.toISOString(),
        },
        at: now,
      })
      effects.push(
        this.support.notify(orgId, toWorkers.filter((u) => u !== actorUserId), 'workflow_sent_back', `“${toTitle}” was sent back to you`,
          `${actorName} sent “${inst.name}” back from “${fromTitle}”: ${why}\nNew deadline: ${formatHumanDate(deadline, tz)}.`,
          `/dashboard/tasks/${to.task_id}`, inst.id),
        this.support.notify(orgId, inst.editorIds.filter((u) => u !== actorUserId && !toWorkers.includes(u)), 'workflow_sent_back',
          'Instance sent back', `${actorName} sent “${inst.name}” back from “${fromTitle}” to “${toTitle}”: ${why}`, link, inst.id),
      )
    }, TX_OPTIONS)
    await this.support.runEffects(effects)
  }

  // ═══ Cancel / retry / skip ═══════════════════════════════════════════════════

  /**
   * Cancel a running/stuck run: cancelled; every open step task withdrawn
   * (soft-deleted with an archive entry, like a task delete); open and pending rows
   * → skipped; assignees of withdrawn tasks are told.
   */
  async cancelInstance(orgId: string, instanceId: string, actorUserId: string): Promise<void> {
    const inst = await loadInstanceCtx(this.prisma, orgId, instanceId)
    if (!inst) throw new NotFoundException('Instance not found')
    if (!ADVANCEABLE.includes(inst.status as 'running')) {
      throw new BadRequestException(`This instance is already ${inst.status}, so it can’t be cancelled.`)
    }
    const now = await this.clock.now(orgId)
    const effects: Effect[] = []
    await this.prisma.$transaction(async (tx) => {
      await lockInstance(tx, instanceId)
      const res = await tx.workflowInstance.updateMany({
        where: { id: instanceId, organization_id: orgId, status: { in: ADVANCEABLE } },
        data: { status: 'cancelled', completed_at: now, last_error: null },
      })
      if (res.count !== 1) throw new BadRequestException('This instance just changed. Refresh and try again.')
      const actorName = await userName(tx, actorUserId)
      const rows = await tx.workflowInstanceStep.findMany({
        where: { workflow_instance_id: instanceId, status: { in: ['pending', ...OPEN_ROW] } },
      })
      for (const r of rows) {
        const w = isOpen(r.status)
          ? await withdrawTask(tx, orgId, r.task_id, actorUserId, `Instance “${inst.name}” was cancelled`, now)
          : { withdrawn: false, assigneeIds: [], title: null }
        await tx.workflowInstanceStep.update({
          where: { id: r.id },
          data: { status: 'skipped', last_error: `Cancelled by ${actorName}`, waiting_on_row_id: null, returned_to_row_id: null },
        })
        if (w.withdrawn && w.assigneeIds.length) {
          effects.push(
            this.support.notify(orgId, w.assigneeIds.filter((u) => u !== actorUserId), 'workflow_task_withdrawn', 'Instance cancelled',
              `“${inst.name}” was cancelled by ${actorName}. Your task “${w.title}” was withdrawn.`,
              instanceLink(inst.workflow_template_id, inst.id), inst.id),
          )
        }
      }
      await this.support.event(tx, {
        orgId,
        instanceId,
        type: 'run_cancelled',
        actorUserId,
        message: `${actorName} cancelled the instance.`,
        metadata: { withdrawn_rows: rows.filter((r) => isOpen(r.status)).map((r) => r.id) },
        at: now,
      })
    }, TX_OPTIONS)
    await this.support.runEffects(effects)
  }

  /**
   * Recover a stuck / stranded run, DAG-wide:
   *  - an open step whose task completed but whose advance failed → complete it;
   *  - an open step whose task is missing, deleted or closed unfinished → a fresh
   *    task (same people if still active; the old deadline if still ahead);
   *  - pending steps whose dependencies are all satisfied → activated;
   *  - every step done → the run completes;
   *  - otherwise (open tasks simply still open) the run just resumes `running`.
   */
  async retryInstance(orgId: string, instanceId: string, actorUserId: string): Promise<void> {
    const inst = await loadInstanceCtx(this.prisma, orgId, instanceId)
    if (!inst) throw new NotFoundException('Instance not found')
    if (!ADVANCEABLE.includes(inst.status as 'running')) {
      throw new BadRequestException(`This instance is ${inst.status}, so there is nothing to retry.`)
    }
    const rows = flowRows(await this.prisma.workflowInstanceStep.findMany({ where: { workflow_instance_id: instanceId } }))
    const open = rows.filter((r) => isOpen(r.status))
    const taskIds = open.map((r) => r.task_id).filter((x): x is string => !!x)
    const tasks = taskIds.length
      ? await this.prisma.task.findMany({
          where: { id: { in: taskIds }, organization_id: orgId },
          select: { id: true, is_deleted: true, deadline: true, status: { select: { type: true } } },
        })
      : []
    const taskById = new Map(tasks.map((t) => [t.id, t]))
    const finishedTask = open.filter((r) => {
      const t = r.task_id ? taskById.get(r.task_id) : undefined
      return !!t && !t.is_deleted && t.status.type === 'completed'
    })
    const brokenTask = open.filter((r) => {
      const t = r.task_id ? taskById.get(r.task_id) : undefined
      return !t || t.is_deleted || (TERMINAL_TASK_TYPES.includes(t.status.type) && t.status.type !== 'completed')
    })
    const now = await this.clock.now(orgId)
    // A row waiting for its start time is the run moving normally, not stranded.
    const waitingAhead = (r: StepRow) => isWaitingRow(r) && r.start_at!.getTime() > now.getTime()
    const ready = readyRows(rows, rowDependencies(rows)).filter((r) => !waitingAhead(r))
    const stranded =
      inst.status === 'stuck' ||
      !!inst.last_error ||
      finishedTask.length > 0 ||
      brokenTask.length > 0 ||
      ready.length > 0 ||
      runFinished(rows) ||
      (open.length === 0 && !rows.some(waitingAhead) && rows.some((r) => r.status === 'pending'))
    if (!stranded) throw new BadRequestException('This instance is not stuck, so there is nothing to retry.')

    const tz = await this.support.orgTimeZone(orgId)
    const effects: Effect[] = []
    try {
      await this.prisma.$transaction(async (tx) => {
        await lockInstance(tx, instanceId)
        await tx.workflowInstance.updateMany({
          where: { id: instanceId, status: { in: ADVANCEABLE } },
          data: { status: 'running', last_error: null },
        })
        for (const r of finishedTask) await this.rows.markRowCompleted(tx, inst, r.id, now, tz, effects, actorUserId)

        for (const r of brokenTask) {
          const snap = await snapshotFor(tx, r, inst.workflow_template_id)
          if (!snap) {
            throw new BadRequestException(
              `“${titleOf(r)}” was deleted from the workflow before it ran. Skip the step or cancel the instance.`,
            )
          }
          // Keep the deadline when it's still ahead; else a fresh one from now.
          const keep = r.scheduled_at && r.scheduled_at.getTime() > now.getTime() ? r.scheduled_at : null
          const status = r.status === 'sent_back' || r.status === 'moved_on' ? r.status : 'active'
          const { taskId } = await this.rows.giveRowTask(tx, inst, r, snap, now, tz, effects, { deadline: keep, status })
          if (status === 'sent_back') await setEscalationsPaused(tx, orgId, taskId, true)
        }
        // Clear stale row errors left by the failure we're recovering from.
        const fixed = new Set([...brokenTask.map((r) => r.id)])
        for (const r of rows) {
          if (r.last_error && !fixed.has(r.id) && isOpen(r.status)) {
            await tx.workflowInstanceStep.update({ where: { id: r.id }, data: { last_error: null } })
          }
        }
        const actorName = await userName(tx, actorUserId)
        await this.support.event(tx, {
          orgId,
          instanceId,
          type: 'retried',
          actorUserId,
          message: `${actorName} retried the instance.`,
          metadata: {
            completed_rows: finishedTask.map((r) => r.id),
            recreated_rows: brokenTask.map((r) => r.id),
            activated_rows: ready.map((r) => r.id),
          },
          at: now,
        })
        await this.rows.settle(tx, inst, now, tz, effects)
      }, TX_OPTIONS)
    } catch (err) {
      if (err instanceof HttpException) throw err
      this.logger.error(`Retry of workflow instance ${instanceId} by ${actorUserId} failed: ${(err as Error)?.stack ?? err}`)
      await this.support.markStuck(orgId, instanceId, null, errorMessage(err))
      throw new BadRequestException(errorMessage(err))
    }
    await this.support.runEffects(effects)
  }

  /**
   * Skip one step (its open task is withdrawn) and settle the graph — its dependents
   * may start. `rowId` defaults to the run's single current step; with several steps
   * in progress the caller must say which. Skipping a send-back target returns the
   * run to the sender; skipping a paused sender releases its target.
   */
  async skipStep(orgId: string, instanceId: string, actorUserId: string, rowId?: string | null): Promise<void> {
    const inst = await loadInstanceCtx(this.prisma, orgId, instanceId)
    if (!inst) throw new NotFoundException('Instance not found')
    if (!ADVANCEABLE.includes(inst.status as 'running')) {
      throw new BadRequestException(`This instance is ${inst.status}, so steps can’t be skipped.`)
    }
    const rows = flowRows(await this.prisma.workflowInstanceStep.findMany({ where: { workflow_instance_id: instanceId, organization_id: orgId } }))
    let target: StepRow | undefined
    if (rowId) {
      target = rows.find((r) => r.id === rowId)
      if (!target) throw new NotFoundException('That step isn’t part of this instance')
    } else {
      const open = rows.filter((r) => isOpen(r.status))
      const candidates = open.length ? open : readyRows(rows, rowDependencies(rows))
      if (candidates.length === 0) throw new BadRequestException('There is no current step to skip.')
      if (candidates.length > 1) throw new BadRequestException('Several steps are in progress. Choose which one to skip.')
      target = candidates[0]
    }
    if (target.status !== 'pending' && !isOpen(target.status)) {
      throw new BadRequestException(`“${titleOf(target)}” is already ${target.status.replace('_', ' ')}, so it can’t be skipped.`)
    }
    const row = target
    const now = await this.clock.now(orgId)
    const tz = await this.support.orgTimeZone(orgId)
    const effects: Effect[] = []
    try {
      await this.prisma.$transaction(async (tx) => {
        await lockInstance(tx, instanceId)
        const actorName = await userName(tx, actorUserId)
        const res = await tx.workflowInstanceStep.updateMany({
          where: { id: row.id, status: { in: ['pending', ...OPEN_ROW] } },
          data: { status: 'skipped', last_error: `Skipped by ${actorName}`, waiting_on_row_id: null, returned_to_row_id: null },
        })
        if (res.count !== 1) throw new BadRequestException('This step just changed. Refresh and try again.')
        const title = titleOf(row)
        const w = isOpen(row.status)
          ? await withdrawTask(tx, orgId, row.task_id, actorUserId, `Step skipped by ${actorName}`, now)
          : { withdrawn: false, assigneeIds: [] as string[], title: null }
        if (w.withdrawn && w.assigneeIds.length) {
          effects.push(
            this.support.notify(orgId, w.assigneeIds.filter((u) => u !== actorUserId), 'workflow_task_withdrawn', 'Step skipped',
              `${actorName} skipped “${w.title}” in “${inst.name}”. Your task was withdrawn.`,
              instanceLink(inst.workflow_template_id, inst.id), inst.id),
          )
        }
        await this.support.event(tx, {
          orgId,
          instanceId,
          rowId: row.id,
          type: 'step_skipped',
          actorUserId,
          message: `${actorName} skipped “${title}”.`,
          metadata: { previous_status: row.status, task_withdrawn: w.withdrawn },
          at: now,
        })
        if (row.status === 'sent_back' && row.waiting_on_row_id) {
          await tx.workflowInstanceStep.updateMany({
            where: { id: row.waiting_on_row_id, returned_to_row_id: row.id },
            data: { returned_to_row_id: null },
          })
        }
        if (row.returned_to_row_id) await this.rows.resumeSender(tx, inst, row, row.returned_to_row_id, now, tz, effects)
        await this.rows.settle(tx, inst, now, tz, effects, { resume: true })
      }, TX_OPTIONS)
    } catch (err) {
      if (err instanceof HttpException) throw err
      this.logger.error(`Skip on workflow instance ${instanceId} failed: ${(err as Error)?.stack ?? err}`)
      throw new BadRequestException(errorMessage(err))
    }
    await this.support.runEffects(effects)
  }

  /** Back-compat alias: skip the run's single current step. */
  async skipCurrentStep(orgId: string, instanceId: string, actorUserId: string): Promise<void> {
    return this.skipStep(orgId, instanceId, actorUserId)
  }

  // ═══ Start now ═══════════════════════════════════════════════════════════════

  /**
   * "Start now": a WAITING row (pending, steps-before done, `start_at` set) starts
   * immediately — its task is created now; the deadline rules are unchanged (a
   * calendar due keeps its planned date; a relative due counts from now). A
   * `step_started` event records who started it early. Who may: the API checks
   * `can_edit`. The row is read scoped to this run + org.
   */
  async startStepNow(orgId: string, instanceId: string, rowId: string, actorUserId: string): Promise<void> {
    const inst = await loadInstanceCtx(this.prisma, orgId, instanceId)
    if (!inst) throw new NotFoundException('Instance not found')
    if (!ADVANCEABLE.includes(inst.status as 'running')) {
      throw new BadRequestException(`This instance is ${inst.status}, so steps can’t be started.`)
    }
    const row = await this.prisma.workflowInstanceStep.findFirst({
      where: { id: rowId, workflow_instance_id: instanceId, organization_id: orgId },
    })
    if (!row || isBranchRow(row)) throw new NotFoundException('That step isn’t part of this instance')
    if (!isWaitingRow(row)) {
      throw new BadRequestException(`“${titleOf(row)}” isn’t waiting to start.`)
    }
    const now = await this.clock.now(orgId)
    const tz = await this.support.orgTimeZone(orgId)
    const effects: Effect[] = []
    try {
      await this.prisma.$transaction(async (tx) => {
        await lockInstance(tx, instanceId)
        const rows = await tx.workflowInstanceStep.findMany({ where: { workflow_instance_id: instanceId, organization_id: orgId } })
        const cur = rows.find((r) => r.id === rowId)
        if (!cur || !isWaitingRow(cur)) throw new BadRequestException('This step just changed. Refresh and try again.')
        const status = new Map(rows.map((r) => [r.id, r.status]))
        const deps = rowDependencies(rows).get(cur.id) ?? []
        if (!deps.every((d) => isSatisfied(status.get(d) ?? 'pending'))) {
          throw new BadRequestException(`The steps before “${titleOf(cur)}” aren’t done yet, so it can’t start.`)
        }
        const name = await userName(tx, actorUserId)
        const started = await this.rows.activateRow(tx, inst, cur, now, tz, effects, { earlyBy: { userId: actorUserId, name } })
        if (!started) throw new BadRequestException('This step just changed. Refresh and try again.')
      }, TX_OPTIONS)
    } catch (err) {
      if (err instanceof HttpException) throw err
      this.logger.error(`Start now on workflow step ${rowId} failed: ${(err as Error)?.stack ?? err}`)
      throw new BadRequestException(errorMessage(err))
    }
    await this.support.runEffects(effects)
  }

  // ═══ Task lifecycle hooks (called by TasksService / scheduler — never throw) ═══
}
