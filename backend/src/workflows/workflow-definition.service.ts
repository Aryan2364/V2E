import { ALLOWED_ATTACHMENT_EXTENSIONS, normaliseExtensions } from '../tasks/task-attachments.service'
import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common'
import { ChecklistAccessService } from '../task-masters/checklist-access.service'
import { ChecklistItemDto, DEFAULT_DUE_DAYS, DEFAULT_DUE_TIME, DefinitionStepDto, SaveDefinitionDto } from './dto/definition.dto'
import { ClockService } from '../clock/clock.service'
import { Frequency, RunStartPoint, RunStartScheduleLike, firstStepTimingProblem, frequencyOf, laterStepTimingProblem, looseRule, parseDueRule, parseStartRule, runStartPointOf, timingProblem } from './engine/timing'
import { LIVE, MSG_CONFLICT, MSG_MANAGE, MSG_NO_START, MSG_PICK_STARTERS, ProposedStep, StepState, StoredChecklistItem } from './workflow-template.types'
import { MAIN_TRACK, planTracks } from './tracks'
import { Principal } from '../access-rights/permissions.service'
import { Prisma, WorkflowAccessType, WorkflowScheduleEntry, WorkflowStep, WorkflowTemplateStatus } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { WorkflowAccessService } from './workflow-access.service'
import { WorkflowTemplateViewService } from './workflow-template-view.service'
import { WorkflowTimelineService } from './workflow-timeline.service'
import { applyGrants, applySchedules, applySteps, escalationModeOf, ifLateOf, sameSet, sampleOrderMessages, scheduleData, startsError, stepError, stepLabel, stepRunnableProblem, throwTrackProblem, trackError } from './workflow-definition.validation'
import { assertActiveOrgMembers } from '../common/org-members'
import { assertMastersUsable, assertTagsUsable } from '../common/task-masters-usable'
import { checklistTemplateIds, templateItemTitles } from './engine/snapshot'
import { natureOfSchedules, scheduleEntryProblem } from './engine/schedule'
import { randomUUID } from 'crypto'
import { safeTimeZone } from './engine/tz'
import { stateOf, unique } from './workflow-view.formatter'

/** Saving a workflow definition: validation, steps, schedules, grants, checklists. */
@Injectable()
export class WorkflowDefinitionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly checklistAccess: ChecklistAccessService,
    private readonly access: WorkflowAccessService,
    private readonly templateView: WorkflowTemplateViewService,
    private readonly timelineService: WorkflowTimelineService,
  ) {}

  /** `POST /workflows/definition` — any member may create a workflow (they own it). */
  async createDefinition(orgId: string, dto: SaveDefinitionDto, p: Principal) {
    return this.saveDefinition(orgId, null, dto, p)
  }

  /** `PUT /workflows/:id/definition` — needs `can_edit`; owners/editors need `can_manage_access`. */
  async updateDefinition(orgId: string, templateId: string, dto: SaveDefinitionDto, p: Principal) {
    return this.saveDefinition(orgId, templateId, dto, p)
  }

  /**
   * Save the whole workflow — details, how it starts (manual + who may start it,
   * schedules), steps in their tracks (split points and "Also wait for" may name steps
   * that don't exist yet) and people — in ONE transaction. Every step's
   * `depends_on_step_ids` is derived here from the tracks (tracks.ts); the engine reads
   * only that.
   *
   * Validation: always the structure (known tracks, split points and "Also wait for"
   * steps in other tracks, no loops, people/masters/tags/checklists usable); empty
   * tracks other than main are dropped. Everything else — every step runnable, a
   * way to start, complete schedules, someone who can start it by hand — only on Save
   * (`mode: 'save'`) or when the workflow is Live/Paused (a live workflow can never be
   * saved broken) — including a step on the main track. A draft saved with
   * `mode: 'save'` becomes Live. Errors name the step (`step_key` / `step_id`, by its
   * number: "Step B2 “Sign-off”"), the track (`code: 'track_invalid'`, `track_key`) or
   * the schedule (`schedule_index`).
   *
   * Steps: listed `id`s are kept (and must be this workflow's), new ones get ids here,
   * unlisted ones are deleted. Schedules likewise. Running runs keep their snapshots.
   */
  private async saveDefinition(orgId: string, templateId: string | null, dto: SaveDefinitionDto, p: Principal) {
    // ── Gate + current state ──
    const loaded = templateId ? await this.access.loadEditable(orgId, templateId, p) : null
    const t = loaded?.t ?? null
    if (t && dto.expected_updated_at && new Date(dto.expected_updated_at).getTime() !== t.updated_at.getTime()) {
      throw new ConflictException(MSG_CONFLICT)
    }
    const status: WorkflowTemplateStatus = t?.status ?? 'draft'
    const full = LIVE.includes(status) || dto.mode === 'save'

    const [existingSteps, existingSchedules, grants] = templateId
      ? await Promise.all([
          this.prisma.workflowStep.findMany({
            where: { workflow_template_id: templateId, organization_id: orgId, is_branch_step: false },
          }),
          this.prisma.workflowScheduleEntry.findMany({
            where: { workflow_template_id: templateId, organization_id: orgId },
          }),
          this.prisma.workflowAccess.findMany({
            where: { workflow_template_id: templateId, organization_id: orgId },
            select: { user_id: true, access_type: true },
          }),
        ])
      : [[] as WorkflowStep[], [] as WorkflowScheduleEntry[], [] as { user_id: string; access_type: WorkflowAccessType }[]]

    // ── People: editors + viewers (the creator is always an editor, never stored as a grant) ──
    const creatorId = t ? t.created_by_user_id : p.userId
    const curEditors = unique(grants.filter((g) => g.access_type === 'edit').map((g) => g.user_id)).filter(
      (id) => id !== creatorId,
    )
    const curViewers = unique(grants.filter((g) => g.access_type === 'view').map((g) => g.user_id)).filter(
      (id) => id !== creatorId && !curEditors.includes(id),
    )
    let editors = curEditors
    let viewers = curViewers
    if (dto.people) {
      // Listing the creator (or not) changes nothing: they can't be removed.
      const nextEditors = unique(dto.people.editor_user_ids).filter((id) => id !== creatorId)
      const nextViewers =
        dto.people.viewer_user_ids === undefined
          ? curViewers.filter((id) => !nextEditors.includes(id))
          : unique(dto.people.viewer_user_ids).filter((id) => id !== creatorId && !nextEditors.includes(id))
      if (!sameSet(nextEditors, curEditors) || !sameSet(nextViewers, curViewers)) {
        // Editors and admins manage people (a creator always may on a new workflow).
        if (loaded && !loaded.caps.can_manage_access) throw new ForbiddenException(MSG_MANAGE)
        const known = new Set([...curEditors, ...curViewers])
        await assertActiveOrgMembers(
          this.prisma,
          orgId,
          [...nextEditors, ...nextViewers].filter((id) => !known.has(id)),
          'people you added',
        )
        editors = nextEditors
        viewers = nextViewers
      }
    }

    // ── Who may start it by hand (part of "How it starts": anyone who can edit) ──
    const curStarters = t ? unique(grants.filter((g) => g.access_type === 'trigger').map((g) => g.user_id)) : null
    let starters: string[]
    if (dto.starts.manual.starter_user_ids !== undefined) {
      starters = unique(dto.starts.manual.starter_user_ids)
      const known = new Set(curStarters ?? [])
      await assertActiveOrgMembers(
        this.prisma,
        orgId,
        starters.filter((id) => !known.has(id)),
        'people who can start it',
      )
    } else {
      // A new workflow starts with its creator as its starter.
      starters = curStarters ?? [creatorId]
    }
    const manual = dto.starts.manual.enabled

    // ── Steps: keys → ids, states; tracks → the graph (derived, never sent) ──
    const keys = dto.steps.map((s) => s.key)
    if (new Set(keys).size !== keys.length) throw new BadRequestException('Each step must be listed only once.')
    const existingById = new Map(existingSteps.map((s) => [s.id, s]))
    const keptIds = dto.steps.map((s) => s.id).filter((x): x is string => !!x)
    if (new Set(keptIds).size !== keptIds.length || keptIds.some((id) => !existingById.has(id))) {
      throw new BadRequestException('One of the steps no longer exists. Reload and try again.')
    }
    const idOf = new Map(dto.steps.map((s) => [s.key, s.id ?? randomUUID()]))
    const states = new Map<string, StepState>()
    for (const sd of dto.steps) {
      states.set(sd.key, await this.resolveStepState(orgId, p, sd, sd.id ? existingById.get(sd.id)! : null))
    }
    // Structure (every save, drafts too): known tracks, split points and merges; no loops.
    const { plan, problem: structure } = planTracks(
      dto.tracks,
      dto.steps.map((sd) => ({ key: sd.key, title: states.get(sd.key)!.title, track_key: sd.track_key, merge_step_keys: sd.merge_step_keys })),
    )
    if (structure) throwTrackProblem(structure, idOf, existingById)
    const sdByKey = new Map(dto.steps.map((sd) => [sd.key, sd]))
    // In display order (tracks in order, each in its own order) — the order errors are found in.
    const proposed: ProposedStep[] = plan.display.map((key) => {
      const sd = sdByKey.get(key)!
      return {
        key,
        id: idOf.get(key)!,
        existing: sd.id ? existingById.get(sd.id)! : null,
        state: states.get(key)!,
        track_key: plan.trackOf.get(key) ?? MAIN_TRACK,
        order_index: plan.position.get(key) ?? 0,
        label: plan.labels.get(key) ?? '?',
        merges: (plan.merges.get(key) ?? []).map((k) => idOf.get(k)!),
        deps: (plan.deps.get(key) ?? []).map((k) => idOf.get(k)!),
      }
    })
    const tracks = plan.tracks.map((t) => ({
      key: t.key,
      name: t.name,
      split_from_step_id: t.split_from ? idOf.get(t.split_from)! : null,
    }))

    // ── Schedules ──
    const existingSchedById = new Map(existingSchedules.map((e) => [e.id, e]))
    const keptSched = dto.starts.schedules.map((e) => e.id).filter((x): x is string => !!x)
    if (new Set(keptSched).size !== keptSched.length || keptSched.some((id) => !existingSchedById.has(id))) {
      throw new BadRequestException('One of the schedules no longer exists. Reload and try again.')
    }
    const schedules = dto.starts.schedules.map((e, i) =>
      scheduleData(e, i, e.id ? existingSchedById.get(e.id)! : null),
    )
    // How it repeats decides which step timings are allowed (checked on Save).
    const frequency = frequencyOf(schedules.map((x) => x.data))
    // Where a run starts in its cycle: first steps must be timed on or after it.
    const runStart = runStartPointOf(schedules.map((x) => x.data), frequency)

    // ── Full validation (Save / Live), in the order the form reads ──
    if (full) {
      if (manual) {
        if ((await this.access.activeMemberSet(orgId, starters)).size === 0) throw startsError(MSG_PICK_STARTERS)
      } else if (schedules.length === 0) {
        throw startsError(MSG_NO_START)
      }
      for (const [i, e] of dto.starts.schedules.entries()) {
        const why = scheduleEntryProblem(e)
        if (why) throw startsError(`Schedule ${i + 1}: ${why}`, i)
      }
      if (!proposed.length) throw stepError('Add at least one step.', null, null)
      if (!proposed.some((x) => x.track_key === MAIN_TRACK)) {
        throw trackError('Main path: add at least one step.', MAIN_TRACK)
      }
      const problem = await this.definitionProblem(orgId, proposed, frequency, runStart, schedules.map((x) => x.data))
      if (problem) throw stepError(problem.message, problem.step.existing?.id ?? null, problem.step.key)
    }
    // Complete rules are stored in their canonical shape (a draft keeps partial ones).
    for (const s of proposed) {
      const start = s.state.start_rule ? parseStartRule(s.state.start_rule) : null
      if (start?.ok) s.state.start_rule = { ...start.rule }
      const due = s.state.due_rule ? parseDueRule(s.state.due_rule) : null
      if (due?.ok) s.state.due_rule = { ...due.rule }
    }

    // ── Apply (one transaction) ──
    const nextStatus: WorkflowTemplateStatus = status === 'draft' && dto.mode === 'save' ? 'active' : status
    const goingLive = nextStatus === 'active' && status !== 'active'
    const orgNow = await this.clock.now(orgId)
    const assignersActive = await this.access.activeMemberSet(
      orgId,
      proposed.filter((s) => s.existing).map((s) => s.existing!.assigner_user_id),
    )
    const nature = natureOfSchedules(schedules.map((x) => x.data))
    const description = dto.description?.trim() || null

    const savedId = await this.prisma.$transaction(async (tx) => {
      let id: string
      if (!t) {
        const row = await tx.workflowTemplate.create({
          data: {
            organization_id: orgId,
            name: dto.name,
            description,
            // Back-compat only (owners are retired from access).
            owner_user_ids: [p.userId],
            created_by_user_id: p.userId,
            status: nextStatus,
            manual_start_enabled: manual,
            workflow_nature: nature.workflow_nature,
            recurring_type: nature.recurring_type,
            tracks: tracks as unknown as Prisma.InputJsonArray,
          },
          select: { id: true },
        })
        id = row.id
      } else {
        id = t.id
        // Guarded on the version we loaded: a save that raced ours is a 409, not lost work.
        const res = await tx.workflowTemplate.updateMany({
          where: { id, organization_id: orgId, updated_at: t.updated_at, status },
          data: {
            name: dto.name,
            description,
            status: nextStatus,
            manual_start_enabled: manual,
            workflow_nature: nature.workflow_nature,
            recurring_type: nature.recurring_type,
            tracks: tracks as unknown as Prisma.InputJsonArray,
            updated_at: new Date(),
          },
        })
        if (res.count !== 1) throw new ConflictException(MSG_CONFLICT)
      }
      await applySteps(tx, orgId, id, p.userId, proposed, existingSteps, assignersActive)
      await applySchedules(tx, orgId, id, schedules, existingSchedules, orgNow, goingLive)
      await applyGrants(tx, orgId, id, grants, editors, viewers, starters)
      return id
    })

    const detail = await this.templateView.templateDetail(orgId, savedId, p)
    const warnings = await this.timelineService.saveWarnings(orgId, proposed, schedules.map((x) => x.data))
    return { ...detail, step_keys: Object.fromEntries(proposed.map((s) => [s.key, s.id])), warnings }
  }

  /**
   * Validate + normalize a step's checklist (linked checklist templates).
   *
   * Items carrying a `template_id` belong to an org checklist template. A template
   * NEWLY linked on this step must exist in this org and be one the editor may use
   * — the exact gate task creation applies (`ChecklistAccessService.isAccessible`,
   * which also requires it to be active); 403 otherwise. A template already on the
   * step is kept whatever has happened to it since (deactivated, deleted, access
   * revoked), so the step stays editable and runs fall back to its saved copy.
   *
   * Stored result (the backup copy): an active template's group is rewritten to the
   * template's current items (group_title = its name) at the position of the group's
   * first item; an inactive/deleted one keeps the copy already stored on the step.
   * The editor's own items are kept as sent. Items are stored in array order.
   */
  private async normalizeChecklist(
    orgId: string,
    p: Principal,
    items: ChecklistItemDto[] | undefined,
    stored: unknown,
  ): Promise<StoredChecklistItem[]> {
    const incoming = items ?? []
    const ids = checklistTemplateIds(incoming)
    const alreadyLinked = new Set(checklistTemplateIds(stored))
    const templates = ids.length
      ? await this.prisma.taskChecklistTemplate.findMany({
          where: { id: { in: ids }, organization_id: orgId },
          select: { id: true, name: true, is_active: true, items: true },
        })
      : []
    const byId = new Map(templates.map((t) => [t.id, t]))
    for (const id of ids) {
      if (alreadyLinked.has(id)) continue
      if (!byId.has(id)) {
        throw new BadRequestException(
          'That checklist template no longer exists. Remove it from the step.',
        )
      }
      if (!(await this.checklistAccess.isAccessible(orgId, p.userId, id))) {
        throw new ForbiddenException('You are not allowed to use this checklist template.')
      }
    }

    // The copy already saved on the step, per template (kept for inactive/deleted ones).
    const storedCopy = new Map<string, { title: string; group_title?: string }[]>()
    for (const raw of Array.isArray(stored) ? stored : []) {
      const it = (raw && typeof raw === 'object' ? raw : {}) as {
        title?: unknown
        group_title?: unknown
        template_id?: unknown
      }
      if (typeof it.template_id !== 'string' || typeof it.title !== 'string' || !it.title.trim()) continue
      const list = storedCopy.get(it.template_id) ?? []
      list.push({
        title: it.title,
        ...(typeof it.group_title === 'string' && it.group_title ? { group_title: it.group_title } : {}),
      })
      storedCopy.set(it.template_id, list)
    }

    const out: Omit<StoredChecklistItem, 'order_index'>[] = []
    const emitted = new Set<string>()
    for (const it of incoming) {
      const tid = it.template_id || null
      const groupTitle = it.group_title?.trim() || undefined
      if (!tid) {
        out.push({ title: it.title.trim(), ...(groupTitle ? { group_title: groupTitle } : {}) })
        continue
      }
      if (emitted.has(tid)) continue // the whole group goes at its first item's position
      emitted.add(tid)
      const live = byId.get(tid)
      if (live?.is_active) {
        for (const title of templateItemTitles(live.items)) out.push({ title, group_title: live.name, template_id: tid })
        continue
      }
      const copy = storedCopy.get(tid)
      const source = copy?.length
        ? copy
        : incoming
            .filter((x) => x.template_id === tid)
            .map((x) => ({
              title: x.title.trim(),
              ...(x.group_title?.trim() ? { group_title: x.group_title.trim() } : {}),
            }))
      for (const c of source) out.push({ ...c, template_id: tid })
    }
    return out.map((it, i) => ({ ...it, order_index: i }))
  }

  /**
   * Resolve the step's next state from a DTO over the stored state (or defaults),
   * validating every changed reference: people newly added must be active members
   * (people already on the step may stay — they're reported on Save), masters and
   * tags per the task rules (a tag already on the step may be inactive), proof types
   * from the attachment allow-list, linked checklist templates as above. A CC who is
   * also an assignee is dropped from the CCs.
   */
  private async resolveStepState(
    orgId: string,
    p: Principal,
    dto: DefinitionStepDto,
    existing: WorkflowStep | null,
  ): Promise<StepState> {
    const cur: StepState = existing
      ? stateOf(existing)
      : {
          title: '',
          description: null,
          assignee_user_ids: [],
          cc_user_ids: [],
          completion_mode: 'any_can_complete',
          priority_id: null,
          category_id: null,
          tag_ids: [],
          checklist_items: [],
          proof_required: false,
          proof_allowed_extensions: [],
          due_days: DEFAULT_DUE_DAYS,
          due_time: DEFAULT_DUE_TIME,
          escalation_mode: 'manager',
          escalation_user_ids: [],
          if_late: 'wait',
          start_rule: null,
          due_rule: null,
        }
    const next: StepState = { ...cur }
    if (dto.title !== undefined) next.title = dto.title
    if (dto.description !== undefined) next.description = dto.description?.trim() || null

    const newlyAdded = (incoming: string[] | undefined, stored: string[]) =>
      (incoming ?? []).filter((id) => !stored.includes(id))
    if (dto.assignee_user_ids !== undefined) {
      await assertActiveOrgMembers(this.prisma, orgId, newlyAdded(dto.assignee_user_ids, cur.assignee_user_ids), 'assignees')
      next.assignee_user_ids = unique(dto.assignee_user_ids)
    }
    if (dto.cc_user_ids !== undefined) {
      await assertActiveOrgMembers(this.prisma, orgId, newlyAdded(dto.cc_user_ids, cur.cc_user_ids), 'CC recipients')
      next.cc_user_ids = unique(dto.cc_user_ids)
    }
    next.cc_user_ids = next.cc_user_ids.filter((id) => !next.assignee_user_ids.includes(id))
    if (dto.escalation_user_ids !== undefined) {
      await assertActiveOrgMembers(
        this.prisma,
        orgId,
        newlyAdded(dto.escalation_user_ids, cur.escalation_user_ids),
        'escalation contacts',
      )
      next.escalation_user_ids = unique(dto.escalation_user_ids)
    }
    if (dto.escalation_mode !== undefined) next.escalation_mode = escalationModeOf(dto.escalation_mode)
    if (dto.if_late !== undefined) next.if_late = ifLateOf(dto.if_late)
    if (dto.completion_mode !== undefined) next.completion_mode = dto.completion_mode
    if (dto.due_days !== undefined) next.due_days = dto.due_days
    if (dto.due_time !== undefined) next.due_time = dto.due_time
    if (dto.proof_required !== undefined) next.proof_required = dto.proof_required
    // Timing: a rule sent replaces the stored one (null = the default). A relative due
    // rule is mirrored into due_days / due_time (and an older client's due_days /
    // due_time edit flows into a stored relative due rule).
    if (dto.start_rule !== undefined) next.start_rule = dto.start_rule === null ? null : looseRule(dto.start_rule)
    if (dto.due_rule !== undefined) next.due_rule = dto.due_rule === null ? null : looseRule(dto.due_rule)
    const due = next.due_rule ? parseDueRule(next.due_rule) : null
    if (due?.ok && due.rule.kind === 'days_after_start') {
      if (dto.due_rule === undefined && (dto.due_days !== undefined || dto.due_time !== undefined)) {
        next.due_rule = { kind: 'days_after_start', days: next.due_days, time: next.due_time }
      } else {
        next.due_days = due.rule.days
        next.due_time = due.rule.time
      }
    }

    if (dto.priority_id !== undefined || dto.category_id !== undefined) {
      await assertMastersUsable(this.prisma, orgId, {
        priority_id: dto.priority_id !== cur.priority_id ? dto.priority_id : undefined,
        category_id: dto.category_id !== cur.category_id ? dto.category_id : undefined,
      })
      if (dto.priority_id !== undefined) next.priority_id = dto.priority_id
      if (dto.category_id !== undefined) next.category_id = dto.category_id
    }
    if (dto.tag_ids !== undefined) {
      next.tag_ids = await assertTagsUsable(this.prisma, orgId, dto.tag_ids, { keep: cur.tag_ids })
    }
    if (dto.proof_allowed_extensions !== undefined) {
      const exts = normaliseExtensions(dto.proof_allowed_extensions)
      const bad = exts.filter((e) => !ALLOWED_ATTACHMENT_EXTENSIONS.has(e))
      if (bad.length) {
        throw new BadRequestException(
          `${bad.map((e) => `.${e}`).join(', ')} can’t be uploaded, so it can’t be required as proof.`,
        )
      }
      next.proof_allowed_extensions = exts
    }
    if (dto.checklist_items !== undefined) {
      next.checklist_items = await this.normalizeChecklist(orgId, p, dto.checklist_items, existing?.checklist_items ?? [])
    }
    return next
  }

  /**
   * Full validation of the steps being saved (Save, and every save while Live),
   * batched. Returns the first problem in display order, as a message naming the step
   * (`Step 2 “Review”: Assign it to at least one person.`).
   */
  private async definitionProblem(
    orgId: string,
    steps: ProposedStep[],
    frequency: Frequency = { kind: 'manual' },
    runStart: RunStartPoint | null = null,
    schedules: RunStartScheduleLike[] = [],
  ): Promise<{ message: string; step: ProposedStep } | null> {
    // Explicit days before the step they wait for is due (the sample run's dates).
    const order = runStart
      ? await (async () => {
          const { tz, now } = await this.access.scheduleContext(orgId)
          return sampleOrderMessages(
            steps.map((s) => ({
              key: s.id,
              label: s.label,
              title: s.state.title,
              deps: s.deps,
              start_rule: s.state.start_rule,
              due_rule: s.state.due_rule,
              due_days: s.state.due_days,
              due_time: s.state.due_time,
            })),
            schedules,
            frequency,
            runStart,
            safeTimeZone(tz),
            now,
          )
        })()
      : new Map<string, string>()
    const userIds = steps.flatMap((s) => [...s.state.assignee_user_ids, ...s.state.escalation_user_ids])
    const priorityIds = unique(steps.map((s) => s.state.priority_id).filter((x): x is string => !!x))
    const categoryIds = unique(steps.map((s) => s.state.category_id).filter((x): x is string => !!x))
    const [active, priorities, categories] = await Promise.all([
      this.access.activeMemberSet(orgId, userIds),
      priorityIds.length
        ? this.prisma.taskPriority.findMany({
            where: { id: { in: priorityIds }, organization_id: orgId, is_active: true },
            select: { id: true },
          })
        : Promise.resolve([] as { id: string }[]),
      categoryIds.length
        ? this.prisma.taskCategory.findMany({
            where: { id: { in: categoryIds }, organization_id: orgId, is_active: true },
            select: { id: true },
          })
        : Promise.resolve([] as { id: string }[]),
    ])
    const prioritySet = new Set(priorities.map((r) => r.id))
    const categorySet = new Set(categories.map((r) => r.id))

    for (const s of steps) {
      const fail = (why: string) => ({ message: `${stepLabel(s.label, s.state.title)}: ${why}`, step: s })
      const runnable = stepRunnableProblem(s.state, active)
      if (runnable) return fail(runnable)
      if (s.state.priority_id && !prioritySet.has(s.state.priority_id)) {
        return fail('its priority is no longer active. Choose another.')
      }
      if (s.state.category_id && !categorySet.has(s.state.category_id)) {
        return fail('its category is no longer active. Choose another.')
      }
      const timing = timingProblem(s.state.start_rule, s.state.due_rule, frequency)
      if (timing) return fail(timing)
      // A first step (nothing before it) is timed on or after the run start, in its cycle;
      // "Days after workflow is triggered" is for first steps only.
      const placed =
        s.deps.length === 0
          ? firstStepTimingProblem(s.state.start_rule, s.state.due_rule, runStart)
          : laterStepTimingProblem(s.state.start_rule)
      if (placed) return fail(placed)
      const early = order.get(s.id)
      if (early) return fail(early)
    }
    if (!steps.some((s) => s.deps.length === 0)) {
      return {
        message: 'At least one step must start at the beginning. Remove an “Also waits for” from the first step on the main path.',
        step: steps[0],
      }
    }
    return null
  }
}
