import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksCollectiveController } from './tasks-collective.controller';
import { PersonScorecardController } from './person-scorecard.controller';
import { TaskAgeingController } from './task-ageing.controller';
import { TaskCalendarController } from './task-calendar.controller';
import { TaskAccessService } from './task-access.service';
import { TaskStatusService } from './task-status.service';
import { TaskCommandService } from './task-command.service';
import { TaskReconcileService } from './task-reconcile.service';
import { TaskDetailService } from './task-detail.service';
import { TaskQueryService } from './task-query.service';
import { TaskReportsService } from './task-reports.service';
import { TaskBulkService } from './task-bulk.service';
import { TaskCompletionService } from './task-completion.service';
import { TaskNotificationsCron } from './task-notifications.cron';
import { TaskCommentsService } from './task-comments.service';
import { TaskChecklistService } from './task-checklist.service';
import { TaskAssigneeService } from './task-assignee.service';
import { TaskAssigneePreviewService } from './task-assignee-preview.service';
import { PersonScorecardService } from './person-scorecard.service';
import { TaskAgeingService } from './task-ageing.service';
import { TaskCalendarService } from './task-calendar.service';
import { TasksAnalyticsService } from './tasks-analytics.service';
import { TaskAttachmentsService } from './task-attachments.service';
import { TaskImportService } from './task-import.service';
import { WorkflowsModule } from '../workflows/workflows.module';
import { HolidaysModule } from '../holidays/holidays.module';
import { ProjectsModule } from '../projects/projects.module';
import { TaskMastersModule } from '../task-masters/task-masters.module';
import { RecurringTasksModule } from '../recurring-tasks/recurring-tasks.module';

@Module({
  imports: [
    WorkflowsModule,
    HolidaysModule,
    ProjectsModule,
    TaskMastersModule,
    RecurringTasksModule,
  ],
  controllers: [
    TasksController,
    TasksCollectiveController,
    PersonScorecardController,
    TaskAgeingController,
    TaskCalendarController,
  ],
  providers: [
    TaskAccessService,
    TaskStatusService,
    TaskCommandService,
    TaskReconcileService,
    TaskDetailService,
    TaskQueryService,
    TaskReportsService,
    TaskBulkService,
    TaskCompletionService,
    TaskNotificationsCron,
    TaskCommentsService,
    TaskChecklistService,
    TaskAssigneeService,
    TaskAssigneePreviewService,
    TasksAnalyticsService,
    TaskAttachmentsService,
    TaskImportService,
    PersonScorecardService,
    TaskAgeingService,
    TaskCalendarService,
  ],
  exports: [
    TaskAccessService,
    TaskCommandService,
    TaskDetailService,
    TasksAnalyticsService,
    TaskAttachmentsService,
  ],
})
export class TasksModule {}
