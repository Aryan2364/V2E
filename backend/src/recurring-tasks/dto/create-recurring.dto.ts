import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsNumber } from 'class-validator';
import { CompletionMode, TaskQuadrant } from '@prisma/client';
import { CreateScheduleEntryDto } from './create-schedule-entry.dto';
import { ReminderSpecDto } from '../../common/reminders/reminder-spec.dto';
import { MAX_TAGS_PER_TASK } from '../../task-masters/task-tag.constants';

export class RecurringChecklistItemDto {
  @IsString()
  title: string;

  @IsNumber()
  order_index: number;

  @IsOptional()
  @IsString()
  group_title?: string;
}

export class CreateRecurringDto {
  @IsString()
  @MaxLength(50)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsEnum(TaskQuadrant)
  quadrant?: TaskQuadrant;

  @IsOptional()
  @IsString()
  category_id?: string;

  @IsOptional()
  @IsString()
  priority_id?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateScheduleEntryDto)
  schedule_entries: CreateScheduleEntryDto[];

  @IsOptional()
  @IsEnum(CompletionMode)
  completion_mode?: CompletionMode;

  @IsOptional()
  @IsBoolean()
  proof_required?: boolean;

  // Allowed proof file extensions (empty = any type); copied to every spawned instance.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  proof_allowed_extensions?: string[];

  // Ordered escalation contacts — level = position + 1 on each spawned instance.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  escalation_user_ids?: string[];

  // Links every spawned instance to a quarterly goal (initiative).
  @IsOptional()
  @IsString()
  linked_goal_id?: string;

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
  @Type(() => RecurringChecklistItemDto)
  checklist_items?: RecurringChecklistItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReminderSpecDto)
  reminders?: ReminderSpecDto[];

  @IsOptional()
  @IsString()
  department_id?: string;

  // Task tags copied onto every spawned instance (max MAX_TAGS_PER_TASK). Validated
  // by assertTagsUsable in the service: own-org ids only, newly added ones active.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(MAX_TAGS_PER_TASK)
  tag_ids?: string[];
}
