import { CompletionMode, RecurringEndCondition, RecurringScheduleType } from '@prisma/client'
import { Transform, Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator'

import { MAX_TRACKS, TRACK_KEY_RE, TRACK_NAME_MAX } from '../tracks'

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value)
const present = (_: unknown, v: unknown) => v !== undefined

// ── Step rules (workflows v2 spec §C — a step IS a task the system creates) ────────

/** Same limit as a task title. */
export const STEP_TITLE_MAX = 50
/** Same limit as a task description. */
export const STEP_DESCRIPTION_MAX = 2000
export const MAX_STEP_ASSIGNEES = 20
export const MAX_STEP_CCS = 50
export const MAX_ESCALATION_CONTACTS = 5
export const MAX_STEP_TAGS = 10
export const MAX_STEP_DEPENDENCIES = 200
export const MAX_STEPS = 100
export const MAX_SCHEDULES = 20
export const IF_LATE_VALUES = ['wait', 'move_on'] as const
export type IfLate = (typeof IF_LATE_VALUES)[number]
export const ESCALATION_MODES = ['manager', 'people'] as const
export type EscalationMode = (typeof ESCALATION_MODES)[number]
export const DUE_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
export const DEFAULT_DUE_DAYS = 1
export const DEFAULT_DUE_TIME = '18:00'
export const SAVE_MODES = ['draft', 'save'] as const
export type SaveMode = (typeof SAVE_MODES)[number]

export class ChecklistItemDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Checklist items cannot be blank.' })
  @MaxLength(300)
  title: string

  /** Optional checklist section heading this item sits under. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  group_title?: string | null

  /**
   * Set when this item belongs to an org checklist template (Work Settings) linked to
   * the step. Linked, not copied: the template's CURRENT items are used when a run
   * starts; the items sent here are only the saved copy, used if the template is later
   * deleted or deactivated. On save the server rewrites an active template's group to
   * its current items (group_title = template name).
   */
  @IsOptional()
  @IsUUID('all', { message: 'Choose a valid checklist template.' })
  template_id?: string | null

  /** Ignored — items are stored in array order. Accepted for older clients. */
  @IsOptional()
  @IsInt()
  @Min(0)
  order_index?: number
}

/**
 * One step of the definition. `key` identifies the step INSIDE this request (an
 * existing step's id, or any client key for a step not saved yet) so "Also wait for"
 * and tracks can point at steps that don't exist yet. `id` = the existing step being kept
 * (omitted for a new one). Every field is the step's whole new state; omitted fields
 * keep the stored value (new steps: the defaults). The title may be blank in a draft.
 */
export class DefinitionStepDto {
  @IsString()
  @IsNotEmpty({ message: 'Each step needs a key.' })
  @MaxLength(64)
  key: string

  @IsOptional()
  @IsUUID('all', { message: 'One of the steps is not valid. Reload and try again.' })
  id?: string

  @Transform(trim)
  @IsString()
  @MaxLength(STEP_TITLE_MAX, { message: `A step title can be at most ${STEP_TITLE_MAX} characters.` })
  title: string

  @IsOptional()
  @IsString()
  @MaxLength(STEP_DESCRIPTION_MAX, { message: `A step description can be at most ${STEP_DESCRIPTION_MAX} characters.` })
  description?: string | null

  @ValidateIf(present)
  @IsArray()
  @ArrayMaxSize(MAX_STEP_ASSIGNEES, { message: `A step can be assigned to at most ${MAX_STEP_ASSIGNEES} people.` })
  @ArrayUnique({ message: 'Each person can be assigned only once.' })
  @IsUUID('all', { each: true, message: 'Choose valid assignees.' })
  assignee_user_ids?: string[]

  @ValidateIf(present)
  @IsArray()
  @ArrayMaxSize(MAX_STEP_CCS, { message: `A step can CC at most ${MAX_STEP_CCS} people.` })
  @ArrayUnique({ message: 'Each person can be CC’d only once.' })
  @IsUUID('all', { each: true, message: 'Choose valid people to CC.' })
  cc_user_ids?: string[]

  @ValidateIf(present)
  @IsEnum(CompletionMode, { message: 'Completion must be any_can_complete or all_must_complete.' })
  completion_mode?: CompletionMode

  @IsOptional()
  @IsUUID('all', { message: 'Choose a valid priority.' })
  priority_id?: string | null

  @IsOptional()
  @IsUUID('all', { message: 'Choose a valid category.' })
  category_id?: string | null

  @ValidateIf(present)
  @IsArray()
  @ArrayMaxSize(MAX_STEP_TAGS, { message: `A step can have at most ${MAX_STEP_TAGS} tags.` })
  @IsUUID('all', { each: true, message: 'Choose valid tags.' })
  tag_ids?: string[]

  @ValidateIf(present)
  @IsArray()
  @ArrayMaxSize(50, { message: 'A step can have at most 50 checklist items.' })
  @ValidateNested({ each: true })
  @Type(() => ChecklistItemDto)
  checklist_items?: ChecklistItemDto[]

  @ValidateIf(present)
  @IsBoolean()
  proof_required?: boolean

  /** Allowed proof file extensions (no dot). Empty = any allowed attachment type. */
  @ValidateIf(present)
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(10, { each: true })
  proof_allowed_extensions?: string[]

  @ValidateIf(present)
  @IsInt({ message: 'Days must be 0 to 365.' })
  @Min(0, { message: 'Days must be 0 to 365.' })
  @Max(365, { message: 'Days must be 0 to 365.' })
  due_days?: number

  @ValidateIf(present)
  @Matches(DUE_TIME_RE, { message: 'Enter a valid due time.' })
  due_time?: string

  /**
   * When the step starts — `{ kind, ...params, time: 'HH:mm' }` (engine/timing.ts):
   * immediate | days_after_previous | days_after_run_start | time_of_day | weekday |
   * month_day | year_date | cycle_weekday | cycle_month_day | cycle_year_date.
   * null = as soon as the steps before it are done. Omitted = unchanged. Its params and
   * whether the kind suits how the workflow repeats are checked on Save (a draft may
   * hold a partial rule).
   */
  @IsOptional()
  @IsObject({ message: 'Choose when the step starts.' })
  start_rule?: Record<string, unknown> | null

  /**
   * When the step is due — days_after_start (mirrored into due_days / due_time) or a
   * calendar kind (the next occurrence strictly after the step's start). null = due
   * `due_days` after it starts at `due_time`. Omitted = unchanged. Checked on Save.
   */
  @IsOptional()
  @IsObject({ message: 'Choose when the step is due.' })
  due_rule?: Record<string, unknown> | null

  @ValidateIf(present)
  @IsIn(ESCALATION_MODES as unknown as string[], { message: "Escalate to must be 'manager' or 'people'." })
  escalation_mode?: EscalationMode

  /** Used when `escalation_mode` is 'people': 1–5 people, in order (= escalation levels). */
  @ValidateIf(present)
  @IsArray()
  @ArrayMaxSize(MAX_ESCALATION_CONTACTS, { message: `Choose at most ${MAX_ESCALATION_CONTACTS} people to escalate to.` })
  @ArrayUnique({ message: 'Each escalation contact can appear only once.' })
  @IsUUID('all', { each: true, message: 'Choose valid people to escalate to.' })
  escalation_user_ids?: string[]

  @ValidateIf(present)
  @IsIn(IF_LATE_VALUES as unknown as string[], { message: "If late must be 'wait' or 'move_on'." })
  if_late?: IfLate

  /**
   * The track the step is in ('main' — the default — or 'B', 'C', …; listed in
   * `tracks`). Its position in the track = its order among that track's steps in
   * `steps`. Its "starts after" is derived from this on save (never sent).
   */
  @IsOptional()
  @IsString()
  @Matches(TRACK_KEY_RE, { message: 'One of the steps is on a path that is not valid. Reload and try again.' })
  track_key?: string

  /** "Also wait for": KEYS of steps in OTHER tracks this step also waits for (a merge). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_STEP_DEPENDENCIES)
  @ArrayUnique({ message: '“Also waits for” can list each step only once.' })
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  merge_step_keys?: string[]
}

/**
 * One track of the definition. `key` = 'main' or a letter key ('B', 'C', … — the
 * builder assigns the next free one to a new track; it stays stable once saved). The
 * array order is the display order (main always first). A track with no steps is
 * dropped on save.
 */
export class DefinitionTrackDto {
  @IsString()
  @Matches(TRACK_KEY_RE, { message: 'One of the paths is not valid. Reload and try again.' })
  key: string

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Transform(trim)
  @IsString()
  @MaxLength(TRACK_NAME_MAX, { message: `A path name can be at most ${TRACK_NAME_MAX} characters.` })
  name?: string | null

  /**
   * KEY of the step (in another track) this track starts after — "Split here".
   * null = it starts when the workflow starts. Ignored for main.
   */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(64)
  split_from_step_key?: string | null
}

export class YearlyDateDto {
  @IsInt()
  @Min(1)
  @Max(12)
  month: number

  @IsInt()
  @Min(1)
  @Max(31)
  day: number
}

/**
 * One "On a schedule" entry — the recurring-task schedule format, unchanged
 * (`CreateScheduleEntryDto`), plus the `id` of an entry being kept. Completeness
 * (weekdays for weekly, an end date for "on date", …) is checked on Save, not on
 * Save draft.
 */
export class DefinitionScheduleDto {
  @IsOptional()
  @IsUUID('all', { message: 'One of the schedules is not valid. Reload and try again.' })
  id?: string

  @IsEnum(RecurringScheduleType, { message: 'Repeat must be daily, weekly, monthly or yearly.' })
  schedule_type: RecurringScheduleType

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  every?: number

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  days?: number[]

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(31)
  @IsNumber({}, { each: true })
  @Min(-31, { each: true })
  @Max(31, { each: true })
  month_days?: number[]

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(24)
  @ValidateNested({ each: true })
  @Type(() => YearlyDateDto)
  yearly_dates?: YearlyDateDto[]

  @IsString()
  @Matches(DUE_TIME_RE, { message: 'Enter a valid schedule time.' })
  time: string

  @IsISO8601({ strict: true }, { message: 'Choose a start date for the schedule.' })
  start_date: string

  @IsOptional()
  @IsEnum(RecurringEndCondition, { message: 'Ends must be never, on a date, or after a number of runs.' })
  end_condition?: RecurringEndCondition

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsISO8601({ strict: true }, { message: 'Choose a valid end date.' })
  end_date?: string | null

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(10000)
  end_after?: number | null
}

export class DefinitionManualDto {
  @IsBoolean()
  enabled: boolean

  /**
   * Who may start it by hand — ONLY these people (owners, editors and admins are not
   * starters unless listed). Stored as the workflow's `trigger` grants. Omitted =
   * unchanged. Changing it needs "can change who is involved".
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500, { message: 'At most 500 people can start a workflow.' })
  @ArrayUnique({ message: 'Each person can be listed only once.' })
  @IsUUID('all', { each: true, message: 'Choose valid people under “Who can start it”.' })
  starter_user_ids?: string[]
}

export class DefinitionStartsDto {
  @ValidateNested()
  @Type(() => DefinitionManualDto)
  manual: DefinitionManualDto

  @IsArray()
  @ArrayMaxSize(MAX_SCHEDULES, { message: `A workflow can have at most ${MAX_SCHEDULES} schedules.` })
  @ValidateNested({ each: true })
  @Type(() => DefinitionScheduleDto)
  schedules: DefinitionScheduleDto[]
}

/**
 * Owners and editors ("can change it"). Someone listed as an owner is never also
 * stored as an editor. Changing them needs "can change who is involved".
 */
export class DefinitionPeopleDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'A workflow needs at least one owner.' })
  @ArrayMaxSize(50, { message: 'A workflow can have at most 50 owners.' })
  @ArrayUnique({ message: 'Each owner can be listed only once.' })
  @IsUUID('all', { each: true, message: 'Each owner must be a valid person.' })
  owner_user_ids: string[]

  @IsArray()
  @ArrayMaxSize(200, { message: 'A workflow can have at most 200 editors.' })
  @ArrayUnique({ message: 'Each editor can be listed only once.' })
  @IsUUID('all', { each: true, message: 'Each editor must be a valid person.' })
  editor_user_ids: string[]
}

/**
 * `POST /workflows/definition` (create) and `PUT /workflows/:id/definition` (save) —
 * the WHOLE workflow in one request, applied in one transaction.
 *
 *  - `mode: 'draft'` (Save draft) keeps a draft a draft and only needs a name.
 *  - `mode: 'save'` (Save) validates everything and makes a draft Live.
 *  - A Live or Paused workflow is always fully validated (it can never be saved
 *    broken) and keeps its status.
 *
 * `expected_updated_at` (the `updated_at` the editor loaded) turns a save over
 * someone else's newer save into a 409 instead of silently overwriting it.
 */
export class SaveDefinitionDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Enter a workflow name.' })
  @MaxLength(200, { message: 'A workflow name can be at most 200 characters.' })
  name: string

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null

  @IsIn(SAVE_MODES as unknown as string[], { message: "Mode must be 'draft' or 'save'." })
  mode: SaveMode

  @ValidateNested()
  @Type(() => DefinitionStartsDto)
  starts: DefinitionStartsDto

  @IsArray()
  @ArrayMaxSize(MAX_STEPS, { message: `A workflow can have at most ${MAX_STEPS} steps.` })
  @ValidateNested({ each: true })
  @Type(() => DefinitionStepDto)
  steps: DefinitionStepDto[]

  /** The tracks (main first). Omitted = only the main track. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TRACKS, { message: `A workflow can have at most ${MAX_TRACKS} paths.` })
  @ValidateNested({ each: true })
  @Type(() => DefinitionTrackDto)
  tracks?: DefinitionTrackDto[]

  /** Omitted = unchanged. */
  @IsOptional()
  @ValidateNested()
  @Type(() => DefinitionPeopleDto)
  people?: DefinitionPeopleDto

  @IsOptional()
  @IsISO8601({}, { message: 'Reload and try again.' })
  expected_updated_at?: string
}

/**
 * `POST /workflows/preview-timeline` — the builder's in-memory definition (the
 * definition save's shape; other fields are ignored). Nothing is stored.
 */
export class PreviewTimelineDto {
  @ValidateNested()
  @Type(() => DefinitionStartsDto)
  starts: DefinitionStartsDto

  @IsArray()
  @ArrayMaxSize(MAX_STEPS, { message: `A workflow can have at most ${MAX_STEPS} steps.` })
  @ValidateNested({ each: true })
  @Type(() => DefinitionStepDto)
  steps: DefinitionStepDto[]

  /** The tracks (main first). Omitted = only the main track. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TRACKS, { message: `A workflow can have at most ${MAX_TRACKS} paths.` })
  @ValidateNested({ each: true })
  @Type(() => DefinitionTrackDto)
  tracks?: DefinitionTrackDto[]
}
