import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// A single measurable "what done looks like" line.
export class CriterionInput {
  @IsString()
  @MaxLength(500)
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  target?: string;
}

export class CreateDelegationDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsString()
  @MaxLength(4000)
  outcome!: string;

  @IsUUID()
  owner_user_id!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  kra?: string;

  @IsOptional()
  @IsDateString()
  running_by?: string;

  @IsOptional()
  @IsDateString()
  first_check_in?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CriterionInput)
  criteria?: CriterionInput[];
}

// Full edit — the delegator can revise everything, including the criteria list
// (sent whole; the service replaces the set). Owner never edits.
export class UpdateDelegationDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  outcome?: string;

  @IsOptional()
  @IsUUID()
  owner_user_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  kra?: string;

  @IsOptional()
  @IsDateString()
  running_by?: string;

  @IsOptional()
  @IsDateString()
  first_check_in?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CriterionInput)
  criteria?: CriterionInput[];
}

export class ToggleCriterionDto {
  @IsBoolean()
  is_met!: boolean;
}
