import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { GoalCadence, GoalFocusArea, GoalStatus } from '@prisma/client';

export class UpdateGoalDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsUUID()
  owner_user_id?: string;

  // Nullable: sending null clears the department.
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsUUID()
  department_id?: string | null;

  @IsOptional()
  @IsDateString()
  due_date?: string;

  // Nullable: sending null removes the target (and, in the service, the
  // recorded number with it — a value with no target means nothing).
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  target_value?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(30)
  unit?: string | null;

  // Nullable: sending null clears the focus area.
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsEnum(GoalFocusArea)
  focus_area?: GoalFocusArea | null;

  @IsOptional()
  @IsEnum(GoalStatus)
  status?: GoalStatus;

  @IsOptional()
  @IsEnum(GoalCadence)
  review_cadence?: GoalCadence;

  // When the next check-in is due. Sending it pins the date explicitly instead
  // of letting the service re-anchor off the last check-in.
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  next_review_date?: string | null;
}

export class DeleteGoalDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
