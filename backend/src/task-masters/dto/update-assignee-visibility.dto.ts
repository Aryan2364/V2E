import { IsArray, IsObject, IsOptional, IsString } from 'class-validator';

export class UpdateAssigneeVisibilityDto {
  @IsOptional() @IsString() assignee_visibility_mode?: string;
  @IsOptional() @IsObject() assignee_custom_rules?: Record<string, unknown>;
  @IsOptional() @IsArray() @IsString({ each: true }) assignee_visibility_config_roles?: string[];
}
