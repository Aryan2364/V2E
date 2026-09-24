import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PartialType } from '@nestjs/swagger';
import { CreateOrganizationDto } from './create-organization.dto';

export enum OrgStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  PENDING_SETUP = 'pending_setup',
}

export class UpdateOrganizationDto extends PartialType(CreateOrganizationDto) {
  @ApiPropertyOptional({ enum: OrgStatus })
  @IsEnum(OrgStatus)
  @IsOptional()
  status?: OrgStatus;
}
