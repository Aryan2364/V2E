import { ADVANCEABLE, DAY_MS, EDITORS_SELECT, Effect, StepRow, TERMINAL_TASK_TYPES, TX_OPTIONS, editorsOf, errorMessage, instanceLink, isWaitingRow, loadInstanceCtx, lockInstance, snapshotFor, taskWorkers, userNames } from './workflow-engine.shared'
import { AuditWriterService } from '../audit/audit-writer.service'
import { ClockService } from '../clock/clock.service'
import { Cron } from '@nestjs/schedule'
import { runExclusive } from '../common/run-exclusive'
import { swallow } from '../common/swallow'
import { Injectable, Logger } from '@nestjs/common'
import { NotificationsService } from '../notifications/notifications.service'
import { PrismaService } from '../prisma/prisma.service'
import { SCHEDULE_START, dueScheduleOccurrence } from './engine/schedule'
import { WorkflowEngineRowsService } from './workflow-engine-rows.service'
import { WorkflowEngineService } from './workflow-engine.service'
import { WorkflowEngineSupportService } from './workflow-engine-support.service'
import { formatHumanDate } from './engine/tz'
import { isBranchRow } from './engine/snapshot'
import { isSatisfied, rowDependencies } from './engine/dag'

/** The three workflow cron sweeps (late steps, schedules, waiting steps) and their org-scoped bodies. */
@Injectable()
export class WorkflowSweepsService {
  private readonly logger = new Logger(WorkflowSweepsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly auditWriter: AuditWriterService,
    private readonly clock: ClockService,
    private readonly support: WorkflowEngineSupportService,
    private readonly rows: WorkflowEngineRowsService,
    private readonly engine: WorkflowEngineService,
  ) {}

  @Cron('*/15 * * * *')
  async processOverdueSteps(): Promise<void> {
    return runExclusive('WorkflowEngineService.processOverdueSteps', async () => {
      const orgs = await this.prisma.organization.findMany({ where: { is_test: false }, select: { id: true } })
      for (const org of orgs) {
        try {
          await this.processOverdueStepsForOrg(org.id, new Date())
        } catch (err) {
          this.logger.error(`Workflow late sweep failed for org ${org.id}: ${(err as Error)?.stack ?? err}`)
        }
      }
    })
  }

  /** Org-scoped, now-injected — cron passes real now, ReplayService passes sim now. */
  async processOverdueStepsForOrg(orgId: string, now: Date): Promise<void> {
    if (!(await this.support.automationEnabled(orgId))) return
    return this.auditWriter.runAsSystem(
      { orgId, triggerSource: 'workflow_overdue', occurredAt: now },
      () => this.processOverdueStepsForOrgImpl(orgId, now),
    )
  }

  private async processOverdueStepsForOrgImpl(orgId: string, now: Date): Promise<void> {
    const rows = await this.prisma.workflowInstanceStep.findMany({
      where: { organization_id: orgId, status: 'active', instance: { status: { in: ADVANCEABLE } } },
    })
    if (!rows.length) return
    const tz = await this.support.orgTimeZone(orgId)
    for (const row of rows) {
      try {
        await this.handleLateRow(orgId, row, now, tz)
      } catch (err) {
        this.logger.error(`Late handling failed for workflow step ${row.id}: ${(err as Error)?.stack ?? err}`)
        await this.prisma.workflowInstanceStep
          .update({ where: { id: row.id }, data: { last_error: errorMessage(err) } })
          .catch(swallow('workflow-engine.processOverdueStepsForOrgImpl', null))
      }
    }
  }

  /**
   * First time an active step's task is past its CURRENT deadline: `step_late` event
   * and the owners, escalation contacts and assignees are told. If late = `wait` → the
   * row goes `overdue` (dependents keep waiting); `move_on` → `moved_on` and its
   * dependents start (the late task stays open). The task's own TaskEscalation rows
   * fire through the scheduler — not duplicated here.
   */
  private async handleLateRow(orgId: string, row: StepRow, now: Date, tz: string): Promise<void> {
    if (!row.task_id) return
    const task = await this.prisma.task.findFirst({
      where: { id: row.task_id, organization_id: orgId },
      select: { deadline: true, is_deleted: true, status: { select: { type: true } } },
    })
    if (!task || task.is_deleted || TERMINAL_TASK_TYPES.includes(task.status.type)) return
    if (!task.deadline || task.deadline.getTime() >= now.getTime()) return

    const inst = await loadInstanceCtx(this.prisma, orgId, row.workflow_instance_id)
    if (!inst || !ADVANCEABLE.includes(inst.status as 'running')) return
    const effects: Effect[] = []
    const deadline = task.deadline

    await this.prisma.$transaction(async (tx) => {
      await lockInstance(tx, inst.id)
      const snap = await snapshotFor(tx, row, inst.workflow_template_id)
      const title = snap?.title ?? 'A step'
      const moveOn = snap?.if_late === 'move_on' && !isBranchRow(row)
      const res = await tx.workflowInstanceStep.updateMany({
        where: { id: row.id, status: 'active' },
        data: { status: moveOn ? 'moved_on' : 'overdue' },
      })
      if (res.count !== 1) return

      const workers = await taskWorkers(tx, orgId, row.task_id)
      const contacts = (
        await tx.taskEscalation.findMany({
          where: { task_id: row.task_id!, organization_id: orgId, is_active: true },
          select: { escalate_to_user_id: true },
        })
      ).map((e) => e.escalate_to_user_id)
      const due = formatHumanDate(deadline, tz)
      const who = await userNames(tx, workers)
      await this.support.event(tx, {
        orgId,
        instanceId: inst.id,
        rowId: row.id,
        type: 'step_late',
        message: `“${title}” is late (due ${due}). Waiting on ${who}.`,
        metadata: { deadline: deadline.toISOString(), if_late: moveOn ? 'move_on' : 'wait', task_id: row.task_id },
        at: now,
      })
      if (moveOn) {
        await this.support.event(tx, {
          orgId,
          instanceId: inst.id,
          rowId: row.id,
          type: 'step_moved_on',
          message: `The instance continued past “${title}”. Its task stays open.`,
          at: now,
        })
        await this.rows.settle(tx, inst, now, tz, effects)
      }
      const consequence = moveOn
        ? 'The next steps have started. The task stays open.'
        : 'The next steps wait until it is done.'
      effects.unshift(
        this.support.notify(orgId, [...inst.editorIds, ...contacts, ...workers], 'workflow_step_late', 'Step is late',
          `“${title}” in “${inst.name}” is late (due ${due}, ${who}). ${consequence}`,
          instanceLink(inst.workflow_template_id, inst.id), inst.id),
      )
    }, TX_OPTIONS)
    await this.support.runEffects(effects)
  }

  // ═══ Cron: schedules ═════════════════════════════════════════════════════════

  /**
   * Every 15 minutes. Real orgs run at the wall clock. Simulated test orgs are driven
   * day-by-day by ReplayService; this tick only tops them up to the instant replay has
   * already reached (`sim_replayed_until`), so an occurrence later on the current
   * simulated day still fires without skipping replay's earlier days.
   */
  @Cron('*/15 * * * *')
  async processSchedules(): Promise<void> {
    return runExclusive('WorkflowEngineService.processSchedules', async () => {
      const orgs = await this.prisma.organization.findMany({
        where: { OR: [{ is_test: false }, { is_test: true, sim_epoch: { not: null }, sim_replayed_until: { not: null } }] },
        select: { id: true, is_test: true, sim_replayed_until: true },
      })
      for (const org of orgs) {
        try {
          const now = org.is_test ? org.sim_replayed_until! : new Date()
          await this.processSchedulesForOrg(org.id, now)
        } catch (err) {
          this.logger.error(`Schedule sweep failed for org ${org.id}: ${(err as Error)?.stack ?? err}`)
        }
      }
    })
  }

  /** Org-scoped, now-injected — cron passes real now, ReplayService passes the sim day. */
  async processSchedulesForOrg(orgId: string, now: Date): Promise<void> {
    if (!(await this.support.automationEnabled(orgId))) return
    // Never fire "in the future" of the org's own clock (replay passes end-of-day).
    const orgNow = await this.clock.now(orgId)
    const at = now.getTime() > orgNow.getTime() ? orgNow : now
    return this.auditWriter.runAsSystem(
      { orgId, triggerSource: 'workflow_schedule', occurredAt: at },
      () => this.processSchedulesForOrgImpl(orgId, at),
    )
  }

  /**
   * Fire each due schedule entry of every LIVE (active) workflow — drafts never fire,
   * paused ones skip (and are not caught up on resume). One run per occurrence: the
   * entry's marker is claimed atomically first, so overlapping ticks / replay never
   * double-fire. Missed occurrences collapse into the latest one. An "after N" entry
   * counts each fired occurrence and retires at N.
   */
  private async processSchedulesForOrgImpl(orgId: string, now: Date): Promise<void> {
    const entries = await this.prisma.workflowScheduleEntry.findMany({
      where: { organization_id: orgId, is_active: true, template: { status: 'active', organization_id: orgId } },
      include: { template: { select: { name: true, ...EDITORS_SELECT } } },
      orderBy: [{ workflow_template_id: 'asc' }, { order_index: 'asc' }],
    })
    if (!entries.length) return
    const tz = await this.support.orgTimeZone(orgId)
    for (const entry of entries) {
      try {
        const lower = entry.last_fired_at ?? new Date(entry.created_at.getTime() - 1)
        const occurrence = dueScheduleOccurrence(entry, lower, now, tz)
        if (!occurrence) continue
        const count = entry.occurrence_count + 1
        const spent = entry.end_condition === 'after_n' && entry.end_after !== null && count >= entry.end_after
        const claim = await this.prisma.workflowScheduleEntry.updateMany({
          where: { id: entry.id, organization_id: orgId, is_active: true, last_fired_at: entry.last_fired_at },
          data: { last_fired_at: occurrence, occurrence_count: { increment: 1 }, ...(spent ? { is_active: false } : {}) },
        })
        if (claim.count !== 1) continue
        // Start at the occurrence itself (replay walks simulated days, so "now" is the
        // end of that day) — unless it was missed by more than a day, in which case the
        // run starts now so its deadlines aren't already blown.
        const startAt = now.getTime() - occurrence.getTime() <= 24 * 3600_000 ? occurrence : now
        try {
          await this.engine.createInstance(
            orgId,
            entry.workflow_template_id,
            SCHEDULE_START,
            { schedule_entry_id: entry.id, scheduled_for: occurrence.toISOString() },
            null,
            { startAt },
          )
        } catch (err) {
          const message = errorMessage(err)
          this.logger.error(`Schedule ${entry.id} could not start its workflow: ${message}`)
          await this.support.runEffects([
            () =>
              this.notifications.emit({
                orgId,
                module: 'workflows',
                event_type: 'workflow_stuck',
                recipients: editorsOf(entry.template),
                title: 'Scheduled instance didn’t start',
                body: `“${entry.template.name}” was due to start ${formatHumanDate(occurrence, tz)}: ${message}`,
                link: `/dashboard/tasks/workflows/${entry.workflow_template_id}`,
                entity: { type: 'workflow_template', id: entry.workflow_template_id },
              }),
          ])
        }
      } catch (err) {
        this.logger.error(`Schedule ${entry.id} failed: ${(err as Error)?.stack ?? err}`)
      }
    }
  }
  // ═══ Cron: waiting steps ═════════════════════════════════════════════════════

  /**
   * Every 15 minutes: start the WAITING rows whose start time has come. Same org set and
   * clock as the schedule tick (real orgs at the wall clock; simulated orgs topped up to
   * `sim_replayed_until` — ReplayService also calls it day by day).
   */
  @Cron('*/15 * * * *')
  async processWaitingSteps(): Promise<void> {
    return runExclusive('WorkflowEngineService.processWaitingSteps', async () => {
      const orgs = await this.prisma.organization.findMany({
        where: { OR: [{ is_test: false }, { is_test: true, sim_epoch: { not: null }, sim_replayed_until: { not: null } }] },
        select: { id: true, is_test: true, sim_replayed_until: true },
      })
      for (const org of orgs) {
        try {
          const now = org.is_test ? org.sim_replayed_until! : new Date()
          await this.processWaitingStepsForOrg(org.id, now)
        } catch (err) {
          this.logger.error(`Waiting-step sweep failed for org ${org.id}: ${(err as Error)?.stack ?? err}`)
        }
      }
    })
  }

  /** Org-scoped, now-injected — cron passes real now, ReplayService passes the sim day. */
  async processWaitingStepsForOrg(orgId: string, now: Date): Promise<void> {
    if (!(await this.support.automationEnabled(orgId))) return
    // Never act "in the future" of the org's own clock (replay passes end-of-day).
    const orgNow = await this.clock.now(orgId)
    const at = now.getTime() > orgNow.getTime() ? orgNow : now
    return this.auditWriter.runAsSystem(
      { orgId, triggerSource: 'workflow_step_start', occurredAt: at },
      () => this.processWaitingStepsForOrgImpl(orgId, at),
    )
  }

  private async processWaitingStepsForOrgImpl(orgId: string, now: Date): Promise<void> {
    const rows = await this.prisma.workflowInstanceStep.findMany({
      where: { organization_id: orgId, status: 'pending', start_at: { not: null }, instance: { status: { in: ADVANCEABLE } } },
      select: { id: true, workflow_instance_id: true, start_at: true },
    })
    const due = rows.filter((r) => r.start_at && r.start_at.getTime() <= now.getTime())
    if (!due.length) return
    const tz = await this.support.orgTimeZone(orgId)
    for (const r of due) {
      try {
        await this.startWaitingRow(orgId, r.workflow_instance_id, r.id, now, tz)
      } catch (err) {
        this.logger.error(`Starting waiting workflow step ${r.id} failed: ${(err as Error)?.stack ?? err}`)
        await this.support.markStuck(orgId, r.workflow_instance_id, r.id, errorMessage(err))
      }
    }
  }

  /**
   * Start one waiting row whose time has come, if its steps-before are still all done
   * (else it waits again from scratch). The step starts AT its start time when the tick
   * is less than a day late (replay walks whole days), else now.
   */
  private async startWaitingRow(orgId: string, instanceId: string, rowId: string, now: Date, tz: string): Promise<void> {
    const inst = await loadInstanceCtx(this.prisma, orgId, instanceId)
    if (!inst || !ADVANCEABLE.includes(inst.status as 'running')) return
    const effects: Effect[] = []
    await this.prisma.$transaction(async (tx) => {
      await lockInstance(tx, instanceId)
      const rows = await tx.workflowInstanceStep.findMany({ where: { workflow_instance_id: instanceId, organization_id: orgId } })
      const row = rows.find((r) => r.id === rowId)
      if (!row || !isWaitingRow(row) || row.start_at!.getTime() > now.getTime()) return
      const status = new Map(rows.map((r) => [r.id, r.status]))
      const deps = rowDependencies(rows).get(row.id) ?? []
      if (!deps.every((d) => isSatisfied(status.get(d) ?? 'pending'))) {
        await tx.workflowInstanceStep.updateMany({ where: { id: row.id, status: 'pending' }, data: { start_at: null } })
        return
      }
      const startAt = now.getTime() - row.start_at!.getTime() <= DAY_MS ? row.start_at! : now
      await this.rows.activateRow(tx, inst, row, startAt, tz, effects)
    }, TX_OPTIONS)
    await this.support.runEffects(effects)
  }
}
