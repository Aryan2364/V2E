import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** Body for the many "reason" style task actions (delete, reopen, incomplete, skip, ...). */
export class TaskReasonDto {
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}

/** Delete requires a reason, but the service owns the friendly error for a missing one. */
export class DeleteTaskDto {
  @IsOptional() @IsString() @MaxLength(2000) reason: string;
}

export class CompleteTaskDto {
  @IsOptional() @IsBoolean() close_whole_task?: boolean;
}

export class SetAssigneeStatusDto {
  @IsOptional() @IsString() user_id?: string;
  @IsString() status_id: string;
}

export class SetSharedStatusDto {
  @IsString() status_id: string;
}

export class ChallengeChecklistItemDto {
  @IsOptional() @IsString() user_id?: string;
}

export class BulkUpdateTasksDto {
  @IsArray() @ArrayMaxSize(1000) @IsString({ each: true }) task_ids: string[];
  @IsIn(['status', 'deadline', 'complete', 'add_tags', 'remove_tags'])
  action: 'status' | 'deadline' | 'complete' | 'add_tags' | 'remove_tags';
  @IsOptional() @IsString() status_id?: string;
  @IsOptional() @IsString() deadline?: string | null;
  @IsOptional() @IsArray() @IsString({ each: true }) tag_ids?: string[];
}
