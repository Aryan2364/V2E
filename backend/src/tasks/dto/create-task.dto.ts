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
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CompletionMode, TaskQuadrant, TaskType } from '@prisma/client';
import { ReminderSpecDto } from '../../common/reminders/reminder-spec.dto';

class ChecklistItemDto {
  @IsString()
  title: string;

  @IsNumber()
  order_index: number;

  // Section label when the task carries multiple checklists (template + custom, etc.).
  @IsOptional()
  @IsString()
  group_title?: string;
}

export class CreateTaskDto {
  @IsString()
  @MaxLength(50)
  title: string;

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

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  assignee_user_ids?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  cc_user_ids?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChecklistItemDto)
  checklist_items?: ChecklistItemDto[];

  // When the checklist was applied from a template, its id — re-validated for access.
  @IsOptional()
  @IsString()
  checklist_template_id?: string;

  // When multiple template-sourced checklists are attached, every applied
  // template id — each re-validated for access alongside checklist_template_id.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  checklist_template_ids?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  escalation_user_ids?: string[];

  // Creator-set reminders. Undefined = legacy single default reminder;
  // [] = user explicitly cleared all; otherwise one+ specs.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReminderSpecDto)
  reminders?: ReminderSpecDto[];

  // Links this task as an initiative under a QUARTERLY goal.
  @IsOptional()
  @IsString()
  goal_id?: string;

  // Org-wide labels (TASK_TAGS_PLAN.md §4.3). Every id must be an ACTIVE tag of this
  // org — re-validated in the service by `assertTagsUsable`.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  tag_ids?: string[];
}
