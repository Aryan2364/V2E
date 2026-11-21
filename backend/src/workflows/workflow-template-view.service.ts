import { ChecklistAccessService } from '../task-masters/checklist-access.service'
import { ChecklistTemplateOption, ChecklistTemplateStatus, EscalationResolvedFrom, IN_FLIGHT, LIVE, MSG_NOT_FOUND, MSG_VIEW, StepState, TemplateRow, accessSelect, templateInclude } from './workflow-template.types'
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { MAIN_TRACK, resolveStoredTracks } from './tracks'
import { Principal } from '../access-rights/permissions.service'
import { Prisma, WorkflowAccessType, WorkflowInstanceStatus, WorkflowStep } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { TaskTagRef, loadTagRefMap, tagRefsFor } from '../common/task-masters-usable'
import { UpdateMasterDto } from './dto/update-master.dto'
import { WorkflowAccessService } from './workflow-access.service'
import { capabilitiesFor, isAdminPrincipal } from './workflow-access'
import { checklistTemplateIds, templateItemTitles } from './engine/snapshot'
import { formatSchedules, formatTracks, idsFromJson, ownedWhere, ref, refs, stateOf, timingOf, unique } from './workflow-view.formatter'
import { participantInstanceIds } from './run-access'


/** Reads of the workflow itself: masters, meta, the template list/detail and the limited (starter) view. */
@Injectable()
export class WorkflowTemplateViewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly checklistAccess: ChecklistAccessService,
    private readonly access: WorkflowAccessService,
  ) {}

  private readonly masterSelect = {
    id: true,
    organization_id: true,
    default_overdue_action: true,
    created_at: true,
    updated_at: true,
  } satisfies Prisma.WorkflowMasterSelect

  async getMaster(orgId: string) {
    return this.prisma.workflowMaster.upsert({
      where: { organization_id: orgId },
      create: { organization_id: orgId },
      update: {},
      select: this.masterSelect,
    })
  }

  async updateMaster(orgId: string, dto: UpdateMasterDto) {
    return this.prisma.workflowMaster.upsert({
      where: { organization_id: orgId },
      create: { organization_id: orgId, default_overdue_action: dto.default_overdue_action },
      update: { default_overdue_action: dto.default_overdue_action },
      select: this.masterSelect,
    })
  }

  async getMeta(orgId: string, p: Principal) {
    const [entitlement, checklistTemplates] = await Promise.all([
      this.prisma.orgModuleEntitlement.findUnique({
        where: { organization_id_module_key: { organization_id: orgId, module_key: 'workflows' } },
        select: { state: true },
      }),
      // Exactly the set the task modal offers this caller (active + access rules).
      this.checklistAccess.listAccessibleTemplates(orgId, p.userId),
    ])
    return {
      // 'preview' = read-only for this org (OrgScopeGuard rejects every write), so the
      // UI disables write controls. Super admins bypass the ceiling.
      module_access: p.isSuperAdmin || entitlement?.state === 'full' ? 'full' : 'preview',
      checklist_templates: checklistTemplates.map((t): ChecklistTemplateOption => {
        const titles = templateItemTitles(t.items)
        return { id: t.id, name: t.name, item_count: titles.length, items: titles.map((title) => ({ title })) }
      }),
    }
  }

  /**
   * Steps as the builder and the workflow page read them (escalation steps of the
   * old model are never returned). `escalation_contacts` is who a late task of this
   * step escalates to RIGHT NOW: the listed people ('people'); else the assignees'
   * current managers ('manager'); else the workflow's editors ('owners_fallback' — the
   * value is kept for compatibility; it means the editors now).
   */
  private async formatSteps(orgId: string, steps: WorkflowStep[], p: Principal, editorIds: string[], rawTracks: unknown = []) {
    const tracks = resolveStoredTracks(rawTracks, steps.filter((s) => !s.is_branch_step))
    // Display order: the tracks in order, each in its own order.
    const main = tracks.display
    const states = new Map(main.map((s) => [s.id, stateOf(s)]))
    const managerAssignees = unique(
      main
        .filter((s) => states.get(s.id)!.escalation_mode === 'manager')
        .flatMap((s) => states.get(s.id)!.assignee_user_ids),
    )
    const templateIds = unique(main.flatMap((s) => checklistTemplateIds(s.checklist_items)))
    const tagIds = unique(main.flatMap((s) => states.get(s.id)!.tag_ids))
    const [profiles, linkedTemplates, accessibleTemplates, tagRefs] = await Promise.all([
      managerAssignees.length
        ? this.prisma.employeeProfile.findMany({
            where: { organization_id: orgId, user_id: { in: managerAssignees } },
            select: { user_id: true, reporting_to_user_id: true },
          })
        : Promise.resolve([] as { user_id: string; reporting_to_user_id: string | null }[]),
      templateIds.length
        ? this.prisma.taskChecklistTemplate.findMany({
            where: { id: { in: templateIds }, organization_id: orgId },
            select: { id: true, name: true, is_active: true },
          })
        : Promise.resolve([] as { id: string; name: string; is_active: boolean }[]),
      templateIds.length
        ? this.checklistAccess.listAccessibleTemplates(orgId, p.userId)
        : Promise.resolve([] as { id: string }[]),
      loadTagRefMap(this.prisma, orgId, tagIds),
    ])
    const managerOf = new Map(
      profiles.filter((x) => !!x.reporting_to_user_id).map((x) => [x.user_id, x.reporting_to_user_id!]),
    )
    const active = await this.access.activeMemberSet(orgId, [...managerOf.values(), ...editorIds])
    const activeEditors = editorIds.filter((id) => active.has(id))
    const fallbackEditors = activeEditors.length ? activeEditors : editorIds

    const escalation = (st: StepState): { ids: string[]; from: EscalationResolvedFrom } => {
      if (st.escalation_mode === 'people') return { ids: st.escalation_user_ids, from: 'people' }
      const managers = unique(
        st.assignee_user_ids.map((a) => managerOf.get(a)).filter((m): m is string => !!m && active.has(m)),
      )
      return managers.length ? { ids: managers, from: 'manager' } : { ids: fallbackEditors, from: 'owners_fallback' }
    }
    const resolved = new Map(main.map((s) => [s.id, escalation(states.get(s.id)!)]))
    const names = await this.access.userNames(
      main.flatMap((s) => {
        const st = states.get(s.id)!
        return [...st.assignee_user_ids, ...st.cc_user_ids, ...resolved.get(s.id)!.ids]
      }),
    )

    const liveTemplates = new Map(linkedTemplates.map((t) => [t.id, t]))
    const accessibleIds = new Set(accessibleTemplates.map((t) => t.id))
    const templateStatus = (s: WorkflowStep): ChecklistTemplateStatus[] =>
      checklistTemplateIds(s.checklist_items).map((tid) => {
        const live = liveTemplates.get(tid)
        const saved = (Array.isArray(s.checklist_items) ? s.checklist_items : [])
          .map((it) => (it && typeof it === 'object' ? (it as { template_id?: unknown; group_title?: unknown }) : {}))
          .find((it) => it.template_id === tid && typeof it.group_title === 'string' && it.group_title !== '')
        return {
          template_id: tid,
          name: live?.name ?? (saved?.group_title as string | undefined) ?? 'Deleted checklist template',
          active: !!live?.is_active,
          accessible: accessibleIds.has(tid),
          exists: !!live,
        }
      })

    return main.map((s) => {
      const st = states.get(s.id)!
      const esc = resolved.get(s.id)!
      return {
        id: s.id,
        workflow_template_id: s.workflow_template_id,
        /** Position within its track. */
        order_index: tracks.position.get(s.id) ?? s.order_index,
        track_key: tracks.trackOf.get(s.id) ?? MAIN_TRACK,
        /** "1", "B2". */
        number_label: tracks.labels.get(s.id) ?? '?',
        /** "Also wait for": steps in other tracks it waits for too. */
        merge_step_ids: tracks.merges.get(s.id) ?? [],
        title: st.title,
        description: st.description,
        assignee_user_ids: st.assignee_user_ids,
        cc_user_ids: st.cc_user_ids,
        completion_mode: st.completion_mode,
        priority_id: st.priority_id,
        category_id: st.category_id,
        tag_ids: st.tag_ids,
        tags: tagRefsFor(st.tag_ids, tagRefs) as TaskTagRef[],
        checklist_items: st.checklist_items,
        proof_required: st.proof_required,
        proof_allowed_extensions: st.proof_allowed_extensions,
        due_days: st.due_days,
        due_time: st.due_time,
        escalation_mode: st.escalation_mode,
        escalation_user_ids: st.escalation_user_ids,
        if_late: st.if_late,
        ...timingOf(st),
        /** Derived from the tracks (read-only): the steps it starts after. */
        depends_on_step_ids: tracks.deps.get(s.id) ?? idsFromJson(s.depends_on_step_ids),
        assigner_user_id: s.assigner_user_id,
        created_at: s.created_at,
        updated_at: s.updated_at,
        assignees: refs(st.assignee_user_ids, names),
        ccs: refs(st.cc_user_ids, names),
        escalation_contacts: refs(esc.ids, names),
        escalation_resolved_from: esc.from,
        checklist_template_status: templateStatus(s),
      }
    })
  }

  /**
   * Workflow cards / headers. `mine` (the list) = the caller's own instances per
   * workflow: a row they can't see in full (`view: 'limited'`) then counts only those and
   * carries no design facts (steps, schedules) — the same shape as `limitedDetail`.
   */
  private async formatTemplates(
    orgId: string,
    rows: TemplateRow[],
    p: Principal,
    mine?: Map<string, { instances: number; running: number }>,
  ) {
    if (!rows.length) return []
    const ids = rows.map((r) => r.id)
    const needsSchedule = rows.some((r) => r.schedules.length > 0)
    const [running, names, ctx] = await Promise.all([
      this.prisma.workflowInstance.groupBy({
        by: ['workflow_template_id'],
        where: { organization_id: orgId, workflow_template_id: { in: ids }, status: { in: IN_FLIGHT } },
        _count: { _all: true },
      }),
      this.access.userNames(rows.map((r) => r.created_by_user_id)),
      needsSchedule ? this.access.scheduleContext(orgId) : Promise.resolve(null),
    ])
    const runningBy = new Map(running.map((g) => [g.workflow_template_id, g._count._all]))
    return rows.map((r) => {
      const caps = capabilitiesFor(r, p)
      const limited = !caps.can_view && !!mine
      const own = mine?.get(r.id)
      const schedules = limited ? [] : formatSchedules(r.schedules, ctx)
      // The next scheduled run — only a Live, unpaused workflow fires its schedules.
      const nextRun =
        r.status === 'active'
          ? schedules
              .map((x) => x.next_fire_at)
              .filter((x): x is string => !!x)
              .sort()[0] ?? null
          : null
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        status: r.status,
        /** Live = active or paused (a draft is not live yet). */
        is_live: LIVE.includes(r.status),
        manual_start_enabled: r.manual_start_enabled,
        workflow_nature: r.workflow_nature,
        recurring_type: r.recurring_type,
        show_workflow_on_task_card: r.show_workflow_on_task_card,
        created_by_user_id: r.created_by_user_id,
        created_at: r.created_at,
        updated_at: r.updated_at,
        /** The creator — a permanent editor (admins can change it). */
        created_by: ref(r.created_by_user_id, names),
        capabilities: caps,
        /** 'full' = design + all instances; 'limited' = only the caller's own instances (and Run, for a starter). */
        view: caps.can_view ? ('full' as const) : ('limited' as const),
        /** Limited: counts of the caller's OWN instances only. */
        _count: limited
          ? { steps: 0, instances: own?.instances ?? 0, running_instances: own?.running ?? 0 }
          : {
              steps: r._count.steps,
              instances: r._count.instances,
              running_instances: runningBy.get(r.id) ?? 0,
            },
        schedules,
        next_run_at: nextRun,
      }
    })
  }

  /**
   * People on the workflow page: the creator (always an editor, can't be removed),
   * editors (creator first), viewers, starters (the people chosen under "Manually")
   * and everyone involved (editors ∪ viewers ∪ starters ∪ every step's assignees, CCs
   * and current escalation contacts) with their roles. `is_active` = still an active
   * member (an inactive creator stays the creator until an admin changes it).
   */
  private async buildPeople(
    orgId: string,
    creatorId: string,
    grants: { user_id: string; access_type: WorkflowAccessType }[],
    steps: Awaited<ReturnType<WorkflowTemplateViewService['formatSteps']>>,
    manualStartEnabled = true,
  ) {
    const editorIds = unique([creatorId, ...grants.filter((g) => g.access_type === 'edit').map((g) => g.user_id)])
    const viewerIds = unique(grants.filter((g) => g.access_type === 'view').map((g) => g.user_id)).filter(
      (id) => !editorIds.includes(id),
    )
    const starterIds = unique(grants.filter((g) => g.access_type === 'trigger').map((g) => g.user_id))
    const roles = new Map<string, Set<string>>()
    const add = (id: string, role: string) => {
      const set = roles.get(id) ?? new Set<string>()
      set.add(role)
      roles.set(id, set)
    }
    add(creatorId, 'creator')
    for (const id of editorIds) add(id, 'editor')
    for (const id of viewerIds) add(id, 'viewer')
    // The starter list is kept while "Manually" is off (re-ticking restores it), but
    // nobody can actually start the workflow by hand then — don't label anyone so.
    if (manualStartEnabled) for (const id of starterIds) add(id, 'starter')
    for (const s of steps) {
      for (const id of s.assignee_user_ids) add(id, 'assignee')
      for (const id of s.cc_user_ids) add(id, 'cc')
      for (const c of s.escalation_contacts) add(c.id, 'escalation_contact')
    }
    const [names, active] = await Promise.all([this.access.userNames(roles.keys()), this.access.activeMemberSet(orgId, [...editorIds, ...viewerIds])])
    const rank = (r: Set<string>) => (r.has('creator') ? 0 : r.has('editor') ? 1 : r.has('viewer') ? 2 : 3)
    const involved = [...roles.entries()]
      .map(([id, r]) => ({ id, name: names.get(id) ?? 'Unknown user', roles: [...r] }))
      .sort(
        (a, b) =>
          rank(roles.get(a.id)!) - rank(roles.get(b.id)!) ||
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      )
    const person = (id: string) => ({ ...ref(id, names)!, is_active: active.has(id) })
    return {
      creator: person(creatorId),
      editors: editorIds.map((id) => ({ ...person(id), is_creator: id === creatorId })),
      viewers: viewerIds.map(person),
      starters: refs(starterIds, names),
      involved,
    }
  }

  async templateDetail(orgId: string, templateId: string, p: Principal) {
    const [row, steps, grants] = await Promise.all([
      this.prisma.workflowTemplate.findFirst({
        where: { id: templateId, organization_id: orgId },
        include: templateInclude(p.userId),
      }),
      this.prisma.workflowStep.findMany({
        where: { workflow_template_id: templateId, organization_id: orgId, is_branch_step: false },
      }),
      this.prisma.workflowAccess.findMany({
        where: { workflow_template_id: templateId, organization_id: orgId },
        select: { user_id: true, access_type: true },
        orderBy: { created_at: 'asc' },
      }),
    ])
    if (!row) throw new NotFoundException(MSG_NOT_FOUND)
    const [base] = await this.formatTemplates(orgId, [row], p)
    const editorIds = unique([row.created_by_user_id, ...grants.filter((g) => g.access_type === 'edit').map((g) => g.user_id)])
    const formatted = await this.formatSteps(orgId, steps, p, editorIds, row.tracks)
    const people = await this.buildPeople(orgId, row.created_by_user_id, grants, formatted, row.manual_start_enabled !== false)
    return { ...base, tracks: formatTracks(row.tracks, steps), steps: formatted, people }
  }

  /**
   * The workflows list: everything for admins; otherwise the workflows the caller
   * edits (creator included) or views (`view: 'full'`), plus — as `view: 'limited'` —
   * Live workflows they may start by hand and every workflow with an instance they ran
   * or work in (assignee / CC / escalation contact of one of its step tasks, the same
   * definition as the instance gate). A limited row opens "My instances of this
   * workflow" and carries no design facts; its counts are the caller's own instances.
   */
  async listTemplates(orgId: string, includeArchived: boolean, p: Principal) {
    const admin = isAdminPrincipal(p)
    // The caller's own instances (ran / works in) → which workflows they make visible.
    const own = admin
      ? []
      : await (async () => {
          const ids = await participantInstanceIds(this.prisma, orgId, p.userId, { includeStarted: true })
          if (!ids.length) return [] as { workflow_template_id: string; status: WorkflowInstanceStatus }[]
          return this.prisma.workflowInstance.findMany({
            where: { id: { in: ids }, organization_id: orgId },
            select: { workflow_template_id: true, status: true },
          })
        })()
    const mine = new Map<string, { instances: number; running: number }>()
    for (const i of own) {
      const m = mine.get(i.workflow_template_id) ?? { instances: 0, running: 0 }
      m.instances += 1
      if (IN_FLIGHT.includes(i.status)) m.running += 1
      mine.set(i.workflow_template_id, m)
    }
    const visibility: Prisma.WorkflowTemplateWhereInput = admin
      ? {}
      : {
          OR: [
            { created_by_user_id: p.userId },
            { access: { some: { user_id: p.userId, organization_id: orgId, access_type: { in: ['edit', 'view'] } } } },
            {
              status: { in: LIVE },
              manual_start_enabled: true,
              access: { some: { user_id: p.userId, organization_id: orgId, access_type: 'trigger' } },
            },
            ...(mine.size ? [{ id: { in: [...mine.keys()] } }] : []),
          ],
        }
    const rows = await this.prisma.workflowTemplate.findMany({
      where: {
        organization_id: orgId,
        ...(includeArchived ? {} : { status: { not: 'archived' } }),
        ...visibility,
      },
      include: templateInclude(p.userId),
      orderBy: { created_at: 'desc' },
    })
    return this.formatTemplates(orgId, rows, p, admin ? undefined : mine)
  }

  /**
   * The workflow page. Admins, editors and viewers get the whole design (`view:
   * 'full'`). A starter of a Live workflow, or someone who ran / works in one of its
   * instances, gets the LIMITED page (`view: 'limited'`): name, status, capabilities
   * (Run) — no steps, people or schedules; their own instances come from
   * `GET /:id/instances`. Anyone else: 403 "You don't have access to this workflow."
   */
  async getTemplate(orgId: string, templateId: string, p: Principal) {
    const t = await this.prisma.workflowTemplate.findFirst({
      where: { id: templateId, organization_id: orgId },
      select: accessSelect(p.userId),
    })
    if (!t) throw new NotFoundException(MSG_NOT_FOUND)
    const caps = capabilitiesFor(t, p)
    if (caps.can_view) return this.templateDetail(orgId, templateId, p)
    const mine = await participantInstanceIds(this.prisma, orgId, p.userId, { templateId, includeStarted: true })
    const startable = caps.is_starter && LIVE.includes(t.status) && t.manual_start_enabled !== false
    if (!mine.length && !startable) throw new ForbiddenException(MSG_VIEW)
    return this.limitedDetail(orgId, templateId, p, mine)
  }

  /** The workflow page for someone without design access (see `getTemplate`). */
  private async limitedDetail(orgId: string, templateId: string, p: Principal, mine: string[]) {
    const row = await this.prisma.workflowTemplate.findFirst({
      where: { id: templateId, organization_id: orgId },
      include: templateInclude(p.userId),
    })
    if (!row) throw new NotFoundException(MSG_NOT_FOUND)
    const running = mine.length
      ? await this.prisma.workflowInstance.count({
          where: { id: { in: mine }, workflow_template_id: templateId, organization_id: orgId, status: { in: IN_FLIGHT } },
        })
      : 0
    const names = await this.access.userNames([row.created_by_user_id])
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      is_live: LIVE.includes(row.status),
      manual_start_enabled: row.manual_start_enabled,
      workflow_nature: row.workflow_nature,
      recurring_type: row.recurring_type,
      show_workflow_on_task_card: row.show_workflow_on_task_card,
      created_by_user_id: row.created_by_user_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      created_by: ref(row.created_by_user_id, names),
      capabilities: capabilitiesFor(row, p),
      view: 'limited' as const,
      /** Counts of the caller's OWN instances only. */
      _count: { steps: 0, instances: mine.length, running_instances: running },
      schedules: [],
      next_run_at: null,
      tracks: [],
      steps: [],
      people: null,
    }
  }

  async getOwnedWorkflows(orgId: string, p: Principal) {
    const rows = await this.prisma.workflowTemplate.findMany({
      where: { ...ownedWhere(orgId, p.userId), status: { not: 'archived' } },
      include: templateInclude(p.userId),
      orderBy: { created_at: 'desc' },
    })
    return this.formatTemplates(orgId, rows, p)
  }
}
