import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OrgScopeGuard } from '../common/guards/org-scope.guard';
import { principalFromUser } from '../access-rights/permissions.service';
import { DelegationService } from './delegation.service';
import {
  CreateDelegationDto,
  UpdateDelegationDto,
  ToggleCriterionDto,
} from './dto/delegation.dto';

// Path segment `delegations` maps to the `delegation` entitlement in OrgScopeGuard,
// so the whole controller is dark unless the org has the module turned on. There is
// no permission leaf — object-level auth (creator/owner/admin) lives in the service.
@ApiTags('delegations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgScopeGuard)
@Controller('api/v1/org/:orgId/delegations')
export class DelegationController {
  constructor(private readonly service: DelegationService) {}

  @Get()
  @ApiOperation({ summary: 'List delegations (view = mine | incoming | all)' })
  list(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Query('view') view?: 'mine' | 'incoming' | 'all',
  ) {
    return this.service.list(orgId, principalFromUser(req.user), view ?? 'all');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one delegation' })
  getOne(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: any) {
    return this.service.getOne(orgId, id, principalFromUser(req.user));
  }

  @Post()
  @ApiOperation({ summary: 'Create a delegation (spawns the delegator review task)' })
  create(@Param('orgId') orgId: string, @Request() req: any, @Body() dto: CreateDelegationDto) {
    return this.service.create(orgId, principalFromUser(req.user), dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a delegation (delegator/admin)' })
  update(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Request() req: any,
    @Body() dto: UpdateDelegationDto,
  ) {
    return this.service.update(orgId, id, principalFromUser(req.user), dto);
  }

  @Post(':id/complete')
  @ApiOperation({ summary: 'Mark a delegation completed (delegator/admin)' })
  complete(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: any) {
    return this.service.complete(orgId, id, principalFromUser(req.user));
  }

  @Patch(':id/criteria/:criterionId')
  @ApiOperation({ summary: 'Tick/untick a success criterion (delegator/owner/admin)' })
  toggleCriterion(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Param('criterionId') criterionId: string,
    @Request() req: any,
    @Body() dto: ToggleCriterionDto,
  ) {
    return this.service.toggleCriterion(orgId, id, criterionId, principalFromUser(req.user), dto.is_met);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a delegation (delegator/admin)' })
  remove(@Param('orgId') orgId: string, @Param('id') id: string, @Request() req: any) {
    return this.service.remove(orgId, id, principalFromUser(req.user));
  }
}
