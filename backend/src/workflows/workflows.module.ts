import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { HolidaysModule } from '../holidays/holidays.module'
import { TaskMastersModule } from '../task-masters/task-masters.module'
import { WorkflowTemplateService } from './workflow-template.service'
import { WorkflowTemplateController } from './workflow-template.controller'
import { WorkflowEngineService } from './workflow-engine.service'
import { WorkflowFilesService } from './workflow-files.service'
import { WorkflowDiscussionService } from './workflow-discussion.service'

/**
 * Workflows. How a workflow starts is data on the template: "Manually" (a flag + the
 * people who may start it) and "On a schedule" (WorkflowScheduleEntry rows, fired by
 * WorkflowEngineService.processSchedules every 15 minutes + replay).
 */
@Module({
  imports: [PrismaModule, HolidaysModule, TaskMastersModule],
  controllers: [WorkflowTemplateController],
  providers: [WorkflowTemplateService, WorkflowEngineService, WorkflowFilesService, WorkflowDiscussionService],
  exports: [WorkflowEngineService, WorkflowDiscussionService],
})
export class WorkflowsModule {}
