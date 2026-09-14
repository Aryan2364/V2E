import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CompletionMode, TaskQuadrant } from '@prisma/client';
import { CreateScheduleEntryDto } from './create-schedule-entry.dto';
import { RecurringChecklistItemDto } from './create-recurring.dto';
import { ReminderSpecDto } from '../../common/reminders/reminder-spec.dto';

/**
 * How far an edit reaches — the edit-side twin of the three delete modes
 * (`stop` / `delete-future` / `delete-all`). A recurring template is a factory, so a
 * change to it is ambiguous by default: does it only shape the copies the scheduler
 * makes from now on, or does it also move the work already sitting in people's lists?
 * The caller must say, and the answer is asked for on every edit rather than guessed.
 *
 *   future_only     — today's behaviour, and the default when the field is absent:
 *                     only instances spawned from now on carry the change.
 *   future_and_open — additionally re-rosters every already-spawned instance that is
 *                     still open (non-terminal, not deleted). ONLY the assignee/CC
 *                     roster travels; title/description/schedule stay with the template.
 */
export enum RecurringEditScope {
  future_only = 'future_only',
  future_and_open = 'future_and_open',
}

export class UpdateRecurringDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  title?: string;

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

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateScheduleEntryDto)
  schedule_entries?: CreateScheduleEntryDto[];

  @IsOptional()
  @IsEnum(CompletionMode)
  completion_mode?: CompletionMode;

  @IsOptional()
  @IsBoolean()
  proof_required?: boolean;

  // Allowed proof file extensions (empty = any type); applies to future instances.
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

  // Links every future instance to a quarterly goal. Empty string clears the link.
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

  // Full replacement of the template's checklist definition (future instances only).
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecurringChecklistItemDto)
  checklist_items?: RecurringChecklistItemDto[];

  // Full replacement of the template's reminder specs (future instances only).
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReminderSpecDto)
  reminders?: ReminderSpecDto[];

  @IsOptional()
  @IsString()
  department_id?: string;

  // How far the assignee/CC change reaches: future instances only (default), or also
  // every already-spawned instance that is still open. See RecurringEditScope above.
  @IsOptional()
  @IsEnum(RecurringEditScope)
  apply_to?: RecurringEditScope;
}
