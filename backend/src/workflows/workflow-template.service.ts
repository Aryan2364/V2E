import { randomUUID } from 'crypto'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import {
  CompletionMode,
  Prisma,
  WorkflowAccessType,
  WorkflowInstanceStatus,
  WorkflowScheduleEntry,
  WorkflowStep,
  WorkflowTemplateStatus,
} from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { ClockService } from '../clock/clock.service'
import { Principal } from '../access-rights/permissions.service'
import { assertActiveOrgMembers } from '../common/org-members'
import {
  assertMastersUsable,
  assertTagsUsable,
  flattenTags,
  loadTagRefMap,
  tagRefsFor,
  TaskTagRef,
  TASK_TAG_REF_SELECT,
} from '../common/task-masters-usable'
import { ACTIVE_ASSIGNEE } from '../tasks/active-assignee'
import { ALLOWED_ATTACHMENT_EXTENSIONS, normaliseExtensions, type UploadedFile } from '../tasks/task-attachments.service'
import { TasksService } from '../tasks/tasks.service'
import { TimelineStepInput, WorkflowEngineService, isWaitingRow } from './workflow-engine.service'
import {
  MANUAL_START,
  ScheduleEntryLike,
  calendarDateToStored,
  natureOfSchedules,
  nextScheduleOccurrence,
  scheduleEntryProblem,
  scheduleExhausted,
  storedCalendarDate,
} from './engine/schedule'
import { formatLocalDate, safeTimeZone } from './engine/tz'
import {
  Frequency,
  allowedDueKinds,
  allowedStartKinds,
  cycleLengthOf,
  effectiveDueRule,
  effectiveStartRule,
  frequencyOf,
  looseRule,
  parseDueRule,
  parseStartRule,
  timingProblem,
} from './engine/timing'
import { checklistTemplateIds, readSnapshot, templateItemTitles } from './engine/snapshot'
import { ChecklistAccessService } from '../task-masters/checklist-access.service'
import {
  ChecklistItemDto,
  DEFAULT_DUE_DAYS,
  DEFAULT_DUE_TIME,
  DefinitionScheduleDto,
  DefinitionStepDto,
  EscalationMode,
  IfLate,
  MAX_ESCALATION_CONTACTS,
  PreviewTimelineDto,
  SaveDefinitionDto,
} from './dto/definition.dto'
import { UpdateMasterDto } from './dto/update-master.dto'
import { SendBackDto } from './dto/run-actions.dto'
import {
  byDisplayOrder,
  isLegacyBranchRow,
  rowDependencyMap,
  sendBackTargets,
  stringIds,
} from './step-graph'
import { isRunParticipant, participantInstanceIds } from './run-access'
import {
  MAIN_TRACK,
  TrackProblem,
  planTracks,
  resolveStoredTracks,
  runTracks,
  stepErrorLabel,
  trackLabel,
} from './tracks'
import { WorkflowFilesService } from './workflow-files.service'

// ── Public shapes (workflows v2 spec §C) ──────────────────────────────────────

export interface TemplateCapabilities {
  can_view: boolean
  can_edit: boolean
  /** May start it by hand NOW: a chosen starter, "Manually" is on, and it is Live. */
  can_trigger: boolean
  can_manage_access: boolean
  /** Is one of the people chosen under "Manually" (whatever the status). */
  is_starter: boolean
}

export interface InstanceCapabilities {
  can_cancel: boolean
  can_retry: boolean
  /** True when at least one step may be skipped (see `can_skip_row_ids`). */
  can_skip: boolean
  /** Rows the caller may skip (in progress, late, or moved on). */
  can_skip_row_ids: string[]
  /** May add run files (run participants). */
  can_upload: boolean
  /** May open the documents drawer (run participants). */
  can_view_documents: boolean
  /** Rows the caller may send back from (in progress, with a completed upstream step). */
  can_send_back_from: string[]
  /** Waiting rows (ready, before their start time) the caller may "Start now" (can_edit). */
  can_start_now_row_ids: string[]
}

/** One example run of the builder's live timeline. */
export interface TimelineRun {
  starts_at: Date
  steps: { key: string; title: string; planned_start_at: Date; planned_due_at: Date }[]
}

/** A step as the timeline reads it (from a request or from a save being applied). */
interface TimelineStep {
  key: string
  title: string
  /** "1", "B2" — how warnings name it. */
  label: string
  deps: string[]
  start_rule: unknown
  due_rule: unknown
  due_days: number
  due_time: string
  holiday_user_id: string | null
}

/** How many scheduled occurrences the example timeline shows. */
const TIMELINE_RUNS = 3

export type RunDisplayStatus =
  | 'running'
  | 'falling_behind'
  | 'waiting_for_info'
  | 'needs_attention'
  | 'completed'
  | 'cancelled'

/** Per linked checklist template on a step: drives "no longer available — using saved copy". */
export interface ChecklistTemplateStatus {
  template_id: string
  /** Current template name; the saved group title when the template was deleted. */
  name: string
  /** Template exists in this org and is active (runs use its current items). */
  active: boolean
  /** The CALLER may attach this template (same rule as the task modal). */
  accessible: boolean
  /** False when the template was deleted (runs use the step's saved copy). */
  exists: boolean
}

/** A checklist template the caller may attach to a step (GET /meta). */
export interface ChecklistTemplateOption {
  id: string
  name: string
  item_count: number
  items: { title: string }[]
}

/** One stored checklist item on a WorkflowStep. */
export interface StoredChecklistItem {
  title: string
  order_index: number
  group_title?: string
  template_id?: string
}

export interface UserRef {
  id: string
  name: string
}

export type EscalationResolvedFrom = 'manager' | 'people' | 'owners_fallback'

export interface TaskSummary {
  id: string
  status: { label: string; type: string; color: string | null } | null
  deadline: Date | null
  is_overdue: boolean
  completed_at: Date | null
  checklist_total: number
  checklist_done: number
  proof_count: number
  comment_count: number
}

/** The editable state of a step (v2 columns), resolved from a row and/or a DTO. */
export interface StepState {
  title: string
  description: string | null
  assignee_user_ids: string[]
  cc_user_ids: string[]
  completion_mode: CompletionMode
  priority_id: string | null
  category_id: string | null
  tag_ids: string[]
  checklist_items: StoredChecklistItem[]
  proof_required: boolean
  proof_allowed_extensions: string[]
  due_days: number
  due_time: string
  escalation_mode: EscalationMode
  escalation_user_ids: string[]
  if_late: IfLate
  /** Step timing (engine/timing.ts) as stored: NULL = legacy; a draft may hold a partial rule. */
  start_rule: Record<string, unknown> | null
  due_rule: Record<string, unknown> | null
}

/** A step as it is being saved: its request key, final id and resolved state. */
interface ProposedStep {
  key: string
  id: string
  existing: WorkflowStep | null
  state: StepState
  /** Its track ('main', 'B', …). */
  track_key: string
  /** Position within its track (stored as order_index). */
  order_index: number
  /** "1", "B2". */
  label: string
  /** Final ids of the steps in other tracks it also waits for ("Also wait for"). */
  merges: string[]
  /** Final ids of the steps it starts after — DERIVED from the tracks. */
  deps: string[]
}

// ── Messages (403s say who may do it) ─────────────────────────────────────────

const MSG_NOT_FOUND = 'Workflow not found'
const MSG_RUN_NOT_FOUND = 'Run not found'
const MSG_VIEW = "You don't have access to this workflow. Ask an owner to share it."
const MSG_EDIT = 'Only owners, editors and admins can do this.'
const MSG_TRIGGER = 'Only the people listed under “Who can start it” can start this workflow.'
const MSG_PAUSED = 'This workflow is paused. Resume it to start it.'
const MSG_DRAFT_START = 'This workflow is a draft. Save it to make it live.'
const MSG_ARCHIVED_START = 'This workflow is archived. Restore and save it first.'
const MSG_SCHEDULE_ONLY = 'This workflow starts only on its schedule.'
const MSG_CONFLICT = 'Someone else saved this workflow after you opened it. Reload to see their changes.'
const MSG_PICK_STARTERS = 'Choose who can start this workflow.'
const MSG_NO_START = 'Choose how this workflow starts.'
const MSG_MANAGE = 'Only owners, the creator and admins can change who is involved.'
const MSG_ARCHIVED = 'This workflow is archived. Restore it to make changes.'
const MSG_INSTANCE_VIEW = "You don't have access to this run."
const MSG_RUN_FILES = 'Only people involved in this run can see or add its documents.'
const MSG_SEND_BACK = "Only this step's assignees, owners and editors can send it back."
const MSG_REMOVE_FILE = 'Only the person who added this file, owners and editors can remove it.'

const IN_FLIGHT: WorkflowInstanceStatus[] = ['running', 'stuck']
const DEFAULT_TZ = 'Asia/Kolkata'
const INSTANCE_LIST_LIMIT = 200
const EVENT_LIMIT = 500
/** Task status types that close a task (mirrors the engine). */
const TERMINAL_TASK_TYPES = ['completed', 'partially_completed', 'incomplete']
/** Row statuses whose task is being worked on (can be sent back / skipped). */
const WORKING = ['active', 'overdue']
/** Row statuses a send-back may start from. */
const SEND_BACK_FROM = ['active', 'overdue']
/** Row statuses an editor may skip. */
const SKIPPABLE = ['active', 'overdue', 'moved_on']

/** Live = running for real (Active) or temporarily stopped (Paused). */
const LIVE: WorkflowTemplateStatus[] = ['active', 'paused']

/** The template columns the access model reads, plus the caller's own grants. */
type AccessSubject = {
  id: string
  name: string
  status: WorkflowTemplateStatus
  owner_user_ids: Prisma.JsonValue
  created_by_user_id: string
  /** Older callers/tests may omit it (= on). */
  manual_start_enabled?: boolean
  access: { access_type: WorkflowAccessType }[]
}

const accessSelect = (userId: string) =>
  ({
    id: true,
    name: true,
    status: true,
    owner_user_ids: true,
    created_by_user_id: true,
    manual_start_enabled: true,
    updated_at: true,
    access: { where: { user_id: userId }, select: { access_type: true } },
  }) satisfies Prisma.WorkflowTemplateSelect

const SCHEDULE_ORDER: Prisma.WorkflowScheduleEntryOrderByWithRelationInput[] = [
  { order_index: 'asc' },
  { created_at: 'asc' },
]

const templateInclude = (userId: string) =>
  ({
    schedules: { orderBy: SCHEDULE_ORDER },
    access: { where: { user_id: userId }, select: { access_type: true } },
    _count: { select: { steps: { where: { is_branch_step: false } }, instances: true } },
  }) satisfies Prisma.WorkflowTemplateInclude

type TemplateRow = Prisma.WorkflowTemplateGetPayload<{ include: ReturnType<typeof templateInclude> }>

const instanceInclude = (userId: string) =>
  ({
    template: { select: accessSelect(userId) },
    steps: true,
  }) satisfies Prisma.WorkflowInstanceInclude

type InstanceRow = Prisma.WorkflowInstanceGetPayload<{ include: ReturnType<typeof instanceInclude> }>
type InstanceStepRow = InstanceRow['steps'][number]

type Tx = Prisma.TransactionClient

function idsFromJson(v: Prisma.JsonValue | null | undefined): string[] {
  return stringIds(v)
}

function unique<T>(xs: Iterable<T>): T[] {
  return [...new Set(xs)]
}

function escalationModeOf(v: unknown): EscalationMode {
  return v === 'people' ? 'people' : 'manager'
}

function ifLateOf(v: unknown): IfLate {
  return v === 'move_on' ? 'move_on' : 'wait'
}

/**
 * A step-specific 400 the builder can scroll to: `step_key` is the key the step was
 * sent with (a new step has no id yet), `step_id` its id when it has one.
 */
function stepError(message: string, stepId: string | null, stepKey: string | null = stepId) {
  return new BadRequestException({ message, code: 'step_invalid', step_id: stepId, step_key: stepKey })
}

/** A 400 about "How it starts" (`schedule_index` names the schedule entry, when it is one). */
function startsError(message: string, scheduleIndex: number | null = null) {
  return new BadRequestException({ message, code: 'starts_invalid', schedule_index: scheduleIndex })
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))

/** A 400 about a track (`track_key` names it) — e.g. a split point that no longer exists. */
function trackError(message: string, trackKey: string) {
  return new BadRequestException({ message, code: 'track_invalid', track_key: trackKey })
}

/** "Step B2 “Review”" (or "Step B2" while it has no title) — how errors name a step. */
const stepLabel = stepErrorLabel

/** The tracks of a run and each flow row's track and number, from the frozen snapshots. */
function runLanes(rows: InstanceStepRow[], deps: Map<string, string[]>) {
  return runTracks(
    rows
      .filter((s) => !isLegacyBranchRow(s))
      .map((s) => {
        const sn = readSnapshot(s.step_snapshot)
        return {
          id: s.id,
          order_index: s.order_index,
          created_at: s.created_at,
          track_key: sn?.track_key ?? null,
          track_name: sn?.track_name ?? null,
          number_label: sn?.number_label ?? null,
        }
      }),
    deps,
  )
}

/**
 * Workflow templates, steps, triggers, people and the read side of runs.
 *
 * AUTHORIZATION: the `workflows` permission module is leafless on purpose (see
 * permission-registry.ts) — row-level access is the template's own owner/grant
 * model, computed here by `capabilitiesFor` from the template row and the caller's
 * grants, with the app's admin bypass (`Principal.isAdmin` / super admin, the same
 * flag RolesGuard/@RequireAdmin use). Every `:id` route loads the template scoped by
 * `organization_id` (404 otherwise) and checks the capability; every sub-resource
 * (`:stepId`, `:triggerId`, `:iid`, `:rowId`, `:fileId`, `:userId`) is additionally
 * scoped to its parent id + org in the query.
 *
 * Runs: view = template `can_view` OR participant of the run (`run-access.ts`).
 * Documents/files = participants only (they are the run's working papers). Run state
 * is never written here — run actions delegate to the engine. The principal is
 * required (fail closed) — this service has no internal callers.
 */
@Injectable()
export class WorkflowTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: WorkflowEngineService,
    private readonly clock: ClockService,
    private readonly checklistAccess: ChecklistAccessService,
    private readonly files: WorkflowFilesService,
    // Resolves TasksService lazily (TasksModule imports WorkflowsModule, so it can't
    // be injected directly without a module cycle) — see `assertCanViewTask`.
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  // ════════════════════════════════════════════════════════════════════════════
  // Access model
  // ════════════════════════════════════════════════════════════════════════════

  private isAdmin(p: Principal): boolean {
    return !!(p.isAdmin || p.isSuperAdmin)
  }

  /**
   * view: managers (admin / creator / owner), anyone with a grant, and every member
   * once it is Live (active or paused). edit: managers + editors. Start by hand: ONLY
   * the people chosen under "Manually" (`trigger` grants — owners, editors and admins
   * are not starters unless listed), while "Manually" is on and it is active. Manage
   * access (owners / editors): managers.
   */
  capabilitiesFor(t: Omit<AccessSubject, 'id' | 'name'>, p: Principal): TemplateCapabilities {
    const grants = t.access.map((a) => a.access_type)
    const manager =
      this.isAdmin(p) || t.created_by_user_id === p.userId || idsFromJson(t.owner_user_ids).includes(p.userId)
    const hasEdit = grants.includes('edit')
    const isStarter = grants.includes('trigger')
    const manual = t.manual_start_enabled !== false
    return {
      can_view: manager || grants.length > 0 || LIVE.includes(t.status),
      can_edit: manager || hasEdit,
      can_trigger: isStarter && manual && t.status === 'active',
      can_manage_access: manager,
      is_starter: isStarter,
    }
  }

  /** Load a template in this org (404 otherwise) and require `can_view`. */
  private async loadTemplate(orgId: string, templateId: string, p: Principal) {
    const t = await this.prisma.workflowTemplate.findFirst({
      where: { id: templateId, organization_id: orgId },
      select: accessSelect(p.userId),
    })
    if (!t) throw new NotFoundException(MSG_NOT_FOUND)
    const caps = this.capabilitiesFor(t, p)
    if (!caps.can_view) throw new ForbiddenException(MSG_VIEW)
    return { t, caps }
  }

  private async loadEditable(orgId: string, templateId: string, p: Principal, opts: { allowArchived?: boolean } = {}) {
    const loaded = await this.loadTemplate(orgId, templateId, p)
    if (!loaded.caps.can_edit) throw new ForbiddenException(MSG_EDIT)
    if (!opts.allowArchived && loaded.t.status === 'archived') throw new BadRequestException(MSG_ARCHIVED)
    return loaded
  }

  private async activeMemberSet(orgId: string, ids: Iterable<string>): Promise<Set<string>> {
    const list = unique([...ids].filter(Boolean))
    if (!list.length) return new Set()
    const rows = await this.prisma.organizationMember.findMany({
      where: { organization_id: orgId, user_id: { in: list }, is_active: true },
      select: { user_id: true },
    })
    return new Set(rows.map((r) => r.user_id))
  }

  /**
   * The task-detail gate (TasksService.assertCanViewTask), resolved lazily. Fails
   * closed when the tasks module isn't available.
   */
  private async assertCanViewTask(orgId: string, p: Principal, taskId: string): Promise<void> {
    let tasks: TasksService | null = null
    try {
      tasks = this.moduleRef?.get(TasksService, { strict: false }) ?? null
    } catch {
      tasks = null
    }
    if (!tasks) throw new ForbiddenException("You don't have access to this task.")
    await tasks.assertCanViewTask(orgId, p, taskId)
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Masters (admin only — enforced by @RequireAdmin on the controller)
  // ════════════════════════════════════════════════════════════════════════════

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

  // ════════════════════════════════════════════════════════════════════════════
  // Meta (editor dropdowns)
  // ════════════════════════════════════════════════════════════════════════════

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

  // ════════════════════════════════════════════════════════════════════════════
  // Name resolution (batched — one query per kind, never per row)
  // ════════════════════════════════════════════════════════════════════════════

  private async userNames(ids: Iterable<string | null | undefined>): Promise<Map<string, string>> {
    const list = unique([...ids].filter((x): x is string => !!x))
    if (!list.length) return new Map()
    const users = await this.prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true } })
    return new Map(users.map((u) => [u.id, u.name]))
  }

  private ref(id: string | null | undefined, names: Map<string, string>): UserRef | null {
    if (!id) return null
    return { id, name: names.get(id) ?? 'Unknown user' }
  }

  private refs(ids: string[], names: Map<string, string>): UserRef[] {
    return ids.map((id) => this.ref(id, names)!)
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Formatting — templates and steps
  // ════════════════════════════════════════════════════════════════════════════

  /** Org tz + org clock "now", loaded lazily only when a schedule needs a next run. */
  private async scheduleContext(orgId: string): Promise<{ tz: string; now: Date }> {
    const [org, now] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: orgId }, select: { timezone: true } }),
      this.clock.now(orgId),
    ])
    return { tz: org?.timezone || DEFAULT_TZ, now }
  }

  /**
   * Schedules as the builder edits them (the recurring-task schedule shape, dates as
   * "YYYY-MM-DD") + `next_fire_at`: the entry's next occurrence after now (org clock,
   * org tz) and after its last-fired marker. It only actually fires while Live.
   */
  private formatSchedules(entries: WorkflowScheduleEntry[], ctx: { tz: string; now: Date } | null) {
    return entries.map((e) => {
      let next: string | null = null
      if (ctx) {
        const marker = e.last_fired_at ?? new Date(e.created_at.getTime() - 1)
        const after = marker.getTime() > ctx.now.getTime() ? marker : ctx.now
        try {
          next = nextScheduleOccurrence(e, after, ctx.tz)?.toISOString() ?? null
        } catch {
          next = null
        }
      }
      return {
        id: e.id,
        schedule_type: e.schedule_type,
        every: e.every,
        days: Array.isArray(e.days) ? (e.days as number[]) : [],
        month_days: Array.isArray(e.month_days) ? (e.month_days as number[]) : [],
        yearly_dates: Array.isArray(e.yearly_dates) ? (e.yearly_dates as { month: number; day: number }[]) : [],
        time: e.time,
        start_date: formatLocalDate(storedCalendarDate(e.start_date)),
        end_condition: e.end_condition,
        end_date: e.end_date ? formatLocalDate(storedCalendarDate(e.end_date)) : null,
        end_after: e.end_after,
        occurrence_count: e.occurrence_count,
        /** False once an "after N" schedule has run N times. */
        is_active: e.is_active && !scheduleExhausted(e),
        order_index: e.order_index,
        next_fire_at: next,
      }
    })
  }

  /** The v2 editable state stored on a step row. */
  private stateOf(s: WorkflowStep): StepState {
    return {
      title: s.title,
      description: s.description,
      assignee_user_ids: idsFromJson(s.assignee_user_ids),
      cc_user_ids: idsFromJson(s.cc_user_ids),
      completion_mode: s.completion_mode,
      priority_id: s.priority_id,
      category_id: s.category_id,
      tag_ids: idsFromJson(s.tag_ids),
      checklist_items: (Array.isArray(s.checklist_items) ? s.checklist_items : []) as unknown as StoredChecklistItem[],
      proof_required: s.proof_required,
      proof_allowed_extensions: s.proof_allowed_extensions ?? [],
      due_days: s.due_days,
      due_time: s.due_time,
      escalation_mode: escalationModeOf(s.escalation_mode),
      escalation_user_ids: idsFromJson(s.escalation_user_ids),
      if_late: ifLateOf(s.if_late),
      start_rule: looseRule(s.start_rule),
      due_rule: looseRule(s.due_rule),
    }
  }

  /**
   * The timing the builder shows for a step: a complete stored rule in its canonical
   * shape; a draft's partial rule as stored; NULL (legacy) as the defaults it runs
   * with — start as soon as the steps before it are done, due `due_days` after it
   * starts at `due_time`.
   */
  private timingOf(st: StepState) {
    const start = st.start_rule ? parseStartRule(st.start_rule) : null
    const due = st.due_rule ? parseDueRule(st.due_rule) : null
    return {
      start_rule: start ? (start.ok ? start.rule : st.start_rule) : effectiveStartRule(null),
      due_rule: due ? (due.ok ? due.rule : st.due_rule) : effectiveDueRule(null, st.due_days, st.due_time),
    }
  }

  /**
   * Steps as the builder and the workflow page read them (escalation steps of the
   * old model are never returned). `escalation_contacts` is who a late task of this
   * step escalates to RIGHT NOW: the listed people ('people'); else the assignees'
   * current managers ('manager'); else the workflow's owners ('owners_fallback').
   */
  private async formatSteps(orgId: string, steps: WorkflowStep[], p: Principal, ownerIds: string[], rawTracks: unknown = []) {
    const tracks = resolveStoredTracks(rawTracks, steps.filter((s) => !s.is_branch_step))
    // Display order: the tracks in order, each in its own order.
    const main = tracks.display
    const states = new Map(main.map((s) => [s.id, this.stateOf(s)]))
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
    const active = await this.activeMemberSet(orgId, [...managerOf.values(), ...ownerIds])
    const activeOwners = ownerIds.filter((id) => active.has(id))
    const fallbackOwners = activeOwners.length ? activeOwners : ownerIds

    const escalation = (st: StepState): { ids: string[]; from: EscalationResolvedFrom } => {
      if (st.escalation_mode === 'people') return { ids: st.escalation_user_ids, from: 'people' }
      const managers = unique(
        st.assignee_user_ids.map((a) => managerOf.get(a)).filter((m): m is string => !!m && active.has(m)),
      )
      return managers.length ? { ids: managers, from: 'manager' } : { ids: fallbackOwners, from: 'owners_fallback' }
    }
    const resolved = new Map(main.map((s) => [s.id, escalation(states.get(s.id)!)]))
    const names = await this.userNames(
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
        ...this.timingOf(st),
        /** Derived from the tracks (read-only): the steps it starts after. */
        depends_on_step_ids: tracks.deps.get(s.id) ?? idsFromJson(s.depends_on_step_ids),
        assigner_user_id: s.assigner_user_id,
        created_at: s.created_at,
        updated_at: s.updated_at,
        assignees: this.refs(st.assignee_user_ids, names),
        ccs: this.refs(st.cc_user_ids, names),
        escalation_contacts: this.refs(esc.ids, names),
        escalation_resolved_from: esc.from,
        checklist_template_status: templateStatus(s),
      }
    })
  }

  /**
   * The workflow's tracks for the builder and the workflow page: main first, then the
   * others in display order, each with its label ("Main track", its name, "Track B")
   * and the step it starts after (null = when the workflow starts).
   */
  private formatTracks(rawTracks: unknown, steps: WorkflowStep[]) {
    const r = resolveStoredTracks(rawTracks, steps.filter((s) => !s.is_branch_step))
    return r.tracks.map((t) => ({
      key: t.key,
      name: t.name,
      label: trackLabel(t),
      split_from_step_id: t.split_from_step_id,
      step_count: r.display.filter((s) => r.trackOf.get(s.id) === t.key).length,
    }))
  }

  private async formatTemplates(orgId: string, rows: TemplateRow[], p: Principal) {
    if (!rows.length) return []
    const ids = rows.map((r) => r.id)
    const needsSchedule = rows.some((r) => r.schedules.length > 0)
    const [running, names, ctx] = await Promise.all([
      this.prisma.workflowInstance.groupBy({
        by: ['workflow_template_id'],
        where: { organization_id: orgId, workflow_template_id: { in: ids }, status: { in: IN_FLIGHT } },
        _count: { _all: true },
      }),
      this.userNames(rows.flatMap((r) => [...idsFromJson(r.owner_user_ids), r.created_by_user_id])),
      needsSchedule ? this.scheduleContext(orgId) : Promise.resolve(null),
    ])
    const runningBy = new Map(running.map((g) => [g.workflow_template_id, g._count._all]))
    return rows.map((r) => {
      const owners = idsFromJson(r.owner_user_ids)
      const schedules = this.formatSchedules(r.schedules, ctx)
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
        owner_user_ids: owners,
        owners: this.refs(owners, names),
        created_by: this.ref(r.created_by_user_id, names),
        capabilities: this.capabilitiesFor(r, p),
        _count: {
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
   * People on the workflow page: owners, editors ("can change it"), starters (the
   * people chosen under "Manually") and everyone involved (owners ∪ editors ∪
   * starters ∪ every step's assignees, CCs and current escalation contacts) with
   * their roles. Starters are their own list — an owner or editor may be one too.
   */
  private async buildPeople(
    ownerIds: string[],
    grants: { user_id: string; access_type: WorkflowAccessType }[],
    steps: Awaited<ReturnType<WorkflowTemplateService['formatSteps']>>,
    manualStartEnabled = true,
  ) {
    const editorIds = unique(grants.filter((g) => g.access_type === 'edit').map((g) => g.user_id)).filter(
      (id) => !ownerIds.includes(id),
    )
    const starterIds = unique(grants.filter((g) => g.access_type === 'trigger').map((g) => g.user_id))
    const roles = new Map<string, Set<string>>()
    const add = (id: string, role: string) => {
      const set = roles.get(id) ?? new Set<string>()
      set.add(role)
      roles.set(id, set)
    }
    for (const id of ownerIds) add(id, 'owner')
    for (const id of editorIds) add(id, 'editor')
    // The starter list is kept while "Manually" is off (re-ticking restores it), but
    // nobody can actually start the workflow by hand then — don't label anyone so.
    if (manualStartEnabled) for (const id of starterIds) add(id, 'starter')
    for (const s of steps) {
      for (const id of s.assignee_user_ids) add(id, 'assignee')
      for (const id of s.cc_user_ids) add(id, 'cc')
      for (const c of s.escalation_contacts) add(c.id, 'escalation_contact')
    }
    const names = await this.userNames(roles.keys())
    const rank = (r: Set<string>) => (r.has('owner') ? 0 : r.has('editor') ? 1 : 2)
    const involved = [...roles.entries()]
      .map(([id, r]) => ({ id, name: names.get(id) ?? 'Unknown user', roles: [...r] }))
      .sort(
        (a, b) =>
          rank(roles.get(a.id)!) - rank(roles.get(b.id)!) ||
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      )
    return {
      owners: this.refs(ownerIds, names),
      editors: this.refs(editorIds, names),
      starters: this.refs(starterIds, names),
      involved,
    }
  }

  private async templateDetail(orgId: string, templateId: string, p: Principal) {
    const [row, steps, grants] = await Promise.all([
      this.prisma.workflowTemplate.findFirst({
        where: { id: templateId, organization_id: orgId },
        include: templateInclude(p.userId),
      }),
      this.prisma.workflowStep.findMany({
        where: { workflow_template_id: templateId, organization_id: orgId, is_branch_step: false },
      }),
      this.prisma.workflowAccess.findMany({
        where: { workflow_template_id: templateId, organization_id: orgId, access_type: { in: ['edit', 'trigger'] } },
        select: { user_id: true, access_type: true },
        orderBy: { created_at: 'asc' },
      }),
    ])
    if (!row) throw new NotFoundException(MSG_NOT_FOUND)
    const [base] = await this.formatTemplates(orgId, [row], p)
    const ownerIds = idsFromJson(row.owner_user_ids)
    const formatted = await this.formatSteps(orgId, steps, p, ownerIds, row.tracks)
    const people = await this.buildPeople(ownerIds, grants, formatted, row.manual_start_enabled !== false)
    return { ...base, tracks: this.formatTracks(row.tracks, steps), steps: formatted, people }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Formatting — runs
  // ════════════════════════════════════════════════════════════════════════════

  private async formatInstances(orgId: string, rows: InstanceRow[], p: Principal) {
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
              escalations: { where: { is_active: true, escalate_to_user_id: p.userId }, select: { id: true } },
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
    const names = await this.userNames([
      ...tasks.flatMap((t) => t.assignees.map((a) => a.user_id)),
      ...allSteps.map((s) => s.assigned_to_user_id),
      ...rows.map((r) => r.triggered_by_user_id),
    ])
    const checklistBy = new Map<string, typeof checklist>()
    for (const c of checklist) {
      const list = checklistBy.get(c.task_id) ?? []
      list.push(c)
      checklistBy.set(c.task_id, list)
    }
    const isAdmin = this.isAdmin(p)
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
      const tcaps = this.capabilitiesFor(inst.template, p)
      const deps = rowDependencyMap(inst.steps)
      const inFlight = IN_FLIGHT.includes(inst.status)
      // Track and number of each step ("B2") as frozen when the run started; runs
      // started before tracks are laid out from their graph the same way.
      const lanes = runLanes(inst.steps, deps)

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
          assigned_to: this.ref(s.assigned_to_user_id, names),
          assignees: this.refs(roster.filter((a) => !a.is_cc).map((a) => a.user_id), names),
          ccs: this.refs(roster.filter((a) => a.is_cc).map((a) => a.user_id), names),
          task: summarize(s.task_id),
        }
      })
      type Row = (typeof steps)[number]
      const main = steps.filter((s) => !s.is_branch)

      // Participant (computed from what is already loaded — same definition as run-access.ts).
      const runTasks = inst.steps.map((s) => (s.task_id ? taskById.get(s.task_id) : undefined))
      const participant =
        tcaps.can_edit ||
        inst.triggered_by_user_id === p.userId ||
        runTasks.some(
          (t) => !!t && !t.is_deleted && (t.assignees.some((a) => a.user_id === p.userId) || t.escalations.length > 0),
        )

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
        name: inst.name,
        status: inst.status,
        display_status: display,
        trigger_type: inst.trigger_type,
        started_at: inst.started_at,
        completed_at: inst.completed_at,
        last_error: inst.last_error,
        template: { id: inst.template.id, name: inst.template.name },
        triggered_by: this.ref(inst.triggered_by_user_id, names),
        capabilities: {
          can_cancel: tcaps.can_edit && inFlight,
          can_retry: tcaps.can_edit && inFlight && stranded,
          can_skip: skippable.length > 0,
          can_skip_row_ids: skippable,
          can_upload: participant,
          can_view_documents: participant,
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

  // ════════════════════════════════════════════════════════════════════════════
  // Templates
  // ════════════════════════════════════════════════════════════════════════════

  async listTemplates(orgId: string, includeArchived: boolean, p: Principal) {
    const visibility: Prisma.WorkflowTemplateWhereInput = this.isAdmin(p)
      ? {}
      : {
          OR: [
            { created_by_user_id: p.userId },
            { owner_user_ids: { array_contains: [p.userId] } },
            { access: { some: { user_id: p.userId, organization_id: orgId } } },
            { status: { in: LIVE } },
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
    return this.formatTemplates(orgId, rows, p)
  }

  async getTemplate(orgId: string, templateId: string, p: Principal) {
    await this.loadTemplate(orgId, templateId, p)
    return this.templateDetail(orgId, templateId, p)
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Definition — the whole workflow, saved in one request
  // ════════════════════════════════════════════════════════════════════════════

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
    const loaded = templateId ? await this.loadEditable(orgId, templateId, p) : null
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
            where: { workflow_template_id: templateId, organization_id: orgId, access_type: { in: ['edit', 'trigger'] } },
            select: { user_id: true, access_type: true },
          }),
        ])
      : [[] as WorkflowStep[], [] as WorkflowScheduleEntry[], [] as { user_id: string; access_type: WorkflowAccessType }[]]

    // ── People: owners + editors (manage access) ──
    const curOwners = t ? idsFromJson(t.owner_user_ids) : [p.userId]
    const curEditors = unique(grants.filter((g) => g.access_type === 'edit').map((g) => g.user_id)).filter(
      (id) => !curOwners.includes(id),
    )
    let owners = curOwners
    let editors = curEditors
    if (dto.people) {
      const nextOwners = unique(dto.people.owner_user_ids)
      const nextEditors = unique(dto.people.editor_user_ids).filter((id) => !nextOwners.includes(id))
      if (!sameSet(nextOwners, curOwners) || !sameSet(nextEditors, curEditors)) {
        // A creator always manages their new workflow; otherwise owners / creator / admins.
        if (loaded && !loaded.caps.can_manage_access) throw new ForbiddenException(MSG_MANAGE)
        const known = new Set([...curOwners, ...curEditors])
        await assertActiveOrgMembers(
          this.prisma,
          orgId,
          [...nextOwners, ...nextEditors].filter((id) => !known.has(id)),
          'people you added',
        )
        if ((await this.activeMemberSet(orgId, nextOwners)).size === 0) {
          throw new BadRequestException('Add at least one active owner.')
        }
        owners = nextOwners
        editors = nextEditors
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
      // A new workflow starts with its owners as its starters.
      starters = curStarters ?? owners
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
    if (structure) this.throwTrackProblem(structure, idOf, existingById)
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
      this.scheduleData(e, i, e.id ? existingSchedById.get(e.id)! : null),
    )
    // How it repeats decides which step timings are allowed (checked on Save).
    const frequency = frequencyOf(schedules.map((x) => x.data))

    // ── Full validation (Save / Live), in the order the form reads ──
    if (full) {
      if (manual) {
        if ((await this.activeMemberSet(orgId, starters)).size === 0) throw startsError(MSG_PICK_STARTERS)
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
      const problem = await this.definitionProblem(orgId, proposed, frequency)
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
    const assignersActive = await this.activeMemberSet(
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
            owner_user_ids: owners,
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
            owner_user_ids: owners,
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
      await this.applySteps(tx, orgId, id, p.userId, proposed, existingSteps, assignersActive)
      await this.applySchedules(tx, orgId, id, schedules, existingSchedules, orgNow, goingLive)
      await this.applyGrants(tx, orgId, id, grants, editors, starters)
      return id
    })

    const detail = await this.templateDetail(orgId, savedId, p)
    const warnings = await this.saveWarnings(orgId, proposed, schedules.map((x) => x.data))
    return { ...detail, step_keys: Object.fromEntries(proposed.map((s) => [s.key, s.id])), warnings }
  }

  /** A track/merge/loop problem of a definition request as the 400 the builder points at. */
  private throwTrackProblem(problem: TrackProblem, idOf: Map<string, string>, existingById: Map<string, WorkflowStep>): never {
    if (problem.kind === 'track') throw trackError(problem.message, problem.track_key)
    if (problem.kind === 'step') {
      const id = idOf.get(problem.step_key)
      throw stepError(problem.message, id && existingById.has(id) ? id : null, problem.step_key)
    }
    throw new BadRequestException(problem.message)
  }

  /**
   * Non-blocking timing warnings for a save (the builder shows them): the same check
   * the example timeline runs. Never fails a save.
   */
  private async saveWarnings(
    orgId: string,
    proposed: ProposedStep[],
    schedules: ReturnType<WorkflowTemplateService['scheduleData']>['data'][],
  ): Promise<string[]> {
    try {
      const { tz, now } = await this.scheduleContext(orgId)
      const entries: ScheduleEntryLike[] = schedules.map((d) => ({
        ...d,
        days: d.days,
        month_days: d.month_days,
        yearly_dates: d.yearly_dates,
        occurrence_count: 0,
      }))
      const steps: TimelineStep[] = proposed.map((s) => ({
        key: s.id,
        title: s.state.title,
        label: s.label,
        deps: s.deps,
        start_rule: s.state.start_rule,
        due_rule: s.state.due_rule,
        due_days: s.state.due_days,
        due_time: s.state.due_time,
        holiday_user_id: s.state.assignee_user_ids[0] ?? null,
      }))
      return (await this.timeline(orgId, safeTimeZone(tz), now, steps, entries, frequencyOf(schedules))).warnings
    } catch {
      return []
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Example timeline (builder) — the engine's own planning code
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * `POST /workflows/preview-timeline` — the live example run under the Steps section.
   * Body = the in-memory definition (the definition save's shape); nothing is stored
   * and no workflow row is read, so module access is enough (OrgScopeGuard). Scheduled
   * workflows: the next 3 occurrences of its schedules from the org clock; manual-only
   * (or schedules with no upcoming occurrence): one run starting now. Fields the
   * request omits take the new-step defaults.
   */
  async previewTimeline(orgId: string, dto: PreviewTimelineDto, _p: Principal) {
    const { tz, now } = await this.scheduleContext(orgId)
    // The same tracks → graph as a save; anything not valid yet is simply left out.
    const { plan } = planTracks(
      dto.tracks,
      dto.steps.map((s) => ({ key: s.key, title: s.title, track_key: s.track_key, merge_step_keys: s.merge_step_keys })),
    )
    const byKey = new Map(dto.steps.map((s) => [s.key, s]))
    const steps: TimelineStep[] = plan.display.map((key) => byKey.get(key)!).map((s) => ({
      key: s.key,
      title: (s.title ?? '').trim(),
      label: plan.labels.get(s.key) ?? '?',
      deps: plan.deps.get(s.key) ?? [],
      start_rule: s.start_rule ?? null,
      due_rule: s.due_rule ?? null,
      due_days: s.due_days ?? DEFAULT_DUE_DAYS,
      due_time: s.due_time ?? DEFAULT_DUE_TIME,
      holiday_user_id: s.assignee_user_ids?.[0] ?? null,
    }))
    const entries: ScheduleEntryLike[] = []
    for (const e of dto.starts.schedules) {
      if (scheduleEntryProblem(e)) continue
      const start = calendarDateToStored(e.start_date)
      if (!start) continue
      const endCondition = e.end_condition ?? 'never'
      entries.push({
        schedule_type: e.schedule_type,
        every: e.every ?? 1,
        days: e.days ?? [],
        month_days: e.month_days ?? [],
        yearly_dates: e.yearly_dates ?? [],
        time: e.time,
        start_date: start,
        end_condition: endCondition,
        end_date: endCondition === 'on_date' ? calendarDateToStored(e.end_date) : null,
        end_after: endCondition === 'after_n' ? e.end_after ?? null : null,
        occurrence_count: 0,
      })
    }
    return this.timeline(orgId, safeTimeZone(tz), now, steps, entries, frequencyOf(dto.starts.schedules))
  }

  /**
   * Plan example runs with the engine (exactly what a run would store), plus warnings:
   * a step whose timing isn't valid for how the workflow repeats (planned with the
   * defaults instead), and a step timed to start before a step it starts after is due.
   */
  private async timeline(
    orgId: string,
    tz: string,
    now: Date,
    steps: TimelineStep[],
    schedules: ScheduleEntryLike[],
    frequency: Frequency,
  ): Promise<{ runs: TimelineRun[]; warnings: string[] }> {
    const warnings: string[] = []
    const label = new Map(steps.map((s) => [s.key, stepLabel(s.label, s.title)]))
    const name = (key: string) => {
      const st = steps.find((s) => s.key === key)
      return st?.title.trim() || `Step ${st?.label ?? '?'}`
    }
    const inputs: TimelineStepInput[] = steps.map((s) => {
      const problem = timingProblem(s.start_rule, s.due_rule, frequency)
      if (problem) warnings.push(`${label.get(s.key)}: ${problem}`)
      const start = s.start_rule ? parseStartRule(s.start_rule) : null
      const due = s.due_rule ? parseDueRule(s.due_rule) : null
      const startOk = start?.ok && allowedStartKinds(frequency).includes(start.rule.kind) && !problem
      const dueOk = due?.ok && allowedDueKinds(frequency).includes(due.rule.kind) && !problem
      return {
        key: s.key,
        deps: s.deps,
        start_rule: startOk && start?.ok ? start.rule : null,
        due_rule: dueOk && due?.ok ? due.rule : null,
        due_days: s.due_days,
        due_time: s.due_time,
        holiday_user_id: s.holiday_user_id,
      }
    })

    let starts = this.upcomingOccurrences(schedules, now, tz, TIMELINE_RUNS)
    if (!starts.length) starts = [now]
    const every = cycleLengthOf(frequency)
    const plans = await this.engine.planTimelines(orgId, tz, inputs, starts, every)
    const runs: TimelineRun[] = []
    for (const [i, plan] of plans.entries()) {
      const runStart = starts[i]
      runs.push({
        starts_at: runStart,
        steps: plan.steps.map((x) => ({
          key: x.key,
          title: name(x.key),
          planned_start_at: x.planned_start_at,
          planned_due_at: x.planned_due_at,
        })),
      })
      for (const w of plan.warnings) {
        warnings.push(
          `${label.get(w.key)} starts before ${label.get(w.predecessor_key) ?? `“${name(w.predecessor_key)}”`} is due, so it is planned later.`,
        )
      }
    }
    return { runs, warnings: unique(warnings) }
  }

  /** The next `n` occurrences (strictly after now) across the schedules, earliest first. */
  private upcomingOccurrences(entries: ScheduleEntryLike[], now: Date, tz: string, n: number): Date[] {
    const all: number[] = []
    for (const e of entries) {
      let after = now
      for (let i = 0; i < n; i++) {
        const next = nextScheduleOccurrence(e, after, tz)
        if (!next) break
        all.push(next.getTime())
        after = next
      }
    }
    return unique(all)
      .sort((a, b) => a - b)
      .slice(0, n)
      .map((t) => new Date(t))
  }

  /** A schedule entry's columns from the DTO (dates normalised to UTC midnight of the day). */
  private scheduleData(e: DefinitionScheduleDto, index: number, existing: WorkflowScheduleEntry | null) {
    const start = calendarDateToStored(e.start_date) ?? existing?.start_date ?? new Date(Date.UTC(1970, 0, 1))
    const endCondition = e.end_condition ?? 'never'
    const endDate = endCondition === 'on_date' ? calendarDateToStored(e.end_date) : null
    const endAfter = endCondition === 'after_n' ? e.end_after ?? null : null
    const occurrenceCount = existing?.occurrence_count ?? 0
    return {
      id: existing?.id ?? null,
      data: {
        schedule_type: e.schedule_type,
        every: e.every ?? 1,
        days: e.schedule_type === 'weekly' ? unique(e.days ?? []).sort((a, b) => a - b) : [],
        month_days: e.schedule_type === 'monthly' ? unique(e.month_days ?? []) : [],
        yearly_dates:
          e.schedule_type === 'yearly'
            ? (e.yearly_dates ?? []).map((d) => ({ month: d.month, day: d.day }))
            : ([] as { month: number; day: number }[]),
        time: e.time,
        start_date: start,
        end_condition: endCondition,
        end_date: endDate,
        end_after: endAfter,
        order_index: index,
        // Spent once an "after N" count is reached; raising N brings it back.
        is_active: !scheduleExhausted({ end_condition: endCondition, end_after: endAfter, occurrence_count: occurrenceCount }),
      },
    }
  }

  private async applySteps(
    tx: Tx,
    orgId: string,
    templateId: string,
    userId: string,
    proposed: ProposedStep[],
    existing: WorkflowStep[],
    assignersActive: Set<string>,
  ) {
    const keep = new Set(proposed.filter((s) => s.existing).map((s) => s.id))
    const removed = existing.filter((s) => !keep.has(s.id)).map((s) => s.id)
    if (removed.length) {
      // Legacy escalation references (old model) to the deleted steps.
      await tx.workflowStep.updateMany({
        where: { workflow_template_id: templateId, organization_id: orgId, branch_step_id: { in: removed } },
        data: { branch_step_id: null, if_overdue_action: 'block_next' },
      })
      await tx.workflowStep.deleteMany({
        where: { id: { in: removed }, workflow_template_id: templateId, organization_id: orgId },
      })
    }
    for (const s of proposed) {
      if (s.existing) {
        // Keep the task creator valid without asking: one who left hands over to this editor.
        const handOver = !assignersActive.has(s.existing.assigner_user_id)
        await tx.workflowStep.updateMany({
          where: { id: s.id, workflow_template_id: templateId, organization_id: orgId },
          data: {
            ...this.stepColumns(s.state, s.deps),
            order_index: s.order_index,
            track_key: s.track_key,
            merge_step_ids: s.merges,
            ...(handOver ? { assigner_user_id: userId } : {}),
          },
        })
      } else {
        await tx.workflowStep.create({
          data: {
            id: s.id,
            organization_id: orgId,
            workflow_template_id: templateId,
            order_index: s.order_index,
            track_key: s.track_key,
            merge_step_ids: s.merges,
            is_branch_step: false,
            // The step's tasks are created by the person who added the step.
            assigner_user_id: userId,
            ...this.stepColumns(s.state, s.deps),
          },
        })
      }
    }
  }

  /**
   * Replace the schedules. A new entry's last-fired marker is "now" (it never fires an
   * occurrence from before it existed); kept entries keep theirs and their counts.
   * Going Live sets every marker to now, so nothing missed while it was a draft fires.
   */
  private async applySchedules(
    tx: Tx,
    orgId: string,
    templateId: string,
    schedules: ReturnType<WorkflowTemplateService['scheduleData']>[],
    existing: WorkflowScheduleEntry[],
    orgNow: Date,
    goingLive: boolean,
  ) {
    const keep = new Set(schedules.map((x) => x.id).filter(Boolean))
    const removed = existing.filter((e) => !keep.has(e.id)).map((e) => e.id)
    if (removed.length) {
      await tx.workflowScheduleEntry.deleteMany({
        where: { id: { in: removed }, workflow_template_id: templateId, organization_id: orgId },
      })
    }
    for (const x of schedules) {
      const data = { ...x.data, yearly_dates: x.data.yearly_dates as unknown as Prisma.InputJsonArray }
      if (x.id) {
        await tx.workflowScheduleEntry.updateMany({
          where: { id: x.id, workflow_template_id: templateId, organization_id: orgId },
          data,
        })
      } else {
        await tx.workflowScheduleEntry.create({
          data: { ...data, organization_id: orgId, workflow_template_id: templateId, last_fired_at: orgNow },
        })
      }
    }
    if (goingLive) await this.markSchedulesFiredUpTo(tx, orgId, templateId, orgNow)
  }

  /** "Nothing before `at` is due" — used when a workflow goes live or is resumed. */
  private async markSchedulesFiredUpTo(tx: Tx, orgId: string, templateId: string, at: Date) {
    await tx.workflowScheduleEntry.updateMany({
      where: {
        workflow_template_id: templateId,
        organization_id: orgId,
        OR: [{ last_fired_at: null }, { last_fired_at: { lt: at } }],
      },
      data: { last_fired_at: at },
    })
  }

  /** Editors (`edit` grants) and starters (`trigger` grants) → exactly these lists. */
  private async applyGrants(
    tx: Tx,
    orgId: string,
    templateId: string,
    current: { user_id: string; access_type: WorkflowAccessType }[],
    editors: string[],
    starters: string[],
  ) {
    const has = (type: WorkflowAccessType, id: string) => current.some((g) => g.access_type === type && g.user_id === id)
    const drop = current.filter(
      (g) =>
        (g.access_type === 'edit' && !editors.includes(g.user_id)) ||
        (g.access_type === 'trigger' && !starters.includes(g.user_id)),
    )
    if (drop.length) {
      await tx.workflowAccess.deleteMany({
        where: {
          workflow_template_id: templateId,
          organization_id: orgId,
          OR: drop.map((g) => ({ access_type: g.access_type, user_id: g.user_id })),
        },
      })
    }
    const add = [
      ...editors.filter((id) => !has('edit', id)).map((user_id) => ({ user_id, access_type: 'edit' as WorkflowAccessType })),
      ...starters
        .filter((id) => !has('trigger', id))
        .map((user_id) => ({ user_id, access_type: 'trigger' as WorkflowAccessType })),
    ]
    if (add.length) {
      await tx.workflowAccess.createMany({
        data: add.map((r) => ({ ...r, organization_id: orgId, workflow_template_id: templateId })),
        skipDuplicates: true,
      })
    }
  }

  /** Pause a Live workflow: no new runs, schedules skip. Running runs carry on. */
  async pauseTemplate(orgId: string, templateId: string, p: Principal) {
    const { t } = await this.loadEditable(orgId, templateId, p)
    if (t.status === 'draft') throw new BadRequestException('Only a live workflow can be paused.')
    if (t.status === 'active') {
      await this.prisma.workflowTemplate.updateMany({
        where: { id: templateId, organization_id: orgId, status: 'active' },
        data: { status: 'paused', updated_at: new Date() },
      })
    }
    return this.templateDetail(orgId, templateId, p)
  }

  /**
   * Resume a paused workflow. Occurrences missed while paused are NOT caught up: every
   * schedule's last-fired marker moves to now (org clock).
   */
  async resumeTemplate(orgId: string, templateId: string, p: Principal) {
    const { t } = await this.loadEditable(orgId, templateId, p)
    if (t.status === 'draft') throw new BadRequestException('This workflow is a draft. Save it to make it live.')
    if (t.status === 'paused') {
      const now = await this.clock.now(orgId)
      await this.prisma.$transaction(async (tx) => {
        const res = await tx.workflowTemplate.updateMany({
          where: { id: templateId, organization_id: orgId, status: 'paused' },
          data: { status: 'active', updated_at: new Date() },
        })
        if (res.count === 1) await this.markSchedulesFiredUpTo(tx, orgId, templateId, now)
      })
    }
    return this.templateDetail(orgId, templateId, p)
  }

  /** Archive (never a hard delete). Running runs carry on; nothing new starts. */
  async archiveTemplate(orgId: string, templateId: string, p: Principal) {
    await this.loadEditable(orgId, templateId, p, { allowArchived: true })
    await this.prisma.workflowTemplate.updateMany({
      where: { id: templateId, organization_id: orgId },
      data: { status: 'archived', updated_at: new Date() },
    })
    return this.templateDetail(orgId, templateId, p)
  }

  /** Restore an archived workflow — it comes back as a Draft. */
  async restoreTemplate(orgId: string, templateId: string, p: Principal) {
    const { t } = await this.loadEditable(orgId, templateId, p, { allowArchived: true })
    if (t.status !== 'archived') throw new BadRequestException('Only archived workflows can be restored.')
    await this.prisma.workflowTemplate.updateMany({
      where: { id: templateId, organization_id: orgId, status: 'archived' },
      data: { status: 'draft', updated_at: new Date() },
    })
    return this.templateDetail(orgId, templateId, p)
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Steps
  // ════════════════════════════════════════════════════════════════════════════

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
      ? this.stateOf(existing)
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

  /** The rules that make one step runnable (Save, and every save while Live). */
  private stepRunnableProblem(st: StepState, activeMembers: Set<string> | null): string | null {
    if (!st.title.trim()) return 'enter a title.'
    if (!st.assignee_user_ids.length) return 'add at least one assignee.'
    if (activeMembers && st.assignee_user_ids.some((id) => !activeMembers.has(id))) {
      return 'an assignee is no longer active. Choose someone else.'
    }
    if (st.escalation_mode === 'people') {
      if (!st.escalation_user_ids.length) {
        return 'add someone to escalate to, or choose “Reporting manager”.'
      }
      if (st.escalation_user_ids.length > MAX_ESCALATION_CONTACTS) {
        return `choose at most ${MAX_ESCALATION_CONTACTS} people to escalate to.`
      }
      if (activeMembers && st.escalation_user_ids.some((id) => !activeMembers.has(id))) {
        return 'someone it escalates to is no longer active. Choose someone else.'
      }
    }
    return null
  }

  /** The legacy columns kept in sync for back-compat readers (never read by v2). */
  private stepColumns(st: StepState, deps: string[]) {
    return {
      title: st.title,
      description: st.description,
      assignee_user_ids: st.assignee_user_ids,
      cc_user_ids: st.cc_user_ids,
      completion_mode: st.completion_mode,
      priority_id: st.priority_id,
      category_id: st.category_id,
      tag_ids: st.tag_ids,
      checklist_items: st.checklist_items as unknown as Prisma.InputJsonArray,
      proof_required: st.proof_required,
      proof_allowed_extensions: st.proof_allowed_extensions,
      due_days: st.due_days,
      due_time: st.due_time,
      escalation_mode: st.escalation_mode,
      escalation_user_ids: st.escalation_user_ids,
      if_late: st.if_late,
      start_rule: st.start_rule ? (st.start_rule as Prisma.InputJsonObject) : Prisma.DbNull,
      due_rule: st.due_rule ? (st.due_rule as Prisma.InputJsonObject) : Prisma.DbNull,
      depends_on_step_ids: deps,
      // Legacy mirror (old readers / old snapshots): first assignee, "N days after start".
      assignee_type: 'fixed_person' as const,
      assignee_user_id: st.assignee_user_ids[0] ?? null,
      assignee_role: null,
      deadline_config: { type: 'x_days_after_start', days: st.due_days, time: st.due_time } as Prisma.InputJsonObject,
      if_overdue_action: st.if_late === 'move_on' ? ('proceed_anyway' as const) : ('block_next' as const),
      branch_step_id: null,
    }
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
  ): Promise<{ message: string; step: ProposedStep } | null> {
    const userIds = steps.flatMap((s) => [...s.state.assignee_user_ids, ...s.state.escalation_user_ids])
    const priorityIds = unique(steps.map((s) => s.state.priority_id).filter((x): x is string => !!x))
    const categoryIds = unique(steps.map((s) => s.state.category_id).filter((x): x is string => !!x))
    const [active, priorities, categories] = await Promise.all([
      this.activeMemberSet(orgId, userIds),
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
      const runnable = this.stepRunnableProblem(s.state, active)
      if (runnable) return fail(runnable)
      if (s.state.priority_id && !prioritySet.has(s.state.priority_id)) {
        return fail('its priority is no longer active. Choose another.')
      }
      if (s.state.category_id && !categorySet.has(s.state.category_id)) {
        return fail('its category is no longer active. Choose another.')
      }
      const timing = timingProblem(s.state.start_rule, s.state.due_rule, frequency)
      if (timing) return fail(timing)
    }
    if (!steps.some((s) => s.deps.length === 0)) {
      return {
        message: 'At least one step must start at the beginning. Remove an “Also waits for” from the first step on the main path.',
        step: steps[0],
      }
    }
    return null
  }

  // ════════════════════════════════════════════════════════════════════════════
  // My workflows
  // ════════════════════════════════════════════════════════════════════════════

  private ownedWhere(orgId: string, userId: string): Prisma.WorkflowTemplateWhereInput {
    return {
      organization_id: orgId,
      OR: [{ created_by_user_id: userId }, { owner_user_ids: { array_contains: [userId] } }],
    }
  }

  async getOwnedWorkflows(orgId: string, p: Principal) {
    const rows = await this.prisma.workflowTemplate.findMany({
      where: { ...this.ownedWhere(orgId, p.userId), status: { not: 'archived' } },
      include: templateInclude(p.userId),
      orderBy: { created_at: 'desc' },
    })
    return this.formatTemplates(orgId, rows, p)
  }

  async getOwnedInstances(orgId: string, p: Principal) {
    const rows = await this.prisma.workflowInstance.findMany({
      where: { organization_id: orgId, status: { in: IN_FLIGHT }, template: this.ownedWhere(orgId, p.userId) },
      include: instanceInclude(p.userId),
      orderBy: { started_at: 'desc' },
      take: INSTANCE_LIST_LIMIT,
    })
    return this.formatInstances(orgId, rows, p)
  }

  /** Running runs in which the caller is a (non-CC) assignee of a step task. */
  async getAssignedInstances(orgId: string, p: Principal) {
    const ids = await participantInstanceIds(this.prisma, orgId, p.userId, { assigneesOnly: true })
    if (!ids.length) return []
    const rows = await this.prisma.workflowInstance.findMany({
      where: { id: { in: ids }, organization_id: orgId, status: { in: IN_FLIGHT } },
      include: instanceInclude(p.userId),
      orderBy: { started_at: 'desc' },
      take: INSTANCE_LIST_LIMIT,
    })
    return this.formatInstances(orgId, rows, p)
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Runs
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Run gate: `can_view` on its template OR a participant of the run. Scoped by
   * org + parent template id (404 otherwise).
   */
  private async loadInstance(orgId: string, templateId: string, instanceId: string, p: Principal) {
    const inst = await this.prisma.workflowInstance.findFirst({
      where: { id: instanceId, workflow_template_id: templateId, organization_id: orgId },
      include: instanceInclude(p.userId),
    })
    if (!inst) throw new NotFoundException(MSG_RUN_NOT_FOUND)
    const caps = this.capabilitiesFor(inst.template, p)
    let participantCache: boolean | null = null
    const isParticipant = async () => {
      if (participantCache === null) {
        participantCache = caps.can_edit || (await isRunParticipant(this.prisma, orgId, instanceId, p.userId))
      }
      return participantCache
    }
    if (!caps.can_view && !(await isParticipant())) throw new ForbiddenException(MSG_INSTANCE_VIEW)
    return { inst, caps, isParticipant }
  }

  /** Run documents/files: participants only. */
  private async loadRunForFiles(orgId: string, templateId: string, instanceId: string, p: Principal) {
    const loaded = await this.loadInstance(orgId, templateId, instanceId, p)
    if (!(await loaded.isParticipant())) throw new ForbiddenException(MSG_RUN_FILES)
    return loaded
  }

  private async instanceDetail(orgId: string, templateId: string, instanceId: string, p: Principal) {
    const { inst } = await this.loadInstance(orgId, templateId, instanceId, p)
    const [out] = await this.formatInstances(orgId, [inst], p)
    return out
  }

  async listInstances(orgId: string, templateId: string, p: Principal) {
    const t = await this.prisma.workflowTemplate.findFirst({
      where: { id: templateId, organization_id: orgId },
      select: accessSelect(p.userId),
    })
    if (!t) throw new NotFoundException(MSG_NOT_FOUND)
    const caps = this.capabilitiesFor(t, p)
    // Without template access, a caller only sees the runs they're involved in.
    const visible: Prisma.WorkflowInstanceWhereInput = caps.can_view
      ? {}
      : {
          id: {
            in: await participantInstanceIds(this.prisma, orgId, p.userId, { templateId, includeStarted: true }),
          },
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
    await this.loadInstance(orgId, templateId, instanceId, p)
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
    const names = await this.userNames(tasks.flatMap((t) => t.assignees.map((a) => a.user_id)))
    return tasks.map((t) =>
      flattenTags({
        ...t,
        assignees: t.assignees.map((a) => ({ ...a, name: names.get(a.user_id) ?? 'Unknown user' })),
      }),
    )
  }

  /**
   * Start a run by hand. Only while Live (not paused), only when "Manually" is on, and
   * only by the people chosen under "Manually".
   */
  async triggerInstance(orgId: string, templateId: string, name: string | undefined, p: Principal) {
    const { t, caps } = await this.loadTemplate(orgId, templateId, p)
    if (t.status === 'archived') throw new BadRequestException(MSG_ARCHIVED_START)
    if (t.status === 'draft') throw new BadRequestException(MSG_DRAFT_START)
    if (t.status === 'paused') throw new BadRequestException(MSG_PAUSED)
    if (t.manual_start_enabled === false) throw new BadRequestException(MSG_SCHEDULE_ONLY)
    if (!caps.can_trigger) throw new ForbiddenException(MSG_TRIGGER)
    const trimmed = name?.trim()
    const created = await this.engine.createInstance(
      orgId,
      templateId,
      MANUAL_START,
      trimmed ? { name: trimmed } : {},
      p.userId,
    )
    return this.instanceDetail(orgId, templateId, created.id, p)
  }

  /** Run actions need `can_edit` on the template; the engine owns all state changes. */
  private async loadRunAction(orgId: string, templateId: string, instanceId: string, p: Principal) {
    await this.loadEditable(orgId, templateId, p, { allowArchived: true })
    const inst = await this.prisma.workflowInstance.findFirst({
      where: { id: instanceId, workflow_template_id: templateId, organization_id: orgId },
      select: { id: true },
    })
    if (!inst) throw new NotFoundException(MSG_RUN_NOT_FOUND)
  }

  async cancelInstance(orgId: string, templateId: string, instanceId: string, p: Principal) {
    await this.loadRunAction(orgId, templateId, instanceId, p)
    await this.engine.cancelInstance(orgId, instanceId, p.userId)
    return this.instanceDetail(orgId, templateId, instanceId, p)
  }

  async retryInstance(orgId: string, templateId: string, instanceId: string, p: Principal) {
    await this.loadRunAction(orgId, templateId, instanceId, p)
    await this.engine.retryInstance(orgId, instanceId, p.userId)
    return this.instanceDetail(orgId, templateId, instanceId, p)
  }

  /** Skip one step (`row_id`), or the single current step when omitted. */
  async skipStep(orgId: string, templateId: string, instanceId: string, rowId: string | undefined, p: Principal) {
    await this.loadRunAction(orgId, templateId, instanceId, p)
    if (rowId) {
      const row = await this.prisma.workflowInstanceStep.findFirst({
        where: { id: rowId, workflow_instance_id: instanceId, organization_id: orgId },
        select: { id: true },
      })
      if (!row) throw new NotFoundException('Step not found in this run')
    }
    await this.engine.skipStep(orgId, instanceId, p.userId, rowId)
    return this.instanceDetail(orgId, templateId, instanceId, p)
  }

  /**
   * "Start now" (`can_edit`): a waiting row starts immediately. The row is scoped to
   * this run + org (404 otherwise); the engine re-checks it is waiting inside its
   * transaction.
   */
  async startStepNow(orgId: string, templateId: string, instanceId: string, rowId: string, p: Principal) {
    await this.loadRunAction(orgId, templateId, instanceId, p)
    const row = await this.prisma.workflowInstanceStep.findFirst({
      where: { id: rowId, workflow_instance_id: instanceId, organization_id: orgId },
      select: { id: true },
    })
    if (!row) throw new NotFoundException('Step not found in this run')
    await this.engine.startStepNow(orgId, instanceId, rowId, p.userId)
    return this.instanceDetail(orgId, templateId, instanceId, p)
  }

  /** A row of this run (scoped by run + org), or 404. */
  private rowOf(inst: InstanceRow, rowId: string): InstanceStepRow {
    const row = inst.steps.find((s) => s.id === rowId)
    if (!row || isLegacyBranchRow(row)) throw new NotFoundException('Step not found in this run')
    return row
  }

  /** Each flow row's number in its run ("1", "B2"). */
  private rowLabels(inst: InstanceRow, deps: Map<string, string[]> = rowDependencyMap(inst.steps)): Map<string, string> {
    return runLanes(inst.steps, deps).labels
  }

  private stepTitle(row: InstanceStepRow): string {
    return readSnapshot(row.step_snapshot)?.title ?? 'Step'
  }

  /** Is the caller a non-CC live assignee of this row's task? */
  private async isRowWorker(orgId: string, taskId: string | null, userId: string): Promise<boolean> {
    if (!taskId) return false
    const hit = await this.prisma.taskAssignee.findFirst({
      where: { task_id: taskId, organization_id: orgId, user_id: userId, is_cc: false, ...ACTIVE_ASSIGNEE },
      select: { id: true },
    })
    return !!hit
  }

  /**
   * Completed steps upstream of `rowId` (direct predecessors first) — where a send
   * back from it may go. Run view is enough to read them.
   */
  async getSendBackTargets(orgId: string, templateId: string, instanceId: string, rowId: string, p: Principal) {
    const { inst } = await this.loadInstance(orgId, templateId, instanceId, p)
    this.rowOf(inst, rowId)
    const deps = rowDependencyMap(inst.steps)
    const direct = new Set(deps.get(rowId) ?? [])
    const labels = this.rowLabels(inst, deps)
    return sendBackTargets(inst.steps, deps, rowId).map(({ row }) => ({
      row_id: row.id,
      title: this.stepTitle(row),
      /** "1", "B2". */
      number_label: labels.get(row.id) ?? null,
      is_direct: direct.has(row.id),
    }))
  }

  /**
   * Send the run back from `rowId` to an earlier completed step, with a reason. The
   * step's own (non-CC) assignees or people who can change the workflow may do it;
   * the target must be a completed step upstream of it. The engine re-checks every
   * precondition inside its transaction.
   */
  async sendBack(orgId: string, templateId: string, instanceId: string, rowId: string, dto: SendBackDto, p: Principal) {
    const { inst, caps } = await this.loadInstance(orgId, templateId, instanceId, p)
    const row = this.rowOf(inst, rowId)
    if (!IN_FLIGHT.includes(inst.status)) throw new BadRequestException('This run has finished, so it can’t be sent back.')
    if (!caps.can_edit && !(await this.isRowWorker(orgId, row.task_id, p.userId))) {
      throw new ForbiddenException(MSG_SEND_BACK)
    }
    if (!SEND_BACK_FROM.includes(row.status)) {
      throw new BadRequestException('Only a step that is in progress can be sent back.')
    }
    const targets = sendBackTargets(inst.steps, rowDependencyMap(inst.steps), rowId)
    if (!targets.some((t) => t.row.id === dto.to_row_id)) {
      throw new BadRequestException('You can only send it back to an earlier step that is done.')
    }
    await this.engine.sendBack(orgId, instanceId, rowId, dto.to_row_id, dto.reason.trim(), p.userId, {
      canEdit: caps.can_edit,
    })
    return this.instanceDetail(orgId, templateId, instanceId, p)
  }

  /** Run history, newest first. */
  async listEvents(orgId: string, templateId: string, instanceId: string, p: Principal) {
    await this.loadInstance(orgId, templateId, instanceId, p)
    const events = await this.prisma.workflowInstanceEvent.findMany({
      where: { workflow_instance_id: instanceId, organization_id: orgId },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: EVENT_LIMIT,
    })
    const names = await this.userNames(events.map((e) => e.actor_user_id))
    return events.map((e) => ({
      id: e.id,
      type: e.type,
      message: e.message,
      actor: this.ref(e.actor_user_id, names),
      instance_step_id: e.instance_step_id,
      created_at: e.created_at,
      metadata: e.metadata ?? null,
    }))
  }

  /** Every step's files (proof-visibility filtered) + the run's own files. */
  async getDocuments(orgId: string, templateId: string, instanceId: string, p: Principal) {
    const { inst } = await this.loadRunForFiles(orgId, templateId, instanceId, p)
    const rows = inst.steps
      .filter((s) => !isLegacyBranchRow(s))
      .sort(byDisplayOrder)
      .map((s) => ({ row_id: s.id, step_title: this.stepTitle(s), task_id: s.task_id }))
    return this.files.documents(orgId, instanceId, rows, { userId: p.userId, isAdmin: this.isAdmin(p) })
  }

  async uploadRunFile(orgId: string, templateId: string, instanceId: string, file: UploadedFile | undefined, p: Principal) {
    await this.loadRunForFiles(orgId, templateId, instanceId, p)
    return this.files.upload(orgId, p.userId, instanceId, file)
  }

  async downloadRunFile(orgId: string, templateId: string, instanceId: string, fileId: string, p: Principal) {
    await this.loadRunForFiles(orgId, templateId, instanceId, p)
    return this.files.getDownloadUrl(orgId, instanceId, fileId)
  }

  /** Remove a run file: its uploader, or people who can change the workflow. */
  async deleteRunFile(orgId: string, templateId: string, instanceId: string, fileId: string, p: Principal) {
    const { caps } = await this.loadInstance(orgId, templateId, instanceId, p)
    const file = await this.files.findRunFile(orgId, instanceId, fileId)
    if (file.uploaded_by_user_id !== p.userId && !caps.can_edit) throw new ForbiddenException(MSG_REMOVE_FILE)
    return this.files.remove(orgId, p.userId, instanceId, fileId)
  }

  /**
   * The workflow context of a task (task-detail banner + Send back), gated by the
   * TASK view rule. `null` when the task isn't a workflow step task (or its run is gone).
   */
  async getStepContext(orgId: string, taskId: string, p: Principal) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organization_id: orgId, is_deleted: false },
      select: { id: true, workflow_instance_step_id: true },
    })
    if (!task) throw new NotFoundException('Task not found')
    await this.assertCanViewTask(orgId, p, taskId)
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

    const caps = this.capabilitiesFor(inst.template, p)
    const main = inst.steps.filter((s) => !isLegacyBranchRow(s)).sort(byDisplayOrder)
    const inFlight = IN_FLIGHT.includes(inst.status)
    const mayAct = caps.can_edit || (await this.isRowWorker(orgId, row.task_id, p.userId))
    const canSendBack =
      inFlight &&
      SEND_BACK_FROM.includes(row.status) &&
      mayAct &&
      sendBackTargets(inst.steps, rowDependencyMap(inst.steps), row.id).length > 0
    const canOpenRun = caps.can_view || caps.can_edit || (await isRunParticipant(this.prisma, orgId, inst.id, p.userId))
    const index = main.findIndex((s) => s.id === row.id)
    return {
      template_id: inst.template.id,
      template_name: inst.template.name,
      instance_id: inst.id,
      instance_name: inst.name,
      instance_status: inst.status,
      row_id: row.id,
      row_status: row.status as string,
      step_title: this.stepTitle(row),
      step_number: index >= 0 ? index + 1 : null,
      /** "1", "B2" — the step's number in its run. */
      step_label: this.rowLabels(inst).get(row.id) ?? (index >= 0 ? `${index + 1}` : null),
      total_steps: main.length,
      can_send_back: canSendBack,
      can_open_run: canOpenRun,
    }
  }
}
