import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { HolidaysService } from '../holidays/holidays.service'
import { NotificationsService } from '../notifications/notifications.service'
import { AuditWriterService } from '../audit/audit-writer.service'
import { ClockService } from '../clock/clock.service'
import { computeDueDeadline } from './engine/deadline'
import {
  PlanStepInput,
  PlanWarning,
  PlannedStep,
  TimingContext,
  planRun,
  resolveDue,
  resolveStart,
  sameTimeNextDay,
} from './engine/plan'
import { cycleLengthOf, frequencyOf, isCalendarRule } from './engine/timing'
import { SCHEDULE_START, dueScheduleOccurrence } from './engine/schedule'
import {
  LiveChecklistTemplate,
  StepSnapshot,
  applyChecklistTemplates,
  buildStepSnapshot,
  isBranchRow,
  readSnapshot,
  snapshotTemplateIds,
} from './engine/snapshot'
import {
  OPEN_STATUSES,
  flowRows,
  isOpen,
  isSatisfied,
  readyRows,
  rowDependencies,
  runFinished,
  upstreamOf,
} from './engine/dag'
import { createStepTask, moveTaskDeadline, reopenTaskForWorkflow, setEscalationsPaused } from './engine/step-task'
import { formatHumanDate, localDateOf, safeTimeZone, zonedParts } from './engine/tz'
import { MAIN_TRACK, resolveStoredTracks } from './tracks'

type Tx = Prisma.TransactionClient
type Effect = () => Promise<unknown>

/** Instance states a run may move in. */
const ADVANCEABLE: ('running' | 'stuck')[] = ['running', 'stuck']
/** Row states with a live task the run waits on (or is paused on). */
const OPEN_ROW = [...OPEN_STATUSES] as ('active' | 'overdue' | 'moved_on' | 'sent_back')[]
/** Row states a step may send the run back from. */
const SENDABLE_ROW: ('active' | 'overdue')[] = ['active', 'overdue']
const TERMINAL_TASK_TYPES = ['completed', 'partially_completed', 'incomplete']

const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 }

const REASON_MIN = 5
const REASON_MAX = 2000

/** Every `WorkflowInstanceEvent.type` (run history). */
export type WorkflowEventType =
  | 'run_started'
  | 'step_waiting'
  | 'step_started'
  | 'step_completed'
  | 'step_late'
  | 'step_moved_on'
  | 'step_escalated'
  | 'sent_back'
  | 'returned'
  | 'step_skipped'
  | 'run_completed'
  | 'run_cancelled'
  | 'run_stuck'
  | 'retried'
  | 'file_added'
  | 'file_removed'

type WorkflowNotifEvent =
  | 'workflow_triggered'
  | 'workflow_step_assigned'
  | 'workflow_step_overdue'
  | 'workflow_upstream_delay'
  | 'workflow_completed'
  | 'workflow_stuck'
  | 'workflow_task_withdrawn'
  | 'workflow_sent_back'
  | 'workflow_step_late'

interface InstanceCtx {
  id: string
  organization_id: string
  workflow_template_id: string
  name: string
  started_at: Date
  templateName: string
  ownerIds: string[]
}

type StepRow = Prisma.WorkflowInstanceStepGetPayload<object>

/** A step of a plan (run creation / builder example) plus whose calendar it follows. */
export interface TimelineStepInput extends PlanStepInput {
  /** The person whose holidays / weekly offs apply (the step's first assignee). */
  holiday_user_id?: string | null
}

/** A pending row whose steps-before are done, waiting for its start time. */
export function isWaitingRow(row: { status: string; start_at?: Date | null }): boolean {
  return row.status === 'pending' && !!row.start_at
}

const DAY_MS = 86_400_000
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Fri 18 Oct, 9:00 AM" in the org time zone. */
export function formatStartMoment(instant: Date, tz: string): string {
  const p = zonedParts(instant, tz)
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12
  const mm = String(p.minute).padStart(2, '0')
  return `${WEEKDAY_SHORT[p.weekday]} ${p.day} ${MONTH_SHORT[p.month - 1]}, ${h12}:${mm} ${p.hour < 12 ? 'AM' : 'PM'}`
}

/** Who a step's task goes to, resolved at activation. */
interface StepPeople {
  assignees: string[]
  ccs: string[]
  /** TaskEscalation levels (index 0 = level 1); several users may share level 1. */
  escalationLevels: string[][]
  escalationSource: 'manager' | 'people' | 'owners_fallback' | 'none'
  warning: string | null
}

/**
 * The workflow engine (workflows v2 §B): runs are DAGs of steps; every step is a task
 * the system creates.
 *
 * Invariants:
 *  - The engine reads each row's frozen `step_snapshot`, never the live template step
 *    (rows without one fall back to the live step once and get frozen).
 *  - Every multi-row change is ONE `$transaction` that first locks the instance row
 *    (`SELECT … FOR UPDATE`), so concurrent completions of two join inputs serialise
 *    and the join is evaluated against committed state; activation is additionally
 *    guarded (`updateMany … status = pending`) so a step activates exactly once.
 *  - A row is SATISFIED (its dependents may start) when completed, skipped or
 *    moved_on; the run completes when every row is completed or skipped.
 *  - Cancelled / completed runs never move. Notifications run after commit.
 *  - Nothing called from a task action throws: failures park the run as `stuck`
 *    with `last_error`, owners are told, and `retryInstance` recovers.
 *  - Every state change writes a `WorkflowInstanceEvent` in the same transaction.
 *  - "Now" is always the org clock; wall-clock times are in the org's time zone;
 *    every deadline goes through the holiday rules.
 *  - Legacy runs (snapshots without `depends_on_step_ids`) are a straight sequence by
 *    order_index; legacy escalation rows are never part of the flow.
 */
@Injectable()
export class WorkflowEngineService {
  private readonly logger = new Logger(WorkflowEngineService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly holidaysService: HolidaysService,
    private readonly notifications: NotificationsService,
    private readonly auditWriter: AuditWriterService,
    private readonly clock: ClockService,
  ) {}

  // ═══ Small helpers ═══════════════════════════════════════════════════════════

  private async automationEnabled(orgId: string): Promise<boolean> {
    const entitlement = await this.prisma.orgModuleEntitlement.findUnique({
      where: { organization_id_module_key: { organization_id: orgId, module_key: 'workflows' } },
      select: { state: true },
    })
    return entitlement?.state === 'full'
  }

  private async orgTimeZone(orgId: string): Promise<string> {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { timezone: true } })
    return safeTimeZone(org?.timezone)
  }

  private ownersOf(template: { owner_user_ids: unknown; created_by_user_id: string }): string[] {
    const raw = Array.isArray(template.owner_user_ids) ? template.owner_user_ids : []
    const ids = raw.filter((x): x is string => typeof x === 'string' && x.length > 0)
    return ids.length ? Array.from(new Set(ids)) : [template.created_by_user_id]
  }

  private async runEffects(effects: Effect[]): Promise<void> {
    for (const e of effects) {
      try {
        await e()
      } catch (err) {
        this.logger.warn(`Workflow post-commit effect failed: ${(err as Error)?.message ?? err}`)
      }
    }
  }

  private instanceLink(templateId: string, instanceId: string): string {
    return `/dashboard/tasks/workflows/${templateId}/instances/${instanceId}`
  }

  private notify(
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

  /** A readable message for `last_error` from any thrown value. */
  private errorMessage(err: unknown): string {
    if (err instanceof HttpException) {
      const res = err.getResponse() as { message?: unknown } | string
      const msg = typeof res === 'string' ? res : Array.isArray(res?.message) ? res.message.join(' ') : res?.message
      if (typeof msg === 'string' && msg) return msg
    }
    const raw = (err as Error)?.message ?? String(err)
    const short = raw.replace(/\s+/g, ' ').trim().slice(0, 240)
    return `The run couldn’t continue (${short}). Fix the problem, then retry the run.`
  }

  /**
   * The status every workflow task is born in — mirrors TasksService: the org's
   * `not_started` status, then the `is_default` one, then the first active one.
   * Fails LOUDLY (never an empty id that would hit a foreign-key error).
   */
  private async defaultStatusId(tx: Tx, orgId: string): Promise<string> {
    const notStarted = await tx.taskStatus.findFirst({
      where: { organization_id: orgId, type: 'not_started', is_active: true },
      orderBy: { order_index: 'asc' },
      select: { id: true },
    })
    if (notStarted) return notStarted.id
    const flagged = await tx.taskStatus.findFirst({
      where: { organization_id: orgId, is_default: true, is_active: true },
      orderBy: { order_index: 'asc' },
      select: { id: true },
    })
    if (flagged) return flagged.id
    const any = await tx.taskStatus.findFirst({
      where: { organization_id: orgId, is_active: true },
      orderBy: { order_index: 'asc' },
      select: { id: true },
    })
    if (any) return any.id
    throw new BadRequestException(
      'Tasks can’t be created because there is no active task status. Add one in Task settings, then retry.',
    )
  }

  /** The subset of `ids` that are active members of the org, in the given order. */
  private async activeMembers(tx: Tx, orgId: string, ids: (string | null | undefined)[]): Promise<string[]> {
    const wanted = Array.from(new Set(ids.filter((x): x is string => !!x)))
    if (!wanted.length) return []
    const rows = await tx.organizationMember.findMany({
      where: { organization_id: orgId, user_id: { in: wanted }, is_active: true, user: { is_active: true } },
      select: { user_id: true },
    })
    const ok = new Set(rows.map((r) => r.user_id))
    return wanted.filter((id) => ok.has(id))
  }

  private async userName(tx: Tx, userId: string | null | undefined): Promise<string> {
    if (!userId) return 'someone'
    const u = await tx.user.findUnique({ where: { id: userId }, select: { name: true } })
    return u?.name ?? 'someone'
  }

  private async userNames(tx: Tx, ids: string[]): Promise<string> {
    const names: string[] = []
    for (const id of ids.slice(0, 4)) names.push(await this.userName(tx, id))
    if (ids.length > 4) names.push(`${ids.length - 4} more`)
    return names.join(', ')
  }

  /** Serialise every engine transaction on one run (see class invariants). */
  private async lockInstance(tx: Tx, instanceId: string): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "workflow_instances" WHERE "id" = ${instanceId} FOR UPDATE`
  }

  // Events written in one transaction share the same `now`; History sorts by
  // created_at, so give each later event in the same transaction its own +1ms to
  // keep "A completed" ahead of "B started" / "returned".
  private readonly eventClock = new WeakMap<object, number>()

  private async event(
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
    if (!inst) throw new NotFoundException('Run not found')
    const at = await this.clock.now(orgId)
    await this.event(this.prisma, { orgId, instanceId, type, message, at, ...opts })
  }

  private titleOf(row: StepRow, snap?: StepSnapshot | null): string {
    return (snap ?? readSnapshot(row.step_snapshot))?.title ?? 'A step'
  }

  /** Live non-CC workers of a task. */
  private async taskWorkers(tx: Tx, orgId: string, taskId: string | null): Promise<string[]> {
    if (!taskId) return []
    const rows = await tx.taskAssignee.findMany({
      where: { task_id: taskId, organization_id: orgId, is_cc: false, removed_at: null },
      select: { user_id: true },
    })
    return rows.map((r) => r.user_id)
  }

  // ═══ Snapshots ═══════════════════════════════════════════════════════════════

  /**
   * The frozen step definition for a row. Legacy rows (no snapshot) fall back to the
   * live template step once — scoped to the instance's own template and org — and get
   * frozen. Null when neither exists.
   */
  private async snapshotFor(tx: Tx, row: StepRow, templateId: string): Promise<StepSnapshot | null> {
    const snap = readSnapshot(row.step_snapshot)
    if (snap) return snap
    const live = await tx.workflowStep.findFirst({
      where: { id: row.workflow_step_id, workflow_template_id: templateId, organization_id: row.organization_id },
    })
    if (!live) return null
    const raw = buildStepSnapshot(live)
    const built = applyChecklistTemplates(
      raw,
      await this.loadChecklistTemplates(tx, row.organization_id, snapshotTemplateIds(raw)),
    )
    await tx.workflowInstanceStep.update({
      where: { id: row.id },
      data: { step_snapshot: built as unknown as Prisma.InputJsonValue },
    })
    return built
  }

  /**
   * The org's checklist templates a run's steps link to — ONE query per run, scoped
   * by organization_id (a foreign id simply isn't found → the stored copy is used).
   */
  private async loadChecklistTemplates(tx: Tx, orgId: string, ids: string[]): Promise<Map<string, LiveChecklistTemplate>> {
    if (!ids.length) return new Map()
    const rows = await tx.taskChecklistTemplate.findMany({
      where: { id: { in: ids }, organization_id: orgId },
      select: { id: true, name: true, is_active: true, items: true },
    })
    return new Map(rows.map((r) => [r.id, r]))
  }

  // ═══ People: assignees, CCs, escalation contacts (at activation) ═════════════

  /**
   * Who does the step, who is CC'd, and who the task escalates to.
   *  - Assignees / CCs: the snapshot's people who are still active members. Nobody
   *    left → the step's assigner (else the first active owner) does it, with a
   *    warning for `last_error` and the owners.
   *  - Escalation: 'people' → those (active) users as levels 1..n; 'manager' → the
   *    distinct current managers (EmployeeProfile.reporting_to_user_id) of the
   *    assignees, all at level 1; nobody → the workflow owners, all at level 1.
   *    Someone working the task never escalates to themselves.
   */
  private async resolvePeople(tx: Tx, inst: InstanceCtx, snap: StepSnapshot): Promise<StepPeople> {
    const orgId = inst.organization_id
    let assignees = await this.activeMembers(tx, orgId, snap.assignee_user_ids)
    let warning: string | null = null
    if (!assignees.length) {
      const [fallback] = await this.activeMembers(tx, orgId, [snap.assigner_user_id, ...inst.ownerIds])
      if (!fallback) {
        throw new BadRequestException(
          `No active person can do “${snap.title}”. Add an active owner, then retry.`,
        )
      }
      const why = snap.assignee_user_ids.length
        ? 'No assignee is active'
        : 'No one is assigned'
      warning = `${why}, so it was assigned to ${await this.userName(tx, fallback)}.`
      assignees = [fallback]
    }
    const ccs = (await this.activeMembers(tx, orgId, snap.cc_user_ids)).filter((u) => !assignees.includes(u))

    let escalationLevels: string[][] = []
    let escalationSource: StepPeople['escalationSource'] = 'none'
    if (snap.escalation_mode === 'people') {
      const people = await this.activeMembers(tx, orgId, snap.escalation_user_ids)
      if (people.length) {
        escalationLevels = people.map((u) => [u])
        escalationSource = 'people'
      }
    } else {
      const profiles = await tx.employeeProfile.findMany({
        where: { organization_id: orgId, user_id: { in: assignees } },
        select: { reporting_to_user_id: true },
      })
      const managers = (
        await this.activeMembers(
          tx,
          orgId,
          profiles.map((p) => p.reporting_to_user_id),
        )
      ).filter((u) => !assignees.includes(u))
      if (managers.length) {
        escalationLevels = [managers]
        escalationSource = 'manager'
      }
    }
    if (!escalationLevels.length) {
      const owners = (await this.activeMembers(tx, orgId, inst.ownerIds)).filter((u) => !assignees.includes(u))
      if (owners.length) {
        escalationLevels = [owners]
        escalationSource = 'owners_fallback'
      }
    }
    return { assignees, ccs, escalationLevels, escalationSource, warning }
  }

  /**
   * The step's deadline for a start at `startAt`, through the holiday rules (workflows
   * never skip: null ⇒ keep raw).
   *  - Calendar due rule → the row's PLANNED due (already holiday-adjusted when the run
   *    was planned) — kept even when a predecessor ran late, so lateness stays visible.
   *    A row without a plan resolves the next occurrence strictly after the start.
   *  - Relative / legacy due → the start day + N days at the due time (as before).
   */
  private async stepDeadline(
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
      ? resolveDue(snap.due_rule, startAt, this.timingCtx(inst, snap, tz))
      : computeDueDeadline(startAt, snap.due_days, snap.due_time, tz)
    const adjusted = (await this.holidaysService.adjustDeadline(raw, orgId, undefined, userId)) ?? raw
    return { raw, adjusted }
  }

  // ═══ Step timing ═════════════════════════════════════════════════════════════

  private timingCtx(inst: Pick<InstanceCtx, 'started_at'>, snap: Pick<StepSnapshot, 'timing_every'>, tz: string): TimingContext {
    return { tz, runStart: inst.started_at, every: snap.timing_every ?? 1 }
  }

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
  private async startTimeFor(inst: InstanceCtx, row: StepRow, snap: StepSnapshot, now: Date, tz: string): Promise<Date> {
    const rule = snap.start_rule
    if (!rule || rule.kind === 'immediate') return now
    const planned = rule.kind !== 'days_after_previous' && rule.kind !== 'time_of_day' ? row.planned_start_at : null
    if (planned) return planned.getTime() > now.getTime() ? planned : now
    const cb = this.holidayCallbacks(inst.organization_id, tz)
    const start = await cb.shiftFor(resolveStart(rule, now, this.timingCtx(inst, snap, tz)), snap.assignee_user_ids[0])
    return start.getTime() > now.getTime() ? start : now
  }

  /** Create the step task for `row` and record it on the row. Used by activation and retry. */
  private async giveRowTask(
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
    const people = await this.resolvePeople(tx, inst, snap)
    let deadline = opts.deadline ?? null
    if (!deadline) {
      const { raw, adjusted } = await this.stepDeadline(inst, row, snap, now, tz, people.assignees[0])
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
      statusId: await this.defaultStatusId(tx, orgId),
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
    effects.push(
      this.notify(orgId, people.assignees, 'workflow_step_assigned', 'Step assigned to you',
        `“${snap.title}” in “${inst.templateName}” (${inst.name}).`, link, inst.id),
      this.notify(orgId, people.ccs, 'workflow_step_assigned', 'You were CC’d on a step',
        `“${snap.title}” in “${inst.templateName}” (${inst.name}).`, link, inst.id),
    )
    if (people.warning) {
      effects.push(
        this.notify(orgId, inst.ownerIds.filter((o) => !people.assignees.includes(o)), 'workflow_stuck',
          'Step needs attention', `“${snap.title}” in “${inst.name}”: ${people.warning}`,
          this.instanceLink(inst.workflow_template_id, inst.id), inst.id),
      )
    }
    return { taskId, people, deadline }
  }

  // ═══ Task withdrawal ═════════════════════════════════════════════════════════

  /**
   * Withdraw a step's task (cancel / skip): soft-delete + archive snapshot + activity
   * entry, the same shape TasksService.deleteTask leaves. A task already closed
   * (completed / incomplete) is a record and is left alone. Returns the working
   * assignees of a withdrawn task (for notifications).
   */
  private async withdrawTask(
    tx: Tx,
    orgId: string,
    taskId: string | null,
    actorUserId: string,
    reason: string,
    now: Date,
  ): Promise<{ withdrawn: boolean; assigneeIds: string[]; title: string | null }> {
    if (!taskId) return { withdrawn: false, assigneeIds: [], title: null }
    const task = await tx.task.findFirst({
      where: { id: taskId, organization_id: orgId, is_deleted: false },
      include: { status: { select: { type: true } }, assignees: true, checklist: true },
    })
    if (!task || TERMINAL_TASK_TYPES.includes(task.status.type)) {
      return { withdrawn: false, assigneeIds: [], title: task?.title ?? null }
    }
    await tx.taskArchive.create({
      data: {
        organization_id: orgId,
        original_task_id: taskId,
        task_snapshot: JSON.parse(JSON.stringify(task)) as Prisma.InputJsonValue,
        deleted_by_user_id: actorUserId,
        deletion_reason: reason,
        deleted_at: now,
      },
    })
    await tx.task.update({
      where: { id: taskId },
      data: { is_deleted: true, deleted_by_user_id: actorUserId, deleted_at: now, deletion_reason: reason },
    })
    await tx.taskActivityLog.create({
      data: { organization_id: orgId, task_id: taskId, performed_by_user_id: actorUserId, action: 'deleted', metadata: { reason, source: 'workflow' } },
    })
    return {
      withdrawn: true,
      assigneeIds: task.assignees.filter((a) => !a.is_cc && !a.removed_at).map((a) => a.user_id),
      title: task.title,
    }
  }

  // ═══ Activation / settling the graph ═════════════════════════════════════════

  private async requireSnapshot(tx: Tx, inst: InstanceCtx, row: StepRow): Promise<StepSnapshot> {
    const snap = await this.snapshotFor(tx, row, inst.workflow_template_id)
    if (!snap) {
      throw new BadRequestException(
        'A step was deleted from the workflow before it ran. Skip the step or cancel the run.',
      )
    }
    return snap
  }

  /**
   * pending → active: resolve people, compute the deadline (step start = now), create
   * the task. Guarded on `status = pending`, so a step activates at most once.
   * `earlyBy` = "Start now" by that person (a waiting row started before its time).
   */
  private async activateRow(
    tx: Tx,
    inst: InstanceCtx,
    row: StepRow,
    now: Date,
    tz: string,
    effects: Effect[],
    opts: { snap?: StepSnapshot; earlyBy?: { userId: string; name: string } } = {},
  ): Promise<boolean> {
    const snap = opts.snap ?? (await this.requireSnapshot(tx, inst, row))
    const claimed = await tx.workflowInstanceStep.updateMany({
      where: { id: row.id, status: 'pending' },
      data: { status: 'active' },
    })
    if (claimed.count !== 1) return false

    const { taskId, people, deadline } = await this.giveRowTask(tx, inst, row, snap, now, tz, effects)
    await tx.workflowInstance.update({ where: { id: inst.id }, data: { current_step_id: row.id } })
    const who = await this.userNames(tx, people.assignees)
    await this.event(tx, {
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
    const snap = await this.requireSnapshot(tx, inst, row)
    const startAt = await this.startTimeFor(inst, row, snap, now, tz)
    if (startAt.getTime() <= now.getTime()) {
      return (await this.activateRow(tx, inst, row, now, tz, effects, { snap })) ? 'started' : 'none'
    }
    const marked = await tx.workflowInstanceStep.updateMany({
      where: { id: row.id, status: 'pending', start_at: null },
      data: { start_at: startAt },
    })
    if (marked.count !== 1) return 'none'
    await this.event(tx, {
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
  private async settle(
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
    await this.event(tx, {
      orgId: inst.organization_id,
      instanceId: inst.id,
      type: 'run_completed',
      message: `“${inst.name}” is complete.`,
      at: now,
    })
    effects.push(
      this.notify(inst.organization_id, inst.ownerIds, 'workflow_completed', 'Run completed',
        `“${inst.name}” (${inst.templateName}) is complete.`,
        this.instanceLink(inst.workflow_template_id, inst.id), inst.id),
    )
  }

  private async loadInstanceCtx(
    db: Tx,
    orgId: string,
    instanceId: string,
  ): Promise<(InstanceCtx & { status: string; current_step_id: string | null; last_error: string | null }) | null> {
    const inst = await db.workflowInstance.findFirst({
      where: { id: instanceId, organization_id: orgId },
      include: { template: { select: { name: true, owner_user_ids: true, created_by_user_id: true } } },
    })
    if (!inst) return null
    return {
      id: inst.id,
      organization_id: inst.organization_id,
      workflow_template_id: inst.workflow_template_id,
      name: inst.name,
      started_at: inst.started_at,
      templateName: inst.template.name,
      ownerIds: this.ownersOf(inst.template),
      status: inst.status,
      current_step_id: inst.current_step_id,
      last_error: inst.last_error,
    }
  }

  /** Park a run as stuck with a readable reason and tell its owners. Never throws. */
  private async markStuck(orgId: string, instanceId: string, rowId: string | null, message: string): Promise<void> {
    try {
      const inst = await this.loadInstanceCtx(this.prisma, orgId, instanceId)
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
          this.notify(orgId, inst.ownerIds, 'workflow_stuck', 'Run needs attention',
            `“${inst.name}” (${inst.templateName}): ${message}`,
            this.instanceLink(inst.workflow_template_id, inst.id), inst.id),
        ])
      }
    } catch (err) {
      this.logger.error(`Could not mark workflow instance ${instanceId} stuck: ${(err as Error)?.message ?? err}`)
    }
  }

  // ═══ Instance naming ═════════════════════════════════════════════════════════

  private async instanceName(
    tx: Tx,
    templateId: string,
    templateName: string,
    context: Record<string, unknown>,
    now: Date,
    tz: string,
  ): Promise<string> {
    const custom = typeof context.name === 'string' ? context.name.trim() : ''
    if (custom) return custom.slice(0, 200)
    const today = formatHumanDate(now, tz)
    const base = `${templateName} — ${today}`
    const existing = await tx.workflowInstance.findMany({
      where: { workflow_template_id: templateId, name: { startsWith: base } },
      select: { name: true },
    })
    if (existing.length === 0) return base
    const nums = existing.map((e) => {
      const m = e.name.match(/ — #(\d+)$/)
      return m ? parseInt(m[1], 10) : 1
    })
    return `${base} — #${Math.max(...nums) + 1}`
  }

  // ═══ Public entry points ═════════════════════════════════════════════════════

  /**
   * Start a run of a LIVE (active, not paused) template — by hand, by a schedule, or by
   * any future start. The instance, one row per step (each with a frozen snapshot) and
   * the tasks of every step with no dependencies are written in one transaction;
   * notifications follow the commit. Who may start it is the caller's business (the
   * API checks "Manually"); this only checks the workflow can run. A start tied to a
   * source (`{ triggerId, sourceTaskId }`) returns the existing instance for a repeat
   * of the same pair instead of creating a duplicate.
   *
   * `opts.startAt` (replay/schedules) pins the start instant; default = org clock.
   */
  async createInstance(
    orgId: string,
    templateId: string,
    triggerType: string,
    context: Record<string, unknown>,
    triggeredByUserId?: string | null,
    opts?: { triggerId?: string; sourceTaskId?: string; startAt?: Date },
  ): Promise<{ id: string }> {
    const template = await this.prisma.workflowTemplate.findFirst({
      where: { id: templateId, organization_id: orgId },
      include: {
        steps: { orderBy: [{ order_index: 'asc' }, { created_at: 'asc' }] },
        schedules: { select: { schedule_type: true, every: true } },
      },
    })
    if (!template) throw new NotFoundException('Workflow not found')
    if (template.status !== 'active') {
      throw new BadRequestException(
        template.status === 'archived'
          ? 'This workflow is archived. Restore and save it first.'
          : template.status === 'paused'
            ? 'This workflow is paused. Resume it to start it.'
            : 'This workflow is a draft. Save it to make it live.',
      )
    }
    if (!(await this.automationEnabled(orgId))) {
      throw new ForbiddenException(
        'Starting runs needs the full Workflows module. Ask your administrator to turn it on.',
      )
    }
    // Legacy escalation steps (is_branch_step) are not part of v2 flows. Rows are stored
    // in the workflow's display order (tracks in order, each in its own order), and each
    // snapshot records its track and number ("B2") as they are when the run starts.
    const resolved = resolveStoredTracks(
      template.tracks,
      template.steps.filter((s) => !s.is_branch_step),
    )
    const steps = resolved.display
    const trackName = new Map(resolved.tracks.map((t) => [t.key, t.name]))
    if (steps.length === 0) {
      throw new BadRequestException('This workflow has no steps. Add a step first.')
    }

    if (opts?.triggerId && opts?.sourceTaskId) {
      const dup = await this.prisma.workflowInstance.findFirst({
        where: { trigger_id: opts.triggerId, source_task_id: opts.sourceTaskId },
        select: { id: true },
      })
      if (dup) return dup
    }

    const tz = await this.orgTimeZone(orgId)
    const now = opts?.startAt ?? (await this.clock.now(orgId))
    const ownerIds = this.ownersOf(template)
    const effects: Effect[] = []

    // Step timing: the cycle length comes from the workflow's schedules (a manual start
    // of a scheduled workflow resolves calendar timing from its own start); every row
    // gets its planned start → due, planned in dependency order from this start.
    const every = cycleLengthOf(frequencyOf(template.schedules ?? []))
    const rawSnaps = steps.map((step, i) => {
      const track_key = resolved.trackOf.get(step.id) ?? MAIN_TRACK
      return {
        ...buildStepSnapshot(step, {
          track_key,
          track_name: trackName.get(track_key) ?? null,
          number_label: resolved.labels.get(step.id) ?? `${i + 1}`,
          order_index: i,
        }),
        timing_every: every,
      }
    })
    const plan = await this.planTimeline(
      orgId,
      tz,
      rawSnaps.map((sn, i) => ({
        key: steps[i].id,
        deps: sn.depends_on_step_ids ?? [],
        start_rule: sn.start_rule,
        due_rule: sn.due_rule,
        due_days: sn.due_days,
        due_time: sn.due_time,
        holiday_user_id: sn.assignee_user_ids[0] ?? null,
      })),
      now,
      every,
    )
    const plannedBy = new Map(plan.steps.map((x) => [x.key, x]))

    let instanceId: string
    try {
      instanceId = await this.prisma.$transaction(async (tx) => {
        const name = await this.instanceName(tx, templateId, template.name, context, now, tz)
        const instance = await tx.workflowInstance.create({
          data: {
            organization_id: orgId,
            workflow_template_id: templateId,
            name,
            trigger_type: triggerType,
            triggered_by_user_id: triggeredByUserId ?? null,
            status: 'running',
            started_at: now,
            created_at: now,
            metadata: context as Prisma.InputJsonValue,
            trigger_id: opts?.triggerId ?? null,
            source_task_id: opts?.sourceTaskId ?? null,
          },
        })

        // Frozen for the life of the run: linked checklist templates are resolved to
        // their CURRENT items now (one lookup for the whole run), never again later.
        const checklistTemplates = await this.loadChecklistTemplates(tx, orgId, [
          ...new Set(rawSnaps.flatMap((sn) => snapshotTemplateIds(sn))),
        ])
        for (let i = 0; i < steps.length; i++) {
          await tx.workflowInstanceStep.create({
            data: {
              organization_id: orgId,
              workflow_instance_id: instance.id,
              workflow_step_id: steps[i].id,
              order_index: i,
              status: 'pending',
              step_snapshot: applyChecklistTemplates(rawSnaps[i], checklistTemplates) as unknown as Prisma.InputJsonValue,
              planned_start_at: plannedBy.get(steps[i].id)?.planned_start_at ?? null,
              planned_due_at: plannedBy.get(steps[i].id)?.planned_due_at ?? null,
            },
          })
        }

        const inst: InstanceCtx = {
          id: instance.id,
          organization_id: orgId,
          workflow_template_id: templateId,
          name,
          started_at: now,
          templateName: template.name,
          ownerIds,
        }
        const starter = triggeredByUserId ? await this.userName(tx, triggeredByUserId) : null
        await this.event(tx, {
          orgId,
          instanceId: instance.id,
          type: 'run_started',
          actorUserId: triggeredByUserId ?? null,
          message: starter
            ? `${starter} started “${name}”.`
            : triggerType === SCHEDULE_START
              ? `“${name}” started on its schedule.`
              : `“${name}” started (${triggerType.replace(/_/g, ' ')}).`,
          metadata: { trigger_type: triggerType, trigger_id: opts?.triggerId ?? null, source_task_id: opts?.sourceTaskId ?? null },
          at: now,
        })
        await this.settle(tx, inst, now, tz, effects)

        const begun = await tx.workflowInstanceStep.findMany({
          where: { workflow_instance_id: instance.id, status: { in: ['active', 'pending'] } },
          select: { status: true, step_snapshot: true, task_id: true, start_at: true },
        })
        const started = begun.filter((s) => s.status === 'active')
        const waiting = begun.filter((s) => isWaitingRow(s))
        if (!started.length && !waiting.length) {
          throw new BadRequestException(
            'No step can start first. Make at least one step start at the beginning.',
          )
        }
        // Owners hear the run started; first-step assignees already get their own
        // assignment notification (queued by activation) — not two.
        const firstWorkers = new Set<string>()
        for (const s of started) for (const u of await this.taskWorkers(tx, orgId, s.task_id)) firstWorkers.add(u)
        const titleOfRow = (s: { step_snapshot: unknown }) => `“${readSnapshot(s.step_snapshot)?.title ?? 'Step'}”`
        const firstLine = started.length
          ? `First step${started.length > 1 ? 's' : ''}: ${started.map(titleOfRow).join(', ')}.`
          : `First step${waiting.length > 1 ? 's' : ''}: ${waiting
              .map((s) => `${titleOfRow(s)} (starts ${formatStartMoment(s.start_at!, tz)})`)
              .join(', ')}.`
        effects.unshift(
          this.notify(orgId, ownerIds.filter((o) => !firstWorkers.has(o)), 'workflow_triggered', 'Workflow started',
            `“${name}” started. ${firstLine}`,
            this.instanceLink(templateId, instance.id), instance.id),
        )
        return instance.id
      }, TX_OPTIONS)
    } catch (err) {
      // Lost a race on the (trigger_id, source_task_id) dedupe key → the other start wins.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && opts?.triggerId && opts?.sourceTaskId) {
        const dup = await this.prisma.workflowInstance.findFirst({
          where: { trigger_id: opts.triggerId, source_task_id: opts.sourceTaskId },
          select: { id: true },
        })
        if (dup) return dup
      }
      throw err
    }

    await this.runEffects(effects)
    return { id: instanceId }
  }

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
      await this.completeRowNow(row)
    } catch (err) {
      this.logger.error(`Advancing workflow step ${workflowInstanceStepId} failed: ${(err as Error)?.stack ?? err}`)
      if (orgId && instanceId) await this.markStuck(orgId, instanceId, workflowInstanceStepId, this.errorMessage(err))
    }
  }

  /** Throws on failure (callers decide whether that's a 400 or a stuck run). */
  private async completeRowNow(row: StepRow): Promise<void> {
    const orgId = row.organization_id
    const inst = await this.loadInstanceCtx(this.prisma, orgId, row.workflow_instance_id)
    if (!inst || !ADVANCEABLE.includes(inst.status as 'running')) return
    const now = await this.clock.now(orgId)
    const tz = await this.orgTimeZone(orgId)
    const effects: Effect[] = []
    await this.prisma.$transaction(async (tx) => {
      await this.lockInstance(tx, inst.id)
      const done = await this.markRowCompleted(tx, inst, row.id, now, tz, effects)
      if (done) await this.settle(tx, inst, now, tz, effects, { resume: true })
    }, TX_OPTIONS)
    await this.runEffects(effects)
  }

  /**
   * open → completed, with the send-back bookkeeping:
   *  - the row was a send-back TARGET (`returned_to_row_id`) → the run returns
   *    straight to the sender (which resumes; intermediate steps are not redone);
   *  - the row was itself PAUSED (sent_back) → its completion is accepted; the target
   *    keeps its task open but no longer returns here.
   * Returns false when another actor got there first. Caller settles the graph.
   */
  private async markRowCompleted(
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
    const title = this.titleOf(cur)

    let message = `“${title}” was completed.`
    if (cur.status === 'sent_back' && cur.waiting_on_row_id) {
      const target = await tx.workflowInstanceStep.findUnique({ where: { id: cur.waiting_on_row_id } })
      await tx.workflowInstanceStep.updateMany({
        where: { id: cur.waiting_on_row_id, returned_to_row_id: cur.id },
        data: { returned_to_row_id: null },
      })
      message = `“${title}” was completed while waiting for “${target ? this.titleOf(target) : 'an earlier step'}”, which will no longer return here.`
    } else if (cur.status === 'moved_on') {
      message = `“${title}” was completed late. The next steps had already started.`
    }
    await this.event(tx, {
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
  private async resumeSender(
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
    const senderTitle = this.titleOf(sender, senderSnap)
    const targetTitle = this.titleOf(target)

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
        const workers = await this.taskWorkers(tx, orgId, task.id)
        const raw = new Date(task.deadline.getTime() + pausedMs)
        deadline = (await this.holidaysService.adjustDeadline(raw, orgId, undefined, workers[0])) ?? raw
        await moveTaskDeadline(tx, {
          orgId,
          taskId: task.id,
          newDeadline: deadline,
          actorUserId: senderSnap?.assigner_user_id ?? inst.ownerIds[0],
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
    await this.event(tx, {
      orgId,
      instanceId: inst.id,
      rowId: sender.id,
      type: 'returned',
      message: `“${targetTitle}” is done again. The run is back at “${senderTitle}”.`,
      metadata: {
        from_row_id: target.id,
        to_row_id: sender.id,
        paused_ms: pausedMs,
        new_deadline: deadline?.toISOString() ?? null,
      },
      at: now,
    })
    const workers = await this.taskWorkers(tx, orgId, sender.task_id)
    effects.push(
      this.notify(orgId, workers, 'workflow_sent_back', 'Step back with you',
        `“${targetTitle}” is done again, so “${senderTitle}” in “${inst.name}” can continue.` +
          (deadline && pausedMs > 0 ? ` Its deadline moved to ${formatHumanDate(deadline, tz)}.` : ''),
        sender.task_id ? `/dashboard/tasks/${sender.task_id}` : this.instanceLink(inst.workflow_template_id, inst.id), inst.id),
    )
  }

  // ═══ Send back ═══════════════════════════════════════════════════════════════

  /** Completed rows upstream of `fromRowId`, nearest first (direct predecessors first). */
  private sendBackCandidates(rows: StepRow[], fromRowId: string): StepRow[] {
    const up = upstreamOf(rowDependencies(rows), fromRowId)
    return flowRows(rows)
      .filter((r) => up.has(r.id) && r.status === 'completed')
      .sort((a, b) => up.get(a.id)! - up.get(b.id)! || a.order_index - b.order_index)
  }

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
    if (!inst) throw new NotFoundException('Run not found')
    const rows = await this.prisma.workflowInstanceStep.findMany({ where: { workflow_instance_id: instanceId, organization_id: orgId } })
    const from = rows.find((r) => r.id === fromRowId)
    if (!from || isBranchRow(from)) throw new NotFoundException('That step isn’t part of this run')
    if (!ADVANCEABLE.includes(inst.status as 'running') || !SENDABLE_ROW.includes(from.status as 'active')) return []
    return this.sendBackCandidates(rows, fromRowId).map((r) => ({ row_id: r.id, title: this.titleOf(r) }))
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
    const inst = await this.loadInstanceCtx(this.prisma, orgId, instanceId)
    if (!inst) throw new NotFoundException('Run not found')
    if (!ADVANCEABLE.includes(inst.status as 'running')) {
      throw new BadRequestException(`This run is ${inst.status}, so it can’t be sent back.`)
    }
    const why = (reason ?? '').trim()
    if (why.length < REASON_MIN) {
      throw new BadRequestException(`Enter a reason of at least ${REASON_MIN} characters.`)
    }
    if (why.length > REASON_MAX) throw new BadRequestException(`Keep the reason under ${REASON_MAX} characters.`)

    const rows = await this.prisma.workflowInstanceStep.findMany({ where: { workflow_instance_id: instanceId, organization_id: orgId } })
    const from = rows.find((r) => r.id === fromRowId)
    const to = rows.find((r) => r.id === toRowId)
    if (!from || isBranchRow(from)) throw new NotFoundException('That step isn’t part of this run')
    if (!to || isBranchRow(to)) throw new NotFoundException('The step to send back to isn’t part of this run')
    const fromTitle = this.titleOf(from)
    const toTitle = this.titleOf(to)
    if (!SENDABLE_ROW.includes(from.status as 'active')) {
      throw new BadRequestException(`“${fromTitle}” isn’t in progress, so it can’t send the run back.`)
    }
    if (!this.sendBackCandidates(rows, fromRowId).some((r) => r.id === toRowId)) {
      throw new BadRequestException(
        to.status === 'completed'
          ? `“${fromTitle}” can only send the run back to an earlier step.`
          : `“${toTitle}” isn’t done, so the run can’t be sent back to it.`,
      )
    }
    const workers = await this.taskWorkers(this.prisma, orgId, from.task_id)
    if (!workers.includes(actorUserId) && !opts.canEdit) {
      throw new ForbiddenException(`Only the assignees of “${fromTitle}”, owners and editors can send it back.`)
    }
    if (!to.task_id) throw new BadRequestException(`“${toTitle}” has no task to reopen, so the run can’t be sent back to it.`)

    const now = await this.clock.now(orgId)
    const tz = await this.orgTimeZone(orgId)
    const effects: Effect[] = []
    const link = this.instanceLink(inst.workflow_template_id, inst.id)
    await this.prisma.$transaction(async (tx) => {
      await this.lockInstance(tx, inst.id)
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

      const toSnap = await this.snapshotFor(tx, to, inst.workflow_template_id)
      const toWorkers = await this.taskWorkers(tx, orgId, to.task_id)
      const raw = toSnap ? computeDueDeadline(now, toSnap.due_days, toSnap.due_time, tz) : new Date(now.getTime() + 86_400_000)
      const deadline = (await this.holidaysService.adjustDeadline(raw, orgId, undefined, toWorkers[0])) ?? raw
      const body = `Sent back from “${fromTitle}”: ${why}`
      await reopenTaskForWorkflow(tx, { orgId, taskId: to.task_id!, actorUserId, newDeadline: deadline, now, reason: body })
      await tx.workflowInstanceStep.update({ where: { id: to.id }, data: { scheduled_at: deadline } })
      const comment = await tx.taskComment.create({
        data: { organization_id: orgId, task_id: to.task_id!, user_id: actorUserId, body, created_at: now },
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

      const actorName = await this.userName(tx, actorUserId)
      await this.event(tx, {
        orgId,
        instanceId: inst.id,
        rowId: from.id,
        type: 'sent_back',
        actorUserId,
        message: `${actorName} sent the run back from “${fromTitle}” to “${toTitle}”: ${why}`,
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
        this.notify(orgId, toWorkers.filter((u) => u !== actorUserId), 'workflow_sent_back', `“${toTitle}” was sent back to you`,
          `${actorName} sent “${inst.name}” back from “${fromTitle}”: ${why}\nNew deadline: ${formatHumanDate(deadline, tz)}.`,
          `/dashboard/tasks/${to.task_id}`, inst.id),
        this.notify(orgId, inst.ownerIds.filter((u) => u !== actorUserId && !toWorkers.includes(u)), 'workflow_sent_back',
          'Run sent back', `${actorName} sent “${inst.name}” back from “${fromTitle}” to “${toTitle}”: ${why}`, link, inst.id),
      )
    }, TX_OPTIONS)
    await this.runEffects(effects)
  }

  // ═══ Cancel / retry / skip ═══════════════════════════════════════════════════

  /**
   * Cancel a running/stuck run: cancelled; every open step task withdrawn
   * (soft-deleted with an archive entry, like a task delete); open and pending rows
   * → skipped; assignees of withdrawn tasks are told.
   */
  async cancelInstance(orgId: string, instanceId: string, actorUserId: string): Promise<void> {
    const inst = await this.loadInstanceCtx(this.prisma, orgId, instanceId)
    if (!inst) throw new NotFoundException('Run not found')
    if (!ADVANCEABLE.includes(inst.status as 'running')) {
      throw new BadRequestException(`This run is already ${inst.status}, so it can’t be cancelled.`)
    }
    const now = await this.clock.now(orgId)
    const effects: Effect[] = []
    await this.prisma.$transaction(async (tx) => {
      await this.lockInstance(tx, instanceId)
      const res = await tx.workflowInstance.updateMany({
        where: { id: instanceId, organization_id: orgId, status: { in: ADVANCEABLE } },
        data: { status: 'cancelled', completed_at: now, last_error: null },
      })
      if (res.count !== 1) throw new BadRequestException('This run just changed. Refresh and try again.')
      const actorName = await this.userName(tx, actorUserId)
      const rows = await tx.workflowInstanceStep.findMany({
        where: { workflow_instance_id: instanceId, status: { in: ['pending', ...OPEN_ROW] } },
      })
      for (const r of rows) {
        const w = isOpen(r.status)
          ? await this.withdrawTask(tx, orgId, r.task_id, actorUserId, `Run “${inst.name}” was cancelled`, now)
          : { withdrawn: false, assigneeIds: [], title: null }
        await tx.workflowInstanceStep.update({
          where: { id: r.id },
          data: { status: 'skipped', last_error: `Cancelled by ${actorName}`, waiting_on_row_id: null, returned_to_row_id: null },
        })
        if (w.withdrawn && w.assigneeIds.length) {
          effects.push(
            this.notify(orgId, w.assigneeIds.filter((u) => u !== actorUserId), 'workflow_task_withdrawn', 'Run cancelled',
              `“${inst.name}” was cancelled by ${actorName}. Your task “${w.title}” was withdrawn.`,
              this.instanceLink(inst.workflow_template_id, inst.id), inst.id),
          )
        }
      }
      await this.event(tx, {
        orgId,
        instanceId,
        type: 'run_cancelled',
        actorUserId,
        message: `${actorName} cancelled the run.`,
        metadata: { withdrawn_rows: rows.filter((r) => isOpen(r.status)).map((r) => r.id) },
        at: now,
      })
    }, TX_OPTIONS)
    await this.runEffects(effects)
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
    const inst = await this.loadInstanceCtx(this.prisma, orgId, instanceId)
    if (!inst) throw new NotFoundException('Run not found')
    if (!ADVANCEABLE.includes(inst.status as 'running')) {
      throw new BadRequestException(`This run is ${inst.status}, so there is nothing to retry.`)
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
    if (!stranded) throw new BadRequestException('This run is not stuck, so there is nothing to retry.')

    const tz = await this.orgTimeZone(orgId)
    const effects: Effect[] = []
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.lockInstance(tx, instanceId)
        await tx.workflowInstance.updateMany({
          where: { id: instanceId, status: { in: ADVANCEABLE } },
          data: { status: 'running', last_error: null },
        })
        for (const r of finishedTask) await this.markRowCompleted(tx, inst, r.id, now, tz, effects, actorUserId)

        for (const r of brokenTask) {
          const snap = await this.snapshotFor(tx, r, inst.workflow_template_id)
          if (!snap) {
            throw new BadRequestException(
              `“${this.titleOf(r)}” was deleted from the workflow before it ran. Skip the step or cancel the run.`,
            )
          }
          // Keep the deadline when it's still ahead; else a fresh one from now.
          const keep = r.scheduled_at && r.scheduled_at.getTime() > now.getTime() ? r.scheduled_at : null
          const status = r.status === 'sent_back' || r.status === 'moved_on' ? r.status : 'active'
          const { taskId } = await this.giveRowTask(tx, inst, r, snap, now, tz, effects, { deadline: keep, status })
          if (status === 'sent_back') await setEscalationsPaused(tx, orgId, taskId, true)
        }
        // Clear stale row errors left by the failure we're recovering from.
        const fixed = new Set([...brokenTask.map((r) => r.id)])
        for (const r of rows) {
          if (r.last_error && !fixed.has(r.id) && isOpen(r.status)) {
            await tx.workflowInstanceStep.update({ where: { id: r.id }, data: { last_error: null } })
          }
        }
        const actorName = await this.userName(tx, actorUserId)
        await this.event(tx, {
          orgId,
          instanceId,
          type: 'retried',
          actorUserId,
          message: `${actorName} retried the run.`,
          metadata: {
            completed_rows: finishedTask.map((r) => r.id),
            recreated_rows: brokenTask.map((r) => r.id),
            activated_rows: ready.map((r) => r.id),
          },
          at: now,
        })
        await this.settle(tx, inst, now, tz, effects)
      }, TX_OPTIONS)
    } catch (err) {
      if (err instanceof HttpException) throw err
      this.logger.error(`Retry of workflow instance ${instanceId} by ${actorUserId} failed: ${(err as Error)?.stack ?? err}`)
      await this.markStuck(orgId, instanceId, null, this.errorMessage(err))
      throw new BadRequestException(this.errorMessage(err))
    }
    await this.runEffects(effects)
  }

  /**
   * Skip one step (its open task is withdrawn) and settle the graph — its dependents
   * may start. `rowId` defaults to the run's single current step; with several steps
   * in progress the caller must say which. Skipping a send-back target returns the
   * run to the sender; skipping a paused sender releases its target.
   */
  async skipStep(orgId: string, instanceId: string, actorUserId: string, rowId?: string | null): Promise<void> {
    const inst = await this.loadInstanceCtx(this.prisma, orgId, instanceId)
    if (!inst) throw new NotFoundException('Run not found')
    if (!ADVANCEABLE.includes(inst.status as 'running')) {
      throw new BadRequestException(`This run is ${inst.status}, so steps can’t be skipped.`)
    }
    const rows = flowRows(await this.prisma.workflowInstanceStep.findMany({ where: { workflow_instance_id: instanceId, organization_id: orgId } }))
    let target: StepRow | undefined
    if (rowId) {
      target = rows.find((r) => r.id === rowId)
      if (!target) throw new NotFoundException('That step isn’t part of this run')
    } else {
      const open = rows.filter((r) => isOpen(r.status))
      const candidates = open.length ? open : readyRows(rows, rowDependencies(rows))
      if (candidates.length === 0) throw new BadRequestException('There is no current step to skip.')
      if (candidates.length > 1) throw new BadRequestException('Several steps are in progress. Choose which one to skip.')
      target = candidates[0]
    }
    if (target.status !== 'pending' && !isOpen(target.status)) {
      throw new BadRequestException(`“${this.titleOf(target)}” is already ${target.status.replace('_', ' ')}, so it can’t be skipped.`)
    }
    const row = target
    const now = await this.clock.now(orgId)
    const tz = await this.orgTimeZone(orgId)
    const effects: Effect[] = []
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.lockInstance(tx, instanceId)
        const actorName = await this.userName(tx, actorUserId)
        const res = await tx.workflowInstanceStep.updateMany({
          where: { id: row.id, status: { in: ['pending', ...OPEN_ROW] } },
          data: { status: 'skipped', last_error: `Skipped by ${actorName}`, waiting_on_row_id: null, returned_to_row_id: null },
        })
        if (res.count !== 1) throw new BadRequestException('This step just changed. Refresh and try again.')
        const title = this.titleOf(row)
        const w = isOpen(row.status)
          ? await this.withdrawTask(tx, orgId, row.task_id, actorUserId, `Step skipped by ${actorName}`, now)
          : { withdrawn: false, assigneeIds: [] as string[], title: null }
        if (w.withdrawn && w.assigneeIds.length) {
          effects.push(
            this.notify(orgId, w.assigneeIds.filter((u) => u !== actorUserId), 'workflow_task_withdrawn', 'Step skipped',
              `${actorName} skipped “${w.title}” in “${inst.name}”. Your task was withdrawn.`,
              this.instanceLink(inst.workflow_template_id, inst.id), inst.id),
          )
        }
        await this.event(tx, {
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
        if (row.returned_to_row_id) await this.resumeSender(tx, inst, row, row.returned_to_row_id, now, tz, effects)
        await this.settle(tx, inst, now, tz, effects, { resume: true })
      }, TX_OPTIONS)
    } catch (err) {
      if (err instanceof HttpException) throw err
      this.logger.error(`Skip on workflow instance ${instanceId} failed: ${(err as Error)?.stack ?? err}`)
      throw new BadRequestException(this.errorMessage(err))
    }
    await this.runEffects(effects)
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
    const inst = await this.loadInstanceCtx(this.prisma, orgId, instanceId)
    if (!inst) throw new NotFoundException('Run not found')
    if (!ADVANCEABLE.includes(inst.status as 'running')) {
      throw new BadRequestException(`This run is ${inst.status}, so steps can’t be started.`)
    }
    const row = await this.prisma.workflowInstanceStep.findFirst({
      where: { id: rowId, workflow_instance_id: instanceId, organization_id: orgId },
    })
    if (!row || isBranchRow(row)) throw new NotFoundException('That step isn’t part of this run')
    if (!isWaitingRow(row)) {
      throw new BadRequestException(`“${this.titleOf(row)}” isn’t waiting to start.`)
    }
    const now = await this.clock.now(orgId)
    const tz = await this.orgTimeZone(orgId)
    const effects: Effect[] = []
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.lockInstance(tx, instanceId)
        const rows = await tx.workflowInstanceStep.findMany({ where: { workflow_instance_id: instanceId, organization_id: orgId } })
        const cur = rows.find((r) => r.id === rowId)
        if (!cur || !isWaitingRow(cur)) throw new BadRequestException('This step just changed. Refresh and try again.')
        const status = new Map(rows.map((r) => [r.id, r.status]))
        const deps = rowDependencies(rows).get(cur.id) ?? []
        if (!deps.every((d) => isSatisfied(status.get(d) ?? 'pending'))) {
          throw new BadRequestException(`The steps before “${this.titleOf(cur)}” aren’t done yet, so it can’t start.`)
        }
        const name = await this.userName(tx, actorUserId)
        const started = await this.activateRow(tx, inst, cur, now, tz, effects, { earlyBy: { userId: actorUserId, name } })
        if (!started) throw new BadRequestException('This step just changed. Refresh and try again.')
      }, TX_OPTIONS)
    } catch (err) {
      if (err instanceof HttpException) throw err
      this.logger.error(`Start now on workflow step ${rowId} failed: ${(err as Error)?.stack ?? err}`)
      throw new BadRequestException(this.errorMessage(err))
    }
    await this.runEffects(effects)
  }

  // ═══ Task lifecycle hooks (called by TasksService / scheduler — never throw) ═══

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
      await this.markStuck(
        orgId,
        row.workflow_instance_id,
        null,
        `“${this.titleOf(row)}” was closed as incomplete. Reopen its task, retry the run, or skip the step.`,
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
      const inst = await this.loadInstanceCtx(this.prisma, orgId, row.workflow_instance_id)
      if (!inst || inst.status === 'cancelled') return
      const now = await this.clock.now(orgId)
      const title = this.titleOf(row)

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
          await this.lockInstance(tx, inst.id)
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
        await this.lockInstance(tx, inst.id)
        const back = await tx.workflowInstanceStep.updateMany({
          where: { id: row.id, status: 'completed' },
          data: { status: 'active', completed_at: null, last_error: null },
        })
        if (back.count !== 1) return
        await tx.workflowInstance.updateMany({
          where: { id: inst.id, status: { in: ['running', 'stuck', 'completed'] } },
          data: { status: 'running', completed_at: null, last_error: null, current_step_id: row.id },
        })
        const actorName = await this.userName(tx, actorUserId)
        await this.event(tx, {
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
      await this.markStuck(
        orgId,
        row.workflow_instance_id,
        null,
        `The task for “${this.titleOf(row)}” was deleted. Retry the run, skip the step, or cancel the run.`,
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
        await this.event(this.prisma, {
          orgId,
          instanceId: row.workflow_instance_id,
          rowId: row.id,
          type: 'step_started',
          message: `“${this.titleOf(row)}” has a new deadline (${formatHumanDate(task.deadline!, await this.orgTimeZone(orgId))}) and is on time.`,
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
      await this.event(this.prisma, {
        orgId,
        instanceId: row.workflow_instance_id,
        rowId: row.id,
        type: 'step_escalated',
        message: `“${this.titleOf(row)}” is late and was escalated to ${await this.userNames(this.prisma, contactIds)}${level > 1 ? ` (level ${level})` : ''}.`,
        metadata: { level, contact_ids: contactIds, task_id: taskId },
        at: now,
      })
    })
  }

  // ═══ Cron: late steps ════════════════════════════════════════════════════════

  @Cron('*/15 * * * *')
  async processOverdueSteps(): Promise<void> {
    const orgs = await this.prisma.organization.findMany({ where: { is_test: false }, select: { id: true } })
    for (const org of orgs) {
      try {
        await this.processOverdueStepsForOrg(org.id, new Date())
      } catch (err) {
        this.logger.error(`Workflow late sweep failed for org ${org.id}: ${(err as Error)?.stack ?? err}`)
      }
    }
  }

  /** Org-scoped, now-injected — cron passes real now, ReplayService passes sim now. */
  async processOverdueStepsForOrg(orgId: string, now: Date): Promise<void> {
    if (!(await this.automationEnabled(orgId))) return
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
    const tz = await this.orgTimeZone(orgId)
    for (const row of rows) {
      try {
        await this.handleLateRow(orgId, row, now, tz)
      } catch (err) {
        this.logger.error(`Late handling failed for workflow step ${row.id}: ${(err as Error)?.stack ?? err}`)
        await this.prisma.workflowInstanceStep
          .update({ where: { id: row.id }, data: { last_error: this.errorMessage(err) } })
          .catch(() => null)
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

    const inst = await this.loadInstanceCtx(this.prisma, orgId, row.workflow_instance_id)
    if (!inst || !ADVANCEABLE.includes(inst.status as 'running')) return
    const effects: Effect[] = []
    const deadline = task.deadline

    await this.prisma.$transaction(async (tx) => {
      await this.lockInstance(tx, inst.id)
      const snap = await this.snapshotFor(tx, row, inst.workflow_template_id)
      const title = snap?.title ?? 'A step'
      const moveOn = snap?.if_late === 'move_on' && !isBranchRow(row)
      const res = await tx.workflowInstanceStep.updateMany({
        where: { id: row.id, status: 'active' },
        data: { status: moveOn ? 'moved_on' : 'overdue' },
      })
      if (res.count !== 1) return

      const workers = await this.taskWorkers(tx, orgId, row.task_id)
      const contacts = (
        await tx.taskEscalation.findMany({
          where: { task_id: row.task_id!, organization_id: orgId, is_active: true },
          select: { escalate_to_user_id: true },
        })
      ).map((e) => e.escalate_to_user_id)
      const due = formatHumanDate(deadline, tz)
      const who = await this.userNames(tx, workers)
      await this.event(tx, {
        orgId,
        instanceId: inst.id,
        rowId: row.id,
        type: 'step_late',
        message: `“${title}” is late (due ${due}). Waiting on ${who}.`,
        metadata: { deadline: deadline.toISOString(), if_late: moveOn ? 'move_on' : 'wait', task_id: row.task_id },
        at: now,
      })
      if (moveOn) {
        await this.event(tx, {
          orgId,
          instanceId: inst.id,
          rowId: row.id,
          type: 'step_moved_on',
          message: `The run continued past “${title}”. Its task stays open.`,
          at: now,
        })
        await this.settle(tx, inst, now, tz, effects)
      }
      const consequence = moveOn
        ? 'The next steps have started. The task stays open.'
        : 'The next steps wait until it is done.'
      effects.unshift(
        this.notify(orgId, [...inst.ownerIds, ...contacts, ...workers], 'workflow_step_late', 'Step is late',
          `“${title}” in “${inst.name}” is late (due ${due}, ${who}). ${consequence}`,
          this.instanceLink(inst.workflow_template_id, inst.id), inst.id),
      )
    }, TX_OPTIONS)
    await this.runEffects(effects)
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
  }

  /** Org-scoped, now-injected — cron passes real now, ReplayService passes the sim day. */
  async processSchedulesForOrg(orgId: string, now: Date): Promise<void> {
    if (!(await this.automationEnabled(orgId))) return
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
      include: { template: { select: { name: true, owner_user_ids: true, created_by_user_id: true } } },
      orderBy: [{ workflow_template_id: 'asc' }, { order_index: 'asc' }],
    })
    if (!entries.length) return
    const tz = await this.orgTimeZone(orgId)
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
          await this.createInstance(
            orgId,
            entry.workflow_template_id,
            SCHEDULE_START,
            { schedule_entry_id: entry.id, scheduled_for: occurrence.toISOString() },
            null,
            { startAt },
          )
        } catch (err) {
          const message = this.errorMessage(err)
          this.logger.error(`Schedule ${entry.id} could not start its workflow: ${message}`)
          await this.runEffects([
            () =>
              this.notifications.emit({
                orgId,
                module: 'workflows',
                event_type: 'workflow_stuck',
                recipients: this.ownersOf(entry.template),
                title: 'Scheduled run didn’t start',
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
  }

  /** Org-scoped, now-injected — cron passes real now, ReplayService passes the sim day. */
  async processWaitingStepsForOrg(orgId: string, now: Date): Promise<void> {
    if (!(await this.automationEnabled(orgId))) return
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
    const tz = await this.orgTimeZone(orgId)
    for (const r of due) {
      try {
        await this.startWaitingRow(orgId, r.workflow_instance_id, r.id, now, tz)
      } catch (err) {
        this.logger.error(`Starting waiting workflow step ${r.id} failed: ${(err as Error)?.stack ?? err}`)
        await this.markStuck(orgId, r.workflow_instance_id, r.id, this.errorMessage(err))
      }
    }
  }

  /**
   * Start one waiting row whose time has come, if its steps-before are still all done
   * (else it waits again from scratch). The step starts AT its start time when the tick
   * is less than a day late (replay walks whole days), else now.
   */
  private async startWaitingRow(orgId: string, instanceId: string, rowId: string, now: Date, tz: string): Promise<void> {
    const inst = await this.loadInstanceCtx(this.prisma, orgId, instanceId)
    if (!inst || !ADVANCEABLE.includes(inst.status as 'running')) return
    const effects: Effect[] = []
    await this.prisma.$transaction(async (tx) => {
      await this.lockInstance(tx, instanceId)
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
      await this.activateRow(tx, inst, row, startAt, tz, effects)
    }, TX_OPTIONS)
    await this.runEffects(effects)
  }
}
