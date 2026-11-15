import { ADVANCEABLE, Effect, InstanceCtx, OPEN_ROW, StepPeople, StepRow, TX_OPTIONS, Tx, defaultStatusId, formatStartMoment, instanceLink, isWaitingRow, loadInstanceCtx, lockInstance, notesSummary, requireSnapshot, resolvePeople, taskWorkers, titleOf, userNames } from './workflow-engine.shared'
import { ClockService } from '../clock/clock.service'
import { HolidaysService } from '../holidays/holidays.service'
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { StepSnapshot, isBranchRow, readSnapshot } from './engine/snapshot'
import { WorkflowEngineSupportService } from './workflow-engine-support.service'
import { createStepTask, moveTaskDeadline, setEscalationsPaused } from './engine/step-task'
import { formatHumanDate } from './engine/tz'
import { isOpen, isSatisfied, readyRows, rowDependencies, runFinished } from './engine/dag'

/**
 * Row activation and settling: giving a step its task, starting/waiting, completing a row and
 * resuming the step that sent the run back. Every method runs inside the caller's transaction.
 */
@Injectable()
export class WorkflowEngineRowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly holidaysService: HolidaysService,
    private readonly clock: ClockService,
    private readonly support: WorkflowEngineSupportService,
  ) {}

  /** Create the step task for `row` and record it on the row. Used by activation and retry. */
  async giveRowTask(
    tx: Tx,
    inst: InstanceCtx,
    row: StepRow,
    snap: StepSnapshot,
    now: Date,
    tz: string,
    effects: Effect[],
    opts: { deadline?: Date | null; status?: StepRow['status'] } = {},
  ): Promise<{ taskId: string; people: StepPeople; deadline: Date }> {
    const orgId = inst.organization_id
    const people = await resolvePeople(tx, inst, snap)
    let deadline = opts.deadline ?? null
    if (!deadline) {
      const { raw, adjusted } = await this.support.stepDeadline(inst, row, snap, now, tz, people.assignees[0])
      deadline = adjusted
      if (adjusted.getTime() !== raw.getTime()) {
        // Holiday audit trail (written after commit so a rollback leaves no orphan entry).
        effects.push(() =>
          this.holidaysService.adjustDeadline(raw, orgId, undefined, people.assignees[0], 'workflow_step', row.id, snap.title),
        )
      }
    }
    const taskId = await createStepTask(tx, {
      orgId,
      instanceId: inst.id,
      rowId: row.id,
      snap,
      assigneeIds: people.assignees,
      ccIds: people.ccs,
      escalationLevels: people.escalationLevels,
      statusId: await defaultStatusId(tx, orgId),
      deadline,
      now,
    })
    await tx.workflowInstanceStep.update({
      where: { id: row.id },
      data: {
        ...(opts.status ? { status: opts.status } : {}),
        task_id: taskId,
        task_created_at: now,
        assigned_to_user_id: people.assignees[0],
        scheduled_at: deadline,
        last_error: people.warning,
      },
    })

    const link = `/dashboard/tasks/${taskId}`
    // Notes left for this step ("For a later step") travel with its assignment.
    const notes = await notesSummary(tx, inst, row.id)
    effects.push(
      this.support.notify(orgId, people.assignees, 'workflow_step_assigned', 'Step assigned to you',
        `“${snap.title}” in “${inst.templateName}” (${inst.name}).${notes ? ` ${notes}` : ''}`, link, inst.id),
      this.support.notify(orgId, people.ccs, 'workflow_step_assigned', 'You were CC’d on a step',
        `“${snap.title}” in “${inst.templateName}” (${inst.name}).`, link, inst.id),
    )
    if (people.warning) {
      effects.push(
        this.support.notify(orgId, inst.editorIds.filter((o) => !people.assignees.includes(o)), 'workflow_stuck',
          'Step needs attention', `“${snap.title}” in “${inst.name}”: ${people.warning}`,
          instanceLink(inst.workflow_template_id, inst.id), inst.id),
      )
    }
    return { taskId, people, deadline }
  }

  /**
   * pending → active: resolve people, compute the deadline (step start = now), create
   * the task. Guarded on `status = pending`, so a step activates at most once.
   * `earlyBy` = "Start now" by that person (a waiting row started before its time).
   */
  async activateRow(
    tx: Tx,
    inst: InstanceCtx,
    row: StepRow,
    now: Date,
    tz: string,
    effects: Effect[],
    opts: { snap?: StepSnapshot; earlyBy?: { userId: string; name: string } } = {},
  ): Promise<boolean> {
    const snap = opts.snap ?? (await requireSnapshot(tx, inst, row))
    const claimed = await tx.workflowInstanceStep.updateMany({
      where: { id: row.id, status: 'pending' },
      data: { status: 'active' },
    })
    if (claimed.count !== 1) return false

    const { taskId, people, deadline } = await this.giveRowTask(tx, inst, row, snap, now, tz, effects)
    await tx.workflowInstance.update({ where: { id: inst.id }, data: { current_step_id: row.id } })
    const who = await userNames(tx, people.assignees)
    await this.support.event(tx, {
      orgId: inst.organization_id,
      instanceId: inst.id,
      rowId: row.id,
      type: 'step_started',
      actorUserId: opts.earlyBy?.userId ?? null,
      message: opts.earlyBy
        ? `“${snap.title}” started early by ${opts.earlyBy.name}. Assigned to ${who}.`
        : `“${snap.title}” started. Assigned to ${who}.`,
      metadata: {
        task_id: taskId,
        assignee_ids: people.assignees,
        cc_ids: people.ccs,
        escalation_source: people.escalationSource,
        deadline: deadline.toISOString(),
        ...(opts.earlyBy ? { started_early: true, scheduled_start: row.start_at?.toISOString() ?? null } : {}),
        ...(people.warning ? { warning: people.warning } : {}),
      },
      at: now,
    })
    return true
  }

  /**
   * A row whose steps-before are all done: start it now, or — when its timing says
   * later — mark it waiting (`start_at`, still pending, no task) for the tick. A row
   * already waiting starts once its time has come. Returns what happened.
   */
  private async startOrWait(
    tx: Tx,
    inst: InstanceCtx,
    row: StepRow,
    now: Date,
    tz: string,
    effects: Effect[],
  ): Promise<'started' | 'waiting' | 'none'> {
    if (row.start_at) {
      if (row.start_at.getTime() > now.getTime()) return 'waiting'
      return (await this.activateRow(tx, inst, row, now, tz, effects)) ? 'started' : 'none'
    }
    const snap = await requireSnapshot(tx, inst, row)
    const startAt = await this.support.startTimeFor(inst, row, snap, now, tz)
    if (startAt.getTime() <= now.getTime()) {
      return (await this.activateRow(tx, inst, row, now, tz, effects, { snap })) ? 'started' : 'none'
    }
    const marked = await tx.workflowInstanceStep.updateMany({
      where: { id: row.id, status: 'pending', start_at: null },
      data: { start_at: startAt },
    })
    if (marked.count !== 1) return 'none'
    await this.support.event(tx, {
      orgId: inst.organization_id,
      instanceId: inst.id,
      rowId: row.id,
      type: 'step_waiting',
      message: `“${snap.title}” will start ${formatStartMoment(startAt, tz)}.`,
      metadata: { start_at: startAt.toISOString(), start_rule: snap.start_rule?.kind ?? 'immediate' },
      at: now,
    })
    return 'waiting'
  }

  /**
   * Activate every pending step whose dependencies are all satisfied; complete the run
   * when every step is completed or skipped. Idempotent. `resume` brings a stuck run
   * back to running (a completion / skip / retry is progress).
   */
  async settle(
    tx: Tx,
    inst: InstanceCtx,
    now: Date,
    tz: string,
    effects: Effect[],
    opts: { resume?: boolean } = {},
  ): Promise<void> {
    if (opts.resume) {
      await tx.workflowInstance.updateMany({
        where: { id: inst.id, status: { in: ADVANCEABLE } },
        data: { status: 'running', last_error: null },
      })
    }
    const rows = await tx.workflowInstanceStep.findMany({ where: { workflow_instance_id: inst.id } })
    const deps = rowDependencies(rows)
    const status = new Map(rows.map((r) => [r.id, r.status]))
    // A waiting row whose steps-before are no longer all done (one was reopened) waits
    // again from scratch: its start is worked out anew when they are done again.
    for (const r of rows) {
      if (isWaitingRow(r) && !(deps.get(r.id) ?? []).every((d) => isSatisfied(status.get(d) ?? 'pending'))) {
        await tx.workflowInstanceStep.updateMany({ where: { id: r.id, status: 'pending' }, data: { start_at: null } })
      }
    }
    const ready = readyRows(rows, deps)
    for (const r of ready) await this.startOrWait(tx, inst, r, now, tz, effects)
    if (ready.length || !runFinished(rows)) return

    const done = await tx.workflowInstance.updateMany({
      where: { id: inst.id, status: { in: ADVANCEABLE } },
      data: { status: 'completed', completed_at: now, last_error: null },
    })
    if (done.count !== 1) return
    await this.support.event(tx, {
      orgId: inst.organization_id,
      instanceId: inst.id,
      type: 'run_completed',
      message: `“${inst.name}” is complete.`,
      at: now,
    })
    effects.push(
      this.support.notify(inst.organization_id, inst.editorIds, 'workflow_completed', 'Instance completed',
        `“${inst.name}” (${inst.templateName}) is complete.`,
        instanceLink(inst.workflow_template_id, inst.id), inst.id),
    )
  }

  /** Throws on failure (callers decide whether that's a 400 or a stuck run). */
  async completeRowNow(row: StepRow): Promise<void> {
    const orgId = row.organization_id
    const inst = await loadInstanceCtx(this.prisma, orgId, row.workflow_instance_id)
    if (!inst || !ADVANCEABLE.includes(inst.status as 'running')) return
    const now = await this.clock.now(orgId)
    const tz = await this.support.orgTimeZone(orgId)
    const effects: Effect[] = []
    await this.prisma.$transaction(async (tx) => {
      await lockInstance(tx, inst.id)
      const done = await this.markRowCompleted(tx, inst, row.id, now, tz, effects)
      if (done) await this.settle(tx, inst, now, tz, effects, { resume: true })
    }, TX_OPTIONS)
    await this.support.runEffects(effects)
  }

  /**
   * open → completed, with the send-back bookkeeping:
   *  - the row was a send-back TARGET (`returned_to_row_id`) → the run returns
   *    straight to the sender (which resumes; intermediate steps are not redone);
   *  - the row was itself PAUSED (sent_back) → its completion is accepted; the target
   *    keeps its task open but no longer returns here.
   * Returns false when another actor got there first. Caller settles the graph.
   */
  async markRowCompleted(
    tx: Tx,
    inst: InstanceCtx,
    rowId: string,
    now: Date,
    tz: string,
    effects: Effect[],
    actorUserId: string | null = null,
  ): Promise<boolean> {
    const cur = await tx.workflowInstanceStep.findUnique({ where: { id: rowId } })
    if (!cur || !isOpen(cur.status)) return false
    const res = await tx.workflowInstanceStep.updateMany({
      where: { id: rowId, status: { in: OPEN_ROW } },
      data: { status: 'completed', completed_at: now, last_error: null, waiting_on_row_id: null, returned_to_row_id: null },
    })
    if (res.count !== 1) return false
    const title = titleOf(cur)

    let message = `“${title}” was completed.`
    if (cur.status === 'sent_back' && cur.waiting_on_row_id) {
      const target = await tx.workflowInstanceStep.findUnique({ where: { id: cur.waiting_on_row_id } })
      await tx.workflowInstanceStep.updateMany({
        where: { id: cur.waiting_on_row_id, returned_to_row_id: cur.id },
        data: { returned_to_row_id: null },
      })
      message = `“${title}” was completed while waiting for “${target ? titleOf(target) : 'an earlier step'}”, which will no longer return here.`
    } else if (cur.status === 'moved_on') {
      message = `“${title}” was completed late. The next steps had already started.`
    }
    await this.support.event(tx, {
      orgId: inst.organization_id,
      instanceId: inst.id,
      rowId,
      type: 'step_completed',
      actorUserId,
      message,
      metadata: { previous_status: cur.status, task_id: cur.task_id },
      at: now,
    })
    if (cur.returned_to_row_id && !isBranchRow(cur)) {
      await this.resumeSender(tx, inst, cur, cur.returned_to_row_id, now, tz, effects)
    }
    return true
  }

  /**
   * The send-back target `target` is done again → the paused sender resumes. Its task
   * deadline is EXTENDED BY THE TIME IT WAITED (pause = the `sent_back` event's
   * timestamp → now), holiday-adjusted and recorded as a deadline revision; its
   * escalations re-arm. A sender that was already overdue when it sent the run back
   * resumes as overdue if the extended deadline is still past.
   */
  async resumeSender(
    tx: Tx,
    inst: InstanceCtx,
    target: StepRow,
    senderId: string,
    now: Date,
    tz: string,
    effects: Effect[],
  ): Promise<void> {
    const orgId = inst.organization_id
    const sender = await tx.workflowInstanceStep.findFirst({ where: { id: senderId, workflow_instance_id: inst.id } })
    if (!sender || sender.status !== 'sent_back' || sender.waiting_on_row_id !== target.id) return
    const senderSnap = readSnapshot(sender.step_snapshot)
    const senderTitle = titleOf(sender, senderSnap)
    const targetTitle = titleOf(target)

    const pausedEvent = await tx.workflowInstanceEvent.findFirst({
      where: { workflow_instance_id: inst.id, instance_step_id: sender.id, type: 'sent_back' },
      orderBy: { created_at: 'desc' },
      select: { created_at: true, metadata: true },
    })
    const fromStatus = (pausedEvent?.metadata as { from_status?: unknown } | null)?.from_status
    const pausedMs = pausedEvent ? Math.max(0, now.getTime() - pausedEvent.created_at.getTime()) : 0

    const task = sender.task_id
      ? await tx.task.findFirst({
          where: { id: sender.task_id, organization_id: orgId, is_deleted: false },
          select: { id: true, deadline: true },
        })
      : null
    let deadline = task?.deadline ?? sender.scheduled_at ?? null
    if (task) {
      if (task.deadline && pausedMs > 0) {
        const workers = await taskWorkers(tx, orgId, task.id)
        const raw = new Date(task.deadline.getTime() + pausedMs)
        deadline = (await this.holidaysService.adjustDeadline(raw, orgId, undefined, workers[0])) ?? raw
        await moveTaskDeadline(tx, {
          orgId,
          taskId: task.id,
          newDeadline: deadline,
          actorUserId: senderSnap?.assigner_user_id ?? inst.editorIds[0],
          reason: `Extended while “${senderTitle}” waited for “${targetTitle}”.`,
          now,
        })
      }
      await setEscalationsPaused(tx, orgId, task.id, false)
    }
    const stillLate = fromStatus === 'overdue' && !!deadline && deadline.getTime() <= now.getTime()
    const res = await tx.workflowInstanceStep.updateMany({
      where: { id: sender.id, status: 'sent_back', waiting_on_row_id: target.id },
      data: { status: stillLate ? 'overdue' : 'active', waiting_on_row_id: null, scheduled_at: deadline },
    })
    if (res.count !== 1) return
    await tx.workflowInstance.update({ where: { id: inst.id }, data: { current_step_id: sender.id } })
    await this.support.event(tx, {
      orgId,
      instanceId: inst.id,
      rowId: sender.id,
      type: 'returned',
      message: `“${targetTitle}” is done again. The instance is back at “${senderTitle}”.`,
      metadata: {
        from_row_id: target.id,
        to_row_id: sender.id,
        paused_ms: pausedMs,
        new_deadline: deadline?.toISOString() ?? null,
      },
      at: now,
    })
    const workers = await taskWorkers(tx, orgId, sender.task_id)
    effects.push(
      this.support.notify(orgId, workers, 'workflow_sent_back', 'Step back with you',
        `“${targetTitle}” is done again, so “${senderTitle}” in “${inst.name}” can continue.` +
          (deadline && pausedMs > 0 ? ` Its deadline moved to ${formatHumanDate(deadline, tz)}.` : ''),
        sender.task_id ? `/dashboard/tasks/${sender.task_id}` : instanceLink(inst.workflow_template_id, inst.id), inst.id),
    )
  }

  // ═══ Send back ═══════════════════════════════════════════════════════════════
}
