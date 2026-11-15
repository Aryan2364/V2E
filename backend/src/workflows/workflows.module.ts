import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { HolidaysModule } from '../holidays/holidays.module'
import { TaskMastersModule } from '../task-masters/task-masters.module'
import { WorkflowTemplateController } from './workflow-template.controller'
import { WorkflowAccessService } from './workflow-access.service'
import { WorkflowTemplateViewService } from './workflow-template-view.service'
import { WorkflowTimelineService } from './workflow-timeline.service'
import { WorkflowDefinitionService } from './workflow-definition.service'
import { WorkflowLifecycleService } from './workflow-lifecycle.service'
import { WorkflowInstanceQueryService } from './workflow-instance-query.service'
import { WorkflowInstanceCollabService } from './workflow-instance-collab.service'
import { WorkflowInstanceActionService } from './workflow-instance-action.service'
import { WorkflowEngineService } from './workflow-engine.service'
import { WorkflowEngineSupportService } from './workflow-engine-support.service'
import { WorkflowEngineRowsService } from './workflow-engine-rows.service'
import { WorkflowRunActionsService } from './workflow-run-actions.service'
import { WorkflowTaskEventsService } from './workflow-task-events.service'
import { WorkflowSweepsService } from './workflow-sweeps.service'
import { WorkflowFilesService } from './workflow-files.service'
import { WorkflowDiscussionService } from './workflow-discussion.service'

/**
 * Workflows. How a workflow starts is data on the template: "Manually" (a flag + the
 * people who may start it) and "On a schedule" (WorkflowScheduleEntry rows, fired by
 * WorkflowSweepsService.processSchedules every 15 minutes + replay).
 */
@Module({
  imports: [PrismaModule, HolidaysModule, TaskMastersModule],
  controllers: [WorkflowTemplateController],
  providers: [
    WorkflowAccessService,
    WorkflowTemplateViewService,
    WorkflowTimelineService,
    WorkflowDefinitionService,
    WorkflowLifecycleService,
    WorkflowInstanceQueryService,
    WorkflowInstanceCollabService,
    WorkflowInstanceActionService,
    WorkflowEngineSupportService,
    WorkflowEngineRowsService,
    WorkflowEngineService,
    WorkflowRunActionsService,
    WorkflowTaskEventsService,
    WorkflowSweepsService,
    WorkflowFilesService,
    WorkflowDiscussionService,
  ],
  exports: [WorkflowEngineService, WorkflowEngineSupportService, WorkflowTaskEventsService, WorkflowSweepsService, WorkflowDiscussionService],
})
export class WorkflowsModule {}
