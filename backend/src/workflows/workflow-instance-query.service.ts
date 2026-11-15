import { ACTIVE_ASSIGNEE } from '../tasks/active-assignee'
import { EVENT_LIMIT, INSTANCE_LIST_LIMIT, IN_FLIGHT, InstanceCapabilities, InstanceRow, MSG_NOT_FOUND, MSG_VIEW, NoteRow, RunDisplayStatus, SEND_BACK_FROM, SKIPPABLE, TERMINAL_TASK_TYPES, TaskSummary, WORKING, accessSelect, instanceInclude } from './workflow-template.types'
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Principal } from '../access-rights/permissions.service'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { SCHEDULE_START } from './engine/schedule'
import { TASK_TAG_REF_SELECT, flattenTags } from '../common/task-masters-usable'
import { WorkflowAccessService } from './workflow-access.service'
import { WorkflowDiscussionService } from './workflow-discussion.service'
import { byDisplayOrder, isLegacyBranchRow, rowDependencyMap, sendBackTargets } from './step-graph'
import { capabilitiesFor, isAdminPrincipal } from './workflow-access'
import { effectiveDueRule, effectiveStartRule } from './engine/timing'
import { ifLateOf } from './workflow-definition.validation'
import { instanceLabel } from './instance-label'
import { isRunParticipant, participantInstanceIds } from './run-access'
import { isWaitingRow } from './workflow-engine.shared'
import { noteOut, ownedWhere, ref, refs, rowLabels, runLanes, sendBackOf, stepTitle, unique } from './workflow-view.formatter'
import { readSnapshot } from './engine/snapshot'

/** Reads of workflow instances: the instance view, lists, tasks, history and a step's task context. */
@Injectable()
export class WorkflowInstanceQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly discussion: WorkflowDiscussionService,
    private readonly access: WorkflowAccessService,
  ) {}

  /**
   * Instances as every list and the instance page read them. Every row passed in is
   * one the caller may see. `opts.notes` (the instance page) adds each step's notes.
   */
  private async formatInstances(orgId: string, rows: InstanceRow[], p: Principal, opts: { notes?: boolean } = {}) {
    if (!rows.length) return []
    const allSteps = rows.flatMap((r) => r.steps)
    const legacyStepIds = unique(allSteps.filter((s) => !readSnapshot(s.step_snapshot)).map((s) => s.workflow_step_id))
    const taskIds = unique(allSteps.map((s) => s.task_id).filter((x): x is string => !!x))
    const [liveSteps, tasks, checklist, proofs] = await Promise.all([
      legacyStepIds.length
        ? this.prisma.workflowStep.findMany({
            where: { id: { in: legacyStepIds }, organization_id: orgId },
            select: {
              id: true,
              title: true,
              description: true,
              proof_required: true,
              checklist_items: true,
              due_days: true,
              due_time: true,
              if_late: true,
            },
          })
        : Promise.resolve(
            [] as {
              id: string
              title: string
              description: string | null
              proof_required: boolean
              checklist_items: Prisma.JsonValue
              due_days: number
              due_time: string
              if_late: string
            }[],
          ),
      taskIds.length
        ? this.prisma.task.findMany({
            where: { id: { in: taskIds }, organization_id: orgId },
            select: {
              id: true,
              is_deleted: true,
              deadline: true,
              is_overdue: true,
              completed_at: true,
              completion_mode: true,
              created_by_user_id: true,
              status: { select: { label: true, type: true, color: true } },
              assignees: { where: ACTIVE_ASSIGNEE, select: { user_id: true, is_cc: true } },
              escalations: { where: { escalate_to_user_id: p.userId }, select: { id: true } },
              _count: { select: { comments: { where: { is_deleted: false } } } },
            },
          })
        : Promise.resolve([]),
      taskIds.length
        ? this.prisma.taskChecklist.findMany({
            where: { task_id: { in: taskIds }, organization_id: orgId },
            select: { task_id: true, is_completed: true, cant_do: true, states: { select: { user_id: true } } },
          })
        : Promise.resolve([]),
      taskIds.length
        ? this.prisma.taskAttachment.findMany({
            where: {
              task_id: { in: taskIds },
              organization_id: orgId,
              is_proof: true,
              is_deleted: false,
              OR: [{ comment_id: null }, { comment: { is_deleted: false } }],
            },
            select: { task_id: true, uploaded_by_user_id: true, proof_visibility: true },
          })
        : Promise.resolve([]),
    ])
    const liveById = new Map(liveSteps.map((s) => [s.id, s]))
    const taskById = new Map(tasks.map((t) => [t.id, t]))
    const [{ tz, now }, notes, sendBacks] = await Promise.all([
      this.access.scheduleContext(orgId),
      opts.notes ? this.loadNotes(orgId, rows.map((r) => r.id)) : Promise.resolve([] as NoteRow[]),
      this.access.openSendBackEvents(orgId, allSteps),
    ])
    const notesByRow = new Map<string, NoteRow[]>()
    for (const n of notes) {
      if (!n.for_instance_step_id) continue
      const list = notesByRow.get(n.for_instance_step_id) ?? []
      list.push(n)
      notesByRow.set(n.for_instance_step_id, list)
    }
    const names = await this.access.userNames([
      ...tasks.flatMap((t) => t.assignees.map((a) => a.user_id)),
      ...allSteps.map((s) => s.assigned_to_user_id),
      ...rows.map((r) => r.triggered_by_user_id),
      ...notes.map((n) => n.author_user_id),
      ...[...sendBacks.values()].map((e) => e.actor_user_id),
    ])
    const checklistBy = new Map<string, typeof checklist>()
    for (const c of checklist) {
      const list = checklistBy.get(c.task_id) ?? []
      list.push(c)
      checklistBy.set(c.task_id, list)
    }
    const isAdmin = isAdminPrincipal(p)
    const proofCount = new Map<string, number>()
    for (const pr of proofs) {
      const t = taskById.get(pr.task_id)
      const visible =
        pr.proof_visibility === 'everyone' ||
        pr.uploaded_by_user_id === p.userId ||
        t?.created_by_user_id === p.userId ||
        isAdmin
      if (visible) proofCount.set(pr.task_id, (proofCount.get(pr.task_id) ?? 0) + 1)
    }

    const summarize = (taskId: string | null): TaskSummary | null => {
      const t = taskId ? taskById.get(taskId) : undefined
      if (!t || t.is_deleted) return null
      const workers = t.assignees.filter((a) => !a.is_cc).map((a) => a.user_id)
      const items = checklistBy.get(t.id) ?? []
      const done = items.filter((it) => {
        if (t.completion_mode === 'all_must_complete' && workers.length) {
          const marked = new Set(it.states.map((s) => s.user_id))
          return workers.every((w) => marked.has(w))
        }
        return it.is_completed || it.cant_do
      }).length
      return {
        id: t.id,
        status: t.status ? { label: t.status.label, type: t.status.type, color: t.status.color ?? null } : null,
        deadline: t.deadline,
        is_overdue: t.is_overdue,
        completed_at: t.completed_at,
        checklist_total: items.length,
        checklist_done: done,
        proof_count: proofCount.get(t.id) ?? 0,
        comment_count: t._count.comments,
      }
    }

    return rows.map((inst) => {
      const tcaps = capabilitiesFor(inst.template, p)
      const deps = rowDependencyMap(inst.steps)
      const inFlight = IN_FLIGHT.includes(inst.status)
      // Track and number of each step ("B2") as frozen when the run started; runs
      // started before tracks are laid out from their graph the same way.
      const lanes = runLanes(inst.steps, deps)
      const rowById = new Map(inst.steps.map((r) => [r.id, r]))

      const steps = [...inst.steps].sort(byDisplayOrder).map((s) => {
        // The frozen snapshot (legacy shapes normalised by the engine's reader); a row
        // without one falls back to the live template step.
        const snap = readSnapshot(s.step_snapshot)
        const live = snap ? null : liveById.get(s.workflow_step_id) ?? null
        const task = s.task_id ? taskById.get(s.task_id) : undefined
        const roster = task && !task.is_deleted ? task.assignees : []
        return {
          id: s.id,
          workflow_step_id: s.workflow_step_id,
          status: s.status as string,
          order_index: s.order_index,
          /** A legacy escalation row of the old engine (not part of the step flow). */
          is_branch: isLegacyBranchRow(s),
          track_key: lanes.trackOf.get(s.id) ?? null,
          /** "1", "B2" — the step's number in this run. */
          number_label: lanes.labels.get(s.id) ?? null,
          title: snap?.title ?? live?.title ?? 'Deleted step',
          description: snap ? snap.description : live?.description ?? null,
          depends_on_row_ids: deps.get(s.id) ?? [],
          waiting_on_row_id: s.waiting_on_row_id ?? null,
          returned_to_row_id: s.returned_to_row_id ?? null,
          sent_back_count: s.sent_back_count ?? 0,
          /** The open send-back this step is in (why, by whom, to / from which step), or null. */
          send_back: sendBackOf(s, rowById, sendBacks, lanes.labels, names),
          due_days: snap?.due_days ?? live?.due_days ?? null,
          due_time: snap?.due_time ?? live?.due_time ?? null,
          if_late: snap ? snap.if_late : live ? ifLateOf(live.if_late) : null,
          start_rule: effectiveStartRule(snap?.start_rule ?? null),
          due_rule: snap
            ? effectiveDueRule(snap.due_rule, snap.due_days, snap.due_time)
            : live
              ? effectiveDueRule(null, live.due_days, live.due_time)
              : null,
          planned_start_at: s.planned_start_at ?? null,
          planned_due_at: s.planned_due_at ?? null,
          /** Set while the step is ready but waiting for its start time. */
          start_at: s.start_at ?? null,
          waiting: isWaitingRow(s),
          proof_required: snap?.proof_required ?? live?.proof_required ?? false,
          checklist_items: snap
            ? (snap.checklist_items as unknown[])
            : Array.isArray(live?.checklist_items)
              ? (live!.checklist_items as unknown[])
              : [],
          scheduled_at: s.scheduled_at,
          task_created_at: s.task_created_at,
          completed_at: s.completed_at,
          created_at: s.created_at,
          last_error: s.last_error,
          task_id: s.task_id,
          // Only a step still waiting on its task is blocked by that task being gone —
          // a skipped/cancelled step's task is withdrawn on purpose.
          task_deleted: !!s.task_id && (!task || task.is_deleted) && WORKING.includes(s.status),
          task_open: !!task && !task.is_deleted && !TERMINAL_TASK_TYPES.includes(task.status.type),
          assigned_to: ref(s.assigned_to_user_id, names),
          assignees: refs(roster.filter((a) => !a.is_cc).map((a) => a.user_id), names),
          ccs: refs(roster.filter((a) => a.is_cc).map((a) => a.user_id), names),
          task: summarize(s.task_id),
          ...(opts.notes
            ? {
                /** Notes left for this step, newest first. */
                notes: (notesByRow.get(s.id) ?? []).map((n) =>
                  noteOut(n, names, tcaps.can_edit, p, {
                    row_id: s.id,
                    number_label: lanes.labels.get(s.id) ?? null,
                    title: snap?.title ?? live?.title ?? 'Deleted step',
                    status: s.status,
                  }),
                ),
              }
            : {}),
        }
      })
      type Row = (typeof steps)[number]
      const main = steps.filter((s) => !s.is_branch)

      // Works in it / ran it (computed from what is already loaded — same definition as
      // run-access.ts; withdrawn tasks count). Viewers see everything but change nothing.
      const runTasks = inst.steps.map((s) => (s.task_id ? taskById.get(s.task_id) : undefined))
      const worksInIt =
        inst.triggered_by_user_id === p.userId ||
        runTasks.some((t) => !!t && (t.assignees.some((a) => a.user_id === p.userId) || t.escalations.length > 0))

      const isWorker = (r: Row) => {
        const t = r.task_id ? taskById.get(r.task_id) : undefined
        return !!t && !t.is_deleted && t.assignees.some((a) => a.user_id === p.userId && !a.is_cc)
      }
      const canSendBackFrom = inFlight
        ? main
            .filter((r) => SEND_BACK_FROM.includes(r.status))
            .filter((r) => tcaps.can_edit || isWorker(r))
            .filter((r) => sendBackTargets(inst.steps, deps, r.id).length > 0)
            .map((r) => r.id)
        : []
      const skippable = inFlight && tcaps.can_edit ? main.filter((r) => SKIPPABLE.includes(r.status)).map((r) => r.id) : []
      const startNow = inFlight && tcaps.can_edit ? main.filter((r) => r.waiting).map((r) => r.id) : []

      // "Current" = steps being worked on now (or paused waiting for info).
      const current = main.filter(
        (r) => WORKING.includes(r.status) || r.status === 'sent_back' || (r.status === 'moved_on' && r.task_open),
      )
      const hasError = !!inst.last_error || main.some((r) => !!r.last_error)
      const stranded =
        inst.status === 'stuck' ||
        hasError ||
        (current.length === 0 && !main.some((r) => r.waiting) && main.some((r) => r.status === 'pending')) ||
        main.some((r) => WORKING.includes(r.status) && !r.task_open)

      let display: RunDisplayStatus
      if (inst.status === 'cancelled') display = 'cancelled'
      else if (inst.status === 'completed') display = 'completed'
      else if (inst.status === 'stuck' || hasError) display = 'needs_attention'
      else if (main.some((r) => r.status === 'sent_back')) display = 'waiting_for_info'
      else if (
        main.some(
          (r) =>
            r.status === 'overdue' ||
            (r.status === 'moved_on' && r.task_open) ||
            (WORKING.includes(r.status) && !!r.task?.is_overdue),
        )
      )
        display = 'falling_behind'
      else display = 'running'

      return {
        id: inst.id,
        /** "Instance #12" — numbered per workflow in start order. */
        instance_number: inst.instance_number,
        name: inst.name,
        /** The badge label: "<instance name> · 3 Nov" (manual) / "<workflow name> · 3 Nov" (schedule). */
        label: instanceLabel(inst, inst.template.name, tz, now),
        status: inst.status,
        display_status: display,
        trigger_type: inst.trigger_type,
        /** Started by a schedule (no person ran it). */
        is_scheduled: inst.trigger_type === SCHEDULE_START,
        started_at: inst.started_at,
        completed_at: inst.completed_at,
        last_error: inst.last_error,
        template: { id: inst.template.id, name: inst.template.name },
        triggered_by: ref(inst.triggered_by_user_id, names),
        capabilities: {
          can_cancel: tcaps.can_edit && inFlight,
          can_retry: tcaps.can_edit && inFlight && stranded,
          can_skip: skippable.length > 0,
          can_skip_row_ids: skippable,
          can_upload: tcaps.can_edit || worksInIt,
          can_view_documents: true,
          can_post_message: true,
          can_add_note: true,
          can_send_back_from: canSendBackFrom,
          can_start_now_row_ids: startNow,
        } satisfies InstanceCapabilities,
        /** The run's tracks (lanes), main first. */
        tracks: lanes.tracks,
        steps: [...main, ...steps.filter((s) => s.is_branch)],
        progress: {
          total: main.length,
          // Cancelling marks the remaining steps skipped; they weren't done, so a
          // cancelled run only counts what was actually completed.
          completed: main.filter(
            (s) => s.status === 'completed' || (s.status === 'skipped' && inst.status !== 'cancelled'),
          ).length,
          current_step_titles: inFlight ? current.map((r) => r.title) : [],
          current_step_title: inFlight ? current[0]?.title ?? null : null,
        },
      }
    })
  }

  /** Live tagged messages ("For <step>") of these instances, newest first. Org-scoped. */
  private async loadNotes(orgId: string, instanceIds: string[], forRowId?: string): Promise<NoteRow[]> {
    return this.discussion.taggedMessages(orgId, instanceIds, forRowId)
  }

  async instanceDetail(orgId: string, templateId: string, instanceId: string, p: Principal) {
    const { inst } = await this.access.loadInstance(orgId, templateId, instanceId, p)
    const [[out], counts] = await Promise.all([
      this.formatInstances(orgId, [inst], p, { notes: true }),
      this.discussion.counts(orgId, inst.id, p.userId),
    ])
    /** The discussion header: live messages and the caller's unread ones. */
    return { ...out, discussion: { count: counts.count, unread_count: counts.unread_count } }
  }

  /**
   * A workflow's instances. Admins, editors and viewers: all of them. Others: only the
   * instances they ran or work in ("My instances of this workflow") — a starter with
   * none gets an empty list; anyone else with none gets 403.
   */
  async listInstances(orgId: string, templateId: string, p: Principal) {
    const t = await this.prisma.workflowTemplate.findFirst({
      where: { id: templateId, organization_id: orgId },
      select: accessSelect(p.userId),
    })
    if (!t) throw new NotFoundException(MSG_NOT_FOUND)
    const caps = capabilitiesFor(t, p)
    let visible: Prisma.WorkflowInstanceWhereInput = {}
    if (!caps.can_view) {
      const mine = await participantInstanceIds(this.prisma, orgId, p.userId, { templateId, includeStarted: true })
      if (!mine.length && !caps.is_starter) throw new ForbiddenException(MSG_VIEW)
      visible = { id: { in: mine } }
    }
    const rows = await this.prisma.workflowInstance.findMany({
      where: { workflow_template_id: templateId, organization_id: orgId, ...visible },
      include: instanceInclude(p.userId),
      orderBy: { started_at: 'desc' },
      take: INSTANCE_LIST_LIMIT,
    })
    return this.formatInstances(orgId, rows, p)
  }

  async getInstance(orgId: string, templateId: string, instanceId: string, p: Principal) {
    return this.instanceDetail(orgId, templateId, instanceId, p)
  }

  async getInstanceTasks(orgId: string, templateId: string, instanceId: string, p: Principal) {
    await this.access.loadInstance(orgId, templateId, instanceId, p)
    const steps = await this.prisma.workflowInstanceStep.findMany({
      where: { workflow_instance_id: instanceId, organization_id: orgId, task_id: { not: null } },
      select: { task_id: true },
    })
    const taskIds = steps.map((s) => s.task_id!).filter(Boolean)
    if (!taskIds.length) return []
    const tasks = await this.prisma.task.findMany({
      where: { id: { in: taskIds }, organization_id: orgId },
      select: {
        id: true,
        title: true,
        description: true,
        deadline: true,
        is_deleted: true,
        is_overdue: true,
        completed_at: true,
        created_at: true,
        proof_required: true,
        workflow_instance_step_id: true,
        status: { select: { id: true, label: true, type: true, color: true } },
        priority: { select: { id: true, label: true, color: true } },
        category: { select: { id: true, name: true, color: true } },
        assignees: { where: ACTIVE_ASSIGNEE, select: { user_id: true, is_completed: true, is_cc: true } },
        ...TASK_TAG_REF_SELECT,
      },
    })
    const names = await this.access.userNames(tasks.flatMap((t) => t.assignees.map((a) => a.user_id)))
    return tasks.map((t) =>
      flattenTags({
        ...t,
        assignees: t.assignees.map((a) => ({ ...a, name: names.get(a.user_id) ?? 'Unknown user' })),
      }),
    )
  }

  async getOwnedInstances(orgId: string, p: Principal) {
    const rows = await this.prisma.workflowInstance.findMany({
      where: { organization_id: orgId, status: { in: IN_FLIGHT }, template: ownedWhere(orgId, p.userId) },
      include: instanceInclude(p.userId),
      orderBy: { started_at: 'desc' },
      take: INSTANCE_LIST_LIMIT,
    })
    return this.formatInstances(orgId, rows, p)
  }

  /**
   * "Instances I work in": running instances in which the caller is an assignee, CC or
   * escalation contact of a step task.
   */
  async getAssignedInstances(orgId: string, p: Principal) {
    const ids = await participantInstanceIds(this.prisma, orgId, p.userId)
    if (!ids.length) return []
    const rows = await this.prisma.workflowInstance.findMany({
      where: { id: { in: ids }, organization_id: orgId, status: { in: IN_FLIGHT } },
      include: instanceInclude(p.userId),
      orderBy: { started_at: 'desc' },
      take: INSTANCE_LIST_LIMIT,
    })
    return this.formatInstances(orgId, rows, p)
  }

  /** Run history, newest first. */
  async listEvents(orgId: string, templateId: string, instanceId: string, p: Principal) {
    await this.access.loadInstance(orgId, templateId, instanceId, p)
    const events = await this.prisma.workflowInstanceEvent.findMany({
      where: { workflow_instance_id: instanceId, organization_id: orgId },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: EVENT_LIMIT,
    })
    const names = await this.access.userNames(events.map((e) => e.actor_user_id))
    return events.map((e) => ({
      id: e.id,
      type: e.type,
      message: e.message,
      actor: ref(e.actor_user_id, names),
      instance_step_id: e.instance_step_id,
      created_at: e.created_at,
      metadata: e.metadata ?? null,
    }))
  }

  /**
   * The workflow context of a task (task-detail banner + Send back), gated by the
   * TASK view rule. `null` when the task isn't a workflow step task (or its instance is
   * gone). `notes` = the notes left for this step ("Notes for this step"), newest first.
   */
  async getStepContext(orgId: string, taskId: string, p: Principal) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organization_id: orgId, is_deleted: false },
      select: { id: true, workflow_instance_step_id: true },
    })
    if (!task) throw new NotFoundException('Task not found')
    await this.access.assertCanViewTask(orgId, p, taskId)
    if (!task.workflow_instance_step_id) return null

    const link = await this.prisma.workflowInstanceStep.findFirst({
      where: { id: task.workflow_instance_step_id, organization_id: orgId },
      select: { workflow_instance_id: true },
    })
    if (!link) return null
    const inst = await this.prisma.workflowInstance.findFirst({
      where: { id: link.workflow_instance_id, organization_id: orgId },
      include: instanceInclude(p.userId),
    })
    if (!inst) return null
    const row = inst.steps.find((s) => s.id === task.workflow_instance_step_id)
    if (!row) return null

    const caps = capabilitiesFor(inst.template, p)
    const main = inst.steps.filter((s) => !isLegacyBranchRow(s)).sort(byDisplayOrder)
    const inFlight = IN_FLIGHT.includes(inst.status)
    const mayAct = caps.can_edit || (await this.access.isRowWorker(orgId, row.task_id, p.userId))
    const canSendBack =
      inFlight &&
      SEND_BACK_FROM.includes(row.status) &&
      mayAct &&
      sendBackTargets(inst.steps, rowDependencyMap(inst.steps), row.id).length > 0
    const canOpenRun = caps.can_view || (await isRunParticipant(this.prisma, orgId, inst.id, p.userId))
    const index = main.findIndex((s) => s.id === row.id)
    const labels = rowLabels(inst)
    const [{ tz, now }, notes, sendBacks, counts] = await Promise.all([
      this.access.scheduleContext(orgId),
      this.loadNotes(orgId, [inst.id], row.id),
      this.access.openSendBackEvents(orgId, inst.steps),
      canOpenRun ? this.discussion.counts(orgId, inst.id, p.userId) : Promise.resolve(null),
    ])
    const names = await this.access.userNames([
      inst.triggered_by_user_id,
      ...notes.map((n) => n.author_user_id),
      ...[...sendBacks.values()].map((e) => e.actor_user_id),
    ])
    const forStep = {
      row_id: row.id,
      number_label: labels.get(row.id) ?? null,
      title: stepTitle(row),
      status: row.status as string,
    }
    return {
      template_id: inst.template.id,
      template_name: inst.template.name,
      instance_id: inst.id,
      instance_name: inst.name,
      /** "Instance #12". */
      instance_number: inst.instance_number,
      /** The badge label ("ACME onboarding · 3 Nov"). */
      instance_label: instanceLabel(inst, inst.template.name, tz, now),
      instance_status: inst.status,
      started_at: inst.started_at,
      /** Null when a schedule started it. */
      started_by: ref(inst.triggered_by_user_id, names),
      row_id: row.id,
      row_status: row.status as string,
      step_title: stepTitle(row),
      step_number: index >= 0 ? index + 1 : null,
      /** "1", "B2" — the step's number in its instance. */
      step_label: labels.get(row.id) ?? (index >= 0 ? `${index + 1}` : null),
      total_steps: main.length,
      can_send_back: canSendBack,
      can_open_run: canOpenRun,
      /** This step's open send-back (asked for more info / waiting for info), or null. */
      send_back: sendBackOf(row, new Map(inst.steps.map((r) => [r.id, r])), sendBacks, labels, names),
      /** Messages left for this step ("For <step>"), newest first — "Notes for this step". */
      notes: notes.map((n) => noteOut(n, names, caps.can_edit, p, forStep)),
      /**
       * The task's Comments section shows the instance discussion when the caller can see
       * the instance (else the task's own comments). Counts for its header.
       */
      can_view_discussion: canOpenRun,
      discussion: counts ? { count: counts.count, unread_count: counts.unread_count } : null,
    }
  }
}
