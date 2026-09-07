import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { GoalCadence, GoalFocusArea, GoalStatus } from '@prisma/client';

export class CreateGoalDto {
  @IsString()
  @MaxLength(300)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  /** The single accountable person. Accountability, not access. */
  @IsUUID()
  owner_user_id!: string;

  @IsOptional()
  @IsUUID()
  department_id?: string;

  /** Which part of the business this goal moves (Balanced-Scorecard perspective). */
  @IsOptional()
  @IsEnum(GoalFocusArea)
  focus_area?: GoalFocusArea;

  @IsDateString()
  due_date!: string;

  // Optional target. A goal with no target is normal — its check-in is just
  // the traffic light and the note.
  @IsOptional()
  @IsNumber()
  target_value?: number;

  /** Seeds the starting number. After creation only check-ins write this. */
  @IsOptional()
  @IsNumber()
  current_value?: number;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  unit?: string;

  @IsOptional()
  @IsEnum(GoalStatus)
  status?: GoalStatus;

  @IsOptional()
  @IsEnum(GoalCadence)
  review_cadence?: GoalCadence;

  /**
   * When the FIRST check-in is due. Without this a rhythm silently anchors to
   * "one interval from whenever the goal was created", which nobody can see or
   * choose. Ignored when the cadence is `none`.
   */
  @IsOptional()
  @IsDateString()
  first_check_in_date?: string;
}
