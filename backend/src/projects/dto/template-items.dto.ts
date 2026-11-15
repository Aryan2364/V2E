import { Type } from 'class-transformer';
import { IsArray, IsInt, IsNumber, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export class AddTemplateMilestoneDto {
  @IsString() @MaxLength(300) name: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsInt() order_index?: number;
}

export class UpdateTemplateMilestoneDto {
  @IsOptional() @IsString() @MaxLength(300) name?: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsInt() order_index?: number;
}

export class TemplateChecklistItemDto {
  @IsString() @MaxLength(500) title: string;
}

export class AddTemplateTaskDto {
  @IsString() @MaxLength(500) title: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsString() priority_id?: string;
  @IsOptional() @IsString() milestone_id?: string;
  @IsOptional() @IsNumber() estimated_days?: number;
  @IsOptional() @IsString() default_assignee_user_id?: string;
  @IsOptional() @IsString() @MaxLength(200) default_assignee_role?: string;
  @IsOptional() @IsInt() order_index?: number;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TemplateChecklistItemDto)
  checklist_items?: TemplateChecklistItemDto[];
}

export class UpdateTemplateTaskDto {
  @IsOptional() @IsString() @MaxLength(500) title?: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsString() priority_id?: string;
  @IsOptional() @IsString() milestone_id?: string;
  @IsOptional() @IsNumber() estimated_days?: number;
  @IsOptional() @IsString() default_assignee_user_id?: string;
  @IsOptional() @IsString() @MaxLength(200) default_assignee_role?: string;
  @IsOptional() @IsInt() order_index?: number;
}
