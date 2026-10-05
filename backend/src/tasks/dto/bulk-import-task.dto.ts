import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

/**
 * How many assignee / CC / escalation dropdown columns the template exposes.
 * Kept small so every slot can be a REAL Excel dropdown (validation lists don't
 * support multi-select) while still covering the overwhelming majority of tasks.
 * A task needing more people can be topped up after import. Shared with the
 * frontend template builder via the import-options endpoint.
 */
export const IMPORT_ASSIGNEE_SLOTS = 5;
export const IMPORT_CC_SLOTS = 3;
export const IMPORT_ESCALATION_SLOTS = 3;

/**
 * One row from an uploaded task sheet. Everything is an optional string — the
 * import service validates each row individually so a single bad row produces a
 * friendly per-row error instead of failing (400-ing) the whole batch.
 * Priority / category / goal / checklist template / assignees are resolved by
 * their human-readable value. Assignees/CC/escalation arrive as flat, numbered
 * columns (assignee_1…), so the stored payload equals the sheet row 1-for-1 and
 * failed rows re-export without re-mapping.
 */
export class BulkTaskImportRowDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() title?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() description?: string;
  @ApiProperty({ required: false, description: 'Priority label (must already exist)' })
  @IsOptional() @IsString() priority?: string;
  @ApiProperty({ required: false, description: 'Category name (must already exist)' })
  @IsOptional() @IsString() category?: string;
  @ApiProperty({ required: false, description: 'Tag names, pipe- or newline-separated (each must already exist and be active; max 10)' })
  @IsOptional() @IsString() tags?: string;

  @ApiProperty({ required: false, description: 'YYYY-MM-DD' })
  @IsOptional() @IsString() deadline_date?: string;
  @ApiProperty({ required: false, description: 'HH:mm (24h); defaults to 23:59' })
  @IsOptional() @IsString() deadline_time?: string;

  // Assignees — one per numbered column, each an eligible-pool dropdown value.
  @ApiProperty({ required: false }) @IsOptional() @IsString() assignee_1?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() assignee_2?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() assignee_3?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() assignee_4?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() assignee_5?: string;

  // CC recipients.
  @ApiProperty({ required: false }) @IsOptional() @IsString() cc_1?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() cc_2?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() cc_3?: string;

  @ApiProperty({ required: false, description: 'any_can_complete | all_must_complete' })
  @IsOptional() @IsString() completion_mode?: string;

  @ApiProperty({ required: false, description: 'Yes/No — require a proof of completion' })
  @IsOptional() @IsString() proof_required?: string;
  @ApiProperty({ required: false, description: 'Allowed proof extensions, e.g. "pdf | png"' })
  @IsOptional() @IsString() proof_allowed_types?: string;

  // Escalation contacts — alerted level by level once overdue. Order = column order.
  @ApiProperty({ required: false }) @IsOptional() @IsString() escalation_1?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() escalation_2?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() escalation_3?: string;

  @ApiProperty({ required: false, description: 'Quarterly goal to link (initiative)' })
  @IsOptional() @IsString() linked_goal?: string;

  @ApiProperty({ required: false, description: 'Whole number of days before the deadline to remind' })
  @IsOptional() @IsString() reminder_days_before?: string;

  @ApiProperty({ required: false, description: 'Checklist template to apply (must be one you can use)' })
  @IsOptional() @IsString() checklist_template?: string;
  @ApiProperty({ required: false, description: 'Ad-hoc checklist items, pipe-separated' })
  @IsOptional() @IsString() checklist_items?: string;

  @ApiProperty({ required: false, description: 'Filenames to attach (uploaded in the modal), pipe-separated' })
  @IsOptional() @IsString() attachments?: string;

  @ApiProperty({ required: false, description: 'Yes/No — keep a deadline that falls on a non-working day' })
  @IsOptional() @IsString() holiday_override?: string;
}

export class BulkImportTasksDto {
  @ApiProperty({ type: [BulkTaskImportRowDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => BulkTaskImportRowDto)
  rows: BulkTaskImportRowDto[];

  @ApiProperty({ required: false, description: 'Original file name, stored on the import batch' })
  @IsOptional()
  @IsString()
  file_name?: string;
}

// ─── Import-options (feeds the template's reference sheets + dropdowns) ───────────

export interface TaskImportOptions {
  priorities: { id: string; label: string }[];
  categories: { id: string; name: string }[];
  // Active task tags, sorted by name — the valid values for the `tags` column.
  tags: { id: string; name: string }[];
  goals: { id: string; title: string }[];
  checklist_templates: { id: string; name: string }[];
  // Everyone the current user is allowed to assign a task to (the eligible pool).
  // `value` is the disambiguated dropdown value ("Name · Department · Role").
  assignees: {
    user_id: string;
    name: string;
    department_name: string | null;
    role_title: string | null;
    value: string;
  }[];
  // The proof file-type groups the org allows (extension chips), for the hint row.
  proof_extension_groups: { label: string; extensions: string[] }[];
  slots: { assignees: number; cc: number; escalations: number };
}

// ─── Validation (dry-run) result ────────────────────────────────────────────────

export type TaskImportRowStatus = 'ready' | 'error';

export interface TaskImportRowIssue {
  field?: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface TaskImportResolved {
  priority?: string;
  category?: string;
  tags?: string[]; // resolved tag display names, in cell order
  tag_ids?: string[]; // resolved tag ids, in cell order (de-duplicated)
  deadline?: string; // human-readable resolved deadline
  assignees?: string[];
  cc?: string[];
  escalations?: string[];
  goal?: string;
  checklist_template?: string;
  checklist_item_count?: number;
  attachment_names?: string[];
}

export interface TaskImportValidationRow {
  row: number; // 1-based sheet row (header is row 1, first data row is 2)
  title: string;
  status: TaskImportRowStatus;
  resolved: TaskImportResolved;
  issues: TaskImportRowIssue[];
}

export interface TaskImportValidationResult {
  total: number;
  ready: number;
  errors: number;
  warnings: number;
  rows: TaskImportValidationRow[];
}

// ─── Commit result ──────────────────────────────────────────────────────────────

export interface TaskImportRowResult {
  row: number;
  title: string;
  status: 'created' | 'failed';
  error?: string;
  task_id?: string; // created task id — lets the frontend attach matched files
  attachment_names?: string[]; // filenames this row asked to attach
}

export interface TaskImportResult {
  batch_id: string | null;
  created: number;
  failed: number;
  results: TaskImportRowResult[];
}

// ─── Undo + history ─────────────────────────────────────────────────────────────

export interface TaskUndoKeptRow {
  title: string;
  reason: string;
}

export interface TaskUndoImportResult {
  batch_id: string;
  undone: number;
  kept: TaskUndoKeptRow[];
  status: 'committed' | 'undone' | 'partially_undone';
}

export interface TaskImportBatchSummary {
  id: string;
  file_name: string | null;
  imported_by: string;
  total_rows: number;
  created_count: number;
  failed_count: number;
  remaining: number; // tasks from this batch still present
  status: 'committed' | 'undone' | 'partially_undone';
  can_undo: boolean;
  created_at: string;
  undone_at: string | null;
}

export interface TaskImportBatchDetailRow {
  row: number;
  title: string | null;
  status: 'created' | 'failed';
  error: string | null;
  still_present: boolean;
  data: Record<string, string>;
}

export interface TaskImportBatchDetail extends TaskImportBatchSummary {
  undo_summary: { undone: number; kept: TaskUndoKeptRow[] } | null;
  rows: TaskImportBatchDetailRow[];
  rows_reconstructed: boolean;
}
