import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TaskQueryService } from './task-query.service';

@ApiTags('tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/my-tasks')
export class TasksCollectiveController {
  constructor(
    private readonly taskQuery: TaskQueryService,
  ) {}

  @Get('collective')
  @ApiOperation({ summary: 'Get tasks from all organizations the user belongs to' })
  getCollective(@Request() req: any) {
    return this.taskQuery.getCollectiveTasks(req.user.id);
  }
}
