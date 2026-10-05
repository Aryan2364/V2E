import { Module } from '@nestjs/common';
import { TaskMastersController } from './task-masters.controller';
import { TaskMastersService } from './task-masters.service';
import { ChecklistAccessService } from './checklist-access.service';
import { ChecklistImportService } from './checklist-import.service';
import { TaskTagsService } from './task-tags.service';

@Module({
  controllers: [TaskMastersController],
  providers: [TaskMastersService, ChecklistAccessService, ChecklistImportService, TaskTagsService],
  exports: [TaskMastersService, ChecklistAccessService, ChecklistImportService, TaskTagsService],
})
export class TaskMastersModule {}
