import { ADVANCEABLE, Effect, InstanceCtx, StepRow, TimelineStepInput, Tx, WorkflowEventType, WorkflowNotifEvent, instanceLink, loadInstanceCtx, timingCtx } from './workflow-engine.shared'
import { ClockService } from '../clock/clock.service'
import { HolidaysService } from '../holidays/holidays.service'
import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { NotificationsService } from '../notifications/notifications.service'
import { PlanWarning, PlannedStep, planRun, resolveDue, resolveStart, sameTimeNextDay } from './engine/plan'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { StepSnapshot } from './engine/snapshot'
import { computeDueDeadline } from './engine/deadline'
import { isCalendarRule } from './engine/timing'
import { localDateOf, safeTimeZone } from './engine/tz'

/**
 * Engine plumbing shared by every workflow service: automation entitlement, org time zone,
 * post-commit effects, notifications, run-history events, deadline/timeline planning and
 * the "park the run as stuck" path. Holds no orchestration of its own.
 */
@Injectable()
export class WorkflowEngineSupportService {
  private readonly logger = new Logger(WorkflowEngineSupportService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly holidaysService: HolidaysService,
    private readonly notifications: NotificationsService,
    private readonly clock: ClockService,
  ) {}

  async automationEnabled(orgId: string): Promise<boolean> {
    const entitlement = await this.prisma.orgModuleEntitlement.findUnique({
      where: { organization_id_module_key: { organization_id: orgId, module_key: 'workflows' } },
      select: { state: true },
    })
    return entitlement?.state === 'full'
  }

  async orgTimeZone(orgId: string): Promise<string> {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { timezone: true } })
    return safeTimeZone(org?.timezone)
  }

  async runEffects(effects: Effect[]): Promise<void> {
    for (const e of effects) {
      try {
        await e()
      } catch (err) {
        this.logger.warn(`Workflow post-commit effect failed: ${(err as Error)?.message ?? err}`)
      }
    }
  }

  notify(
    orgId: string,
    recipients: (string | null | undefined)[],
    event: WorkflowNotifEvent,
    title: string,
    body: string,
    link: string,
    instanceId: string,
  ): Effect {
    const unique = Array.from(new Set(recipients.filter((r): r is string => !!r)))
    return async () => {
      if (!unique.length) return
      await this.notifications.emit({
        orgId,
        module: 'workflows',
        event_type: event,
        recipients: unique,
        title,
        body,
        link,
        entity: { type: 'workflow_instance', id: instanceId },
      })
    }
  }

  // Events written in one transaction share the same `now`; History sorts by
  // created_at, so give each later event in the same transaction its own +1ms to
  // keep "A completed" ahead of "B started" / "returned".
  private readonly eventClock = new WeakMap<object, number>()

  async event(
    tx: Tx,
    e: {
      orgId: string
      instanceId: string
      rowId?: string | null
      type: WorkflowEventType
      actorUserId?: string | null
      message: string
      metadata?: Record<string, unknown>
      at: Date
    },
  ): Promise<void> {
    let at = e.at.getTime()
    const last = this.eventClock.get(tx as object)
    if (last !== undefined && at <= last) at = last + 1
    this.eventClock.set(tx as object, at)
    await tx.workflowInstanceEvent.create({
      data: {
        organization_id: e.orgId,
        workflow_instance_id: e.instanceId,
        instance_step_id: e.rowId ?? null,
        type: e.type,
        actor_user_id: e.actorUserId ?? null,
        message: e.message.slice(0, 4000),
        metadata: e.metadata ? (JSON.parse(JSON.stringify(e.metadata)) as Prisma.InputJsonValue) : undefined,
        created_at: new Date(at),
      },
    })
  }

  /**
   * Append a run-history entry from outside the engine (the API writes `file_added` /
   * `file_removed`). Stamped with the org clock. Scoped by organization.
   */
  async recordEvent(
    orgId: string,
    instanceId: string,
    type: WorkflowEventType,
    message: string,
    opts: { rowId?: string | null; actorUserId?: string | null; metadata?: Record<string, unknown> } = {},
  ): Promise<void> {
    const inst = await this.prisma.workflowInstance.findFirst({
      where: { id: instanceId, organization_id: orgId },
      select: { id: true },
    })
    if (!inst) throw new NotFoundException('Instance not found')
    const at = await this.clock.now(orgId)
    await this.event(this.prisma, { orgId, instanceId, type, message, at, ...opts })
  }

  /**
   * The step's deadline for a start at `startAt`, through the holiday rules (workflows
   * never skip: null ⇒ keep raw).
   *  - Calendar due rule → the row's PLANNED due (already holiday-adjusted when the run
   *    was planned) — kept even when a predecessor ran late, so lateness stays visible.
   *    A row without a plan resolves the next occurrence strictly after the start.
   *  - Relative / legacy due → the start day + N days at the due time (as before).
   */
  async stepDeadline(
    inst: InstanceCtx,
    row: Pick<StepRow, 'planned_due_at'>,
    snap: StepSnapshot,
    startAt: Date,
    tz: string,
    userId: string | undefined,
  ): Promise<{ raw: Date; adjusted: Date }> {
    const orgId = inst.organization_id
    if (isCalendarRule(snap.due_rule) && row.planned_due_at) {
      return { raw: row.planned_due_at, adjusted: row.planned_due_at }
    }
    const raw = snap.due_rule
      ? resolveDue(snap.due_rule, startAt, timingCtx(inst, snap, tz))
      : computeDueDeadline(startAt, snap.due_days, snap.due_time, tz)
    const adjusted = (await this.holidaysService.adjustDeadline(raw, orgId, undefined, userId)) ?? raw
    return { raw, adjusted }
  }

  // ═══ Step timing ═════════════════════════════════════════════════════════════

  /**
   * Holiday callbacks for planning / activation, memoised for one plan: a computed
   * start on a holiday or weekly off moves to the next working day at the same time
   * (HolidaysService's working-day rules, read for the org-local calendar day); a due
   * date goes through the usual deadline adjustment.
   */
  private holidayCallbacks(orgId: string, tz: string, userOf: (key: string) => string | null | undefined = () => null) {
    const working = new Map<string, Promise<boolean>>()
    const adjusted = new Map<string, Promise<Date>>()
    const isWorking = (instant: Date, userId: string | undefined): Promise<boolean> => {
      const d = localDateOf(instant, tz)
      const k = `${d.year}-${d.month}-${d.day}|${userId ?? ''}`
      let hit = working.get(k)
      if (!hit) {
        // HolidaysService reads server-local calendar fields; noon of the org-local day
        // in server-local time makes those fields the org's day whatever the server TZ.
        hit = this.holidaysService.isWorkingDay(new Date(d.year, d.month - 1, d.day, 12), orgId, undefined, userId)
        working.set(k, hit)
      }
      return hit
    }
    const shift = async (instant: Date, userId: string | undefined): Promise<Date> => {
      let cur = instant
      for (let i = 0; i < 60; i++) {
        if (await isWorking(cur, userId)) return cur
        cur = sameTimeNextDay(cur, tz)
      }
      return instant
    }
    const adjust = (instant: Date, userId: string | undefined): Promise<Date> => {
      const k = `${instant.getTime()}|${userId ?? ''}`
      let hit = adjusted.get(k)
      if (!hit) {
        hit = this.holidaysService.adjustDeadline(instant, orgId, undefined, userId).then((x) => x ?? instant)
        adjusted.set(k, hit)
      }
      return hit
    }
    return {
      shiftStart: (instant: Date, key: string) => shift(instant, userOf(key) ?? undefined),
      adjustDue: (instant: Date, key: string) => adjust(instant, userOf(key) ?? undefined),
      shiftFor: shift,
    }
  }

  /**
   * Plan a run's steps (planned start → due) with the org's holiday rules. The ONE
   * planning path: run creation stores it on the rows, the builder's example timeline
   * shows it. `every` = the cycle length from the workflow's schedules.
   */
  async planTimeline(
    orgId: string,
    tz: string,
    steps: TimelineStepInput[],
    runStart: Date,
    every: number,
  ): Promise<{ steps: PlannedStep[]; warnings: PlanWarning[] }> {
    const [plan] = await this.planTimelines(orgId, tz, steps, [runStart], every)
    return plan
  }

  /** `planTimeline` for several run starts, sharing one holiday lookup cache. */
  async planTimelines(
    orgId: string,
    tz: string,
    steps: TimelineStepInput[],
    runStarts: Date[],
    every: number,
  ): Promise<{ steps: PlannedStep[]; warnings: PlanWarning[] }[]> {
    const userOf = new Map(steps.map((s) => [s.key, s.holiday_user_id ?? null]))
    const cb = this.holidayCallbacks(orgId, tz, (k) => userOf.get(k))
    const out: { steps: PlannedStep[]; warnings: PlanWarning[] }[] = []
    for (const runStart of runStarts) out.push(await planRun(steps, { tz, runStart, every }, cb))
    return out
  }

  /**
   * When a row whose steps-before are all done (at `now`) should start:
   *  - immediate / legacy → now;
   *  - days_after_previous / time_of_day → computed now (from the moment it became
   *    ready), holiday-shifted;
   *  - days_after_run_start / calendar → max(planned start, now) (a row without a plan
   *    resolves from now).
   * Order always wins: this is only asked once the row may start.
   */
  async startTimeFor(inst: InstanceCtx, row: StepRow, snap: StepSnapshot, now: Date, tz: string): Promise<Date> {
    const rule = snap.start_rule
    if (!rule || rule.kind === 'immediate') return now
    const planned = rule.kind !== 'days_after_previous' && rule.kind !== 'time_of_day' ? row.planned_start_at : null
    if (planned) return planned.getTime() > now.getTime() ? planned : now
    const cb = this.holidayCallbacks(inst.organization_id, tz)
    const start = await cb.shiftFor(resolveStart(rule, now, timingCtx(inst, snap, tz)), snap.assignee_user_ids[0])
    return start.getTime() > now.getTime() ? start : now
  }

  /** Park an instance as stuck with a readable reason and tell the workflow's editors. Never throws. */
  async markStuck(orgId: string, instanceId: string, rowId: string | null, message: string): Promise<void> {
    try {
      const inst = await loadInstanceCtx(this.prisma, orgId, instanceId)
      if (!inst) return
      const now = await this.clock.now(orgId)
      const res = await this.prisma.workflowInstance.updateMany({
        where: { id: instanceId, status: { in: ADVANCEABLE } },
        data: { status: 'stuck', last_error: message },
      })
      if (rowId) {
        await this.prisma.workflowInstanceStep.updateMany({ where: { id: rowId }, data: { last_error: message } })
      }
      if (res.count === 1) {
        await this.event(this.prisma, { orgId, instanceId, rowId, type: 'run_stuck', message, at: now })
        await this.runEffects([
          this.notify(orgId, inst.editorIds, 'workflow_stuck', 'Instance needs attention',
            `“${inst.name}” (${inst.templateName}): ${message}`,
            instanceLink(inst.workflow_template_id, inst.id), inst.id),
        ])
      }
    } catch (err) {
      this.logger.error(`Could not mark workflow instance ${instanceId} stuck: ${(err as Error)?.message ?? err}`)
    }
  }

  // ═══ Instance naming + numbering ═════════════════════════════════════════════
}
