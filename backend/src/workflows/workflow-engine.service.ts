import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { ClockService } from '../clock/clock.service'
import { EDITORS_SELECT, Effect, InstanceCtx, TX_OPTIONS, Tx, activeMembers, editorsOf, formatStartMoment, instanceLink, instanceName, instanceNameTaken, isWaitingRow, loadChecklistTemplates, nextInstanceNumber, taskWorkers, uniqueViolationOn, userName } from './workflow-engine.shared'
import { Frequency, cycleLengthOf, frequencyOf } from './engine/timing'
import { MAIN_TRACK, resolveStoredTracks } from './tracks'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { SCHEDULE_START } from './engine/schedule'
import { WorkflowEngineRowsService } from './workflow-engine-rows.service'
import { WorkflowEngineSupportService } from './workflow-engine-support.service'
import { applyChecklistTemplates, buildStepSnapshot, isBranchRow, readSnapshot, snapshotTemplateIds } from './engine/snapshot'
import { localDateOf } from './engine/tz'
import { shortDate } from './instance-label'

/**
 * The workflow engine (workflows v2 §B): runs are DAGs of steps; every step is a task
 * the system creates. This service creates instances; the rest lives beside it:
 *  - WorkflowEngineSupportService  plumbing (events, notifications, planning, stuck)
 *  - WorkflowEngineRowsService     row activation and settling
 *  - WorkflowRunActionsService     send back / cancel / retry / skip / start now
 *  - WorkflowTaskEventsService     task-event hooks (complete / reopen / delete / escalate)
 *  - WorkflowSweepsService         the three cron sweeps
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly support: WorkflowEngineSupportService,
    private readonly rows: WorkflowEngineRowsService,
  ) {}

  /**
   * "Starting soon" heads-ups when an instance starts: every assignee of a step that
   * did not start with it and is planned to start on a LATER DAY (org calendar) gets
   * ONE notification naming their step(s) and the planned day. Nothing for daily
   * workflows, nor for steps planned the same day. Assignees are the step's active
   * people as frozen in its snapshot.
   */
  private async upcomingHeadsUps(tx: Tx, inst: InstanceCtx, frequency: Frequency, now: Date, tz: string): Promise<Effect[]> {
    if (frequency.kind === 'daily') return []
    const orgId = inst.organization_id
    const rows = await tx.workflowInstanceStep.findMany({
      where: { workflow_instance_id: inst.id, organization_id: orgId, status: 'pending', planned_start_at: { not: null } },
      select: { id: true, step_snapshot: true, planned_start_at: true, order_index: true },
      orderBy: [{ planned_start_at: 'asc' }, { order_index: 'asc' }],
    })
    const today = localDateOf(now, tz)
    const byUser = new Map<string, { title: string; at: Date }[]>()
    for (const r of rows) {
      const snap = readSnapshot(r.step_snapshot)
      if (!snap || isBranchRow(r)) continue
      const day = localDateOf(r.planned_start_at!, tz)
      const later = day.year * 10000 + day.month * 100 + day.day > today.year * 10000 + today.month * 100 + today.day
      if (!later) continue
      for (const u of await activeMembers(tx, orgId, snap.assignee_user_ids)) {
        const list = byUser.get(u) ?? []
        list.push({ title: snap.title, at: r.planned_start_at! })
        byUser.set(u, list)
      }
    }
    const link = instanceLink(inst.workflow_template_id, inst.id)
    const effects: Effect[] = []
    for (const [userId, steps] of byUser) {
      const body =
        steps.length === 1
          ? `“${inst.templateName}” has started. Your step “${steps[0].title}” is planned around ${shortDate(steps[0].at, tz, now)}.`
          : `“${inst.templateName}” has started. Your steps are planned: ${steps
              .map((x) => `“${x.title}” around ${shortDate(x.at, tz, now)}`)
              .join(', ')}.`
      effects.push(this.support.notify(orgId, [userId], 'workflow_step_upcoming', 'Your step is coming up', body, link, inst.id))
    }
    return effects
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
        access: EDITORS_SELECT.access,
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
    if (!(await this.support.automationEnabled(orgId))) {
      throw new ForbiddenException(
        'Starting instances needs the full Workflows module. Ask your administrator to turn it on.',
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

    const tz = await this.support.orgTimeZone(orgId)
    const now = opts?.startAt ?? (await this.clock.now(orgId))
    const editorIds = editorsOf(template)

    // Step timing: the cycle length comes from the workflow's schedules (a manual start
    // of a scheduled workflow resolves calendar timing from its own start); every row
    // gets its planned start → due, planned in dependency order from this start.
    const frequency = frequencyOf(template.schedules ?? [])
    const every = cycleLengthOf(frequency)
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
    const plan = await this.support.planTimeline(
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

    let instanceId = ''
    let effects: Effect[] = []
    // An automatic name can lose a race to a concurrent start only in theory (the
    // template row is locked first); a retry picks the next free name.
    for (let attempt = 0; ; attempt++) {
      let typedName = false
      effects = []
      try {
        instanceId = await this.prisma.$transaction(async (tx) => {
          const instanceNumber = await nextInstanceNumber(tx, orgId, templateId)
          const named = await instanceName(tx, orgId, templateId, template.name, context, now, tz)
          typedName = named.typed
          const name = named.name
          const instance = await tx.workflowInstance.create({
            data: {
              organization_id: orgId,
              workflow_template_id: templateId,
              name,
              name_key: named.name_key,
              instance_number: instanceNumber,
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
          const checklistTemplates = await loadChecklistTemplates(tx, orgId, [
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
            editorIds,
          }
          const starter = triggeredByUserId ? await userName(tx, triggeredByUserId) : null
          await this.support.event(tx, {
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
          await this.rows.settle(tx, inst, now, tz, effects)

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
          // Editors hear the instance started; first-step assignees already get their own
          // assignment notification (queued by activation) — not two.
          const firstWorkers = new Set<string>()
          for (const s of started) for (const u of await taskWorkers(tx, orgId, s.task_id)) firstWorkers.add(u)
          const titleOfRow = (s: { step_snapshot: unknown }) => `“${readSnapshot(s.step_snapshot)?.title ?? 'Step'}”`
          const firstLine = started.length
            ? `First step${started.length > 1 ? 's' : ''}: ${started.map(titleOfRow).join(', ')}.`
            : `First step${waiting.length > 1 ? 's' : ''}: ${waiting
                .map((s) => `${titleOfRow(s)} (starts ${formatStartMoment(s.start_at!, tz)})`)
                .join(', ')}.`
          effects.unshift(
            this.support.notify(orgId, editorIds.filter((o) => !firstWorkers.has(o)), 'workflow_triggered', 'Workflow started',
              `Instance #${instanceNumber} “${name}” started. ${firstLine}`,
              instanceLink(templateId, instance.id), instance.id),
          )
          effects.push(...(await this.upcomingHeadsUps(tx, inst, frequency, now, tz)))
          return instance.id
        }, TX_OPTIONS)
        break
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          // Lost a race on the (trigger_id, source_task_id) dedupe key → the other start wins.
          if (opts?.triggerId && opts?.sourceTaskId && !uniqueViolationOn(err, 'name_key')) {
            const dup = await this.prisma.workflowInstance.findFirst({
              where: { trigger_id: opts.triggerId, source_task_id: opts.sourceTaskId },
              select: { id: true },
            })
            if (dup) return dup
          }
          if (uniqueViolationOn(err, 'name_key') || !opts?.triggerId) {
            if (typedName) throw instanceNameTaken()
            if (attempt < 3) continue
          }
        }
        throw err
      }
    }

    await this.support.runEffects(effects)
    return { id: instanceId }
  }
}
