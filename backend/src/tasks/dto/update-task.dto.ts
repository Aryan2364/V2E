import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CompletionMode, TaskQuadrant, TaskType } from '@prisma/client';

// One checklist item in an edit payload. `id` is present for an item that already
// exists on the task — the backend matches on it to preserve that item's per-person
// progress (ticks/skips). Absent id = a brand-new item.
class UpdateChecklistItemDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  title: string;

  @IsNumber()
  order_index: number;

  @IsOptional()
  @IsString()
  group_title?: string;
}

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  category_id?: string;

  @IsOptional()
  @IsString()
  priority_id?: string;

  @IsOptional()
  @IsString()
  status_id?: string;

  @IsOptional()
  @IsEnum(TaskQuadrant)
  quadrant?: TaskQuadrant;

  @IsOptional()
  @IsEnum(TaskType)
  type?: TaskType;

  @IsOptional()
  @IsString()
  department_id?: string;

  @IsOptional()
  @IsEnum(CompletionMode)
  completion_mode?: CompletionMode;

  @IsOptional()
  @IsBoolean()
  proof_required?: boolean;

  // Restrict proof uploads to these file extensions (lowercase, no dot). Empty = any.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  proof_allowed_extensions?: string[];

  @IsOptional()
  @IsDateString()
  deadline?: string;

  // The user saw the "deadline falls on a holiday / non-working day" warning and
  // explicitly chose to keep the date — the system never forces the holiday rule.
  @IsOptional()
  @IsBoolean()
  holiday_override?: boolean;

  // Optional note explaining WHY the deadline moved, stored on the revision record.
  // Deliberately not mandatory: the reports grade against `Task.original_deadline`,
  // so a revision can't buy a clean scorecard and a forced justification box would be
  // friction with no integrity benefit. Ignored unless `deadline` actually changes.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  deadline_reason?: string;

  // The task's full, authoritative WORKING roster (non-CC). When present the backend
  // reconciles to match it: people added are created (or, if previously removed,
  // revived with their prior state intact), people missing are SOFT-removed, and
  // anyone moving between this list and `cc_user_ids` is flipped in place — never
  // deleted and recreated, which would destroy their status and completion progress.
  // Omit the field to leave the roster untouched. An empty array is rejected: a task
  // must always have someone doing the work.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  assignee_user_ids?: string[];

  // The task's full, authoritative CC roster, reconciled exactly like the above.
  // An empty array is valid — a task with no observers is fine.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  cc_user_ids?: string[];

  // Re-link (or unlink) this task to a quarterly goal.
  @IsOptional()
  @IsString()
  goal_id?: string;

  // Full, authoritative checklist for the task. When present, the backend reconciles
  // the existing checklist to match: items keyed by `id` are kept (title/order/group
  // updated in place, per-person progress preserved), items whose id disappears are
  // deleted, and items without an id are created fresh. An empty array clears it.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateChecklistItemDto)
  checklist_items?: UpdateChecklistItemDto[];

  // Template ids newly applied in this edit — re-validated for access, mirroring create.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  checklist_template_ids?: string[];
}
