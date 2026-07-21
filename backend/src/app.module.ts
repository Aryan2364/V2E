import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulerModule } from './scheduler/scheduler.module';
import { PrismaModule } from './prisma/prisma.module';
import { EncryptionModule } from './common/encryption/encryption.module';
import { StorageModule } from './storage/storage.module';
import { MailModule } from './mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { UsersModule } from './users/users.module';
import { OrgIdentityModule } from './org-identity/org-identity.module';
import { CultureModule } from './culture/culture.module';
import { DepartmentsModule } from './departments/departments.module';
import { RolesModule } from './roles/roles.module';
import { EmployeesModule } from './employees/employees.module';
import { LearningModule } from './learning/learning.module';
import { EcsModule } from './ecs/ecs.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { BulletinModule } from './bulletin/bulletin.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { MessagingModule } from './messaging/messaging.module';
import { GroupsModule } from './groups/groups.module';
import { TasksModule } from './tasks/tasks.module';
import { TaskMastersModule } from './task-masters/task-masters.module';
import { RecurringTasksModule } from './recurring-tasks/recurring-tasks.module';
import { WorkflowsModule } from './workflows/workflows.module';
import { TicketsModule } from './tickets/tickets.module';
import { HolidaysModule } from './holidays/holidays.module';
import { ProjectsModule } from './projects/projects.module';
import { ClockModule } from './clock/clock.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AssigneeVisibilityModule } from './assignee-visibility/assignee-visibility.module';
import { LeaveModule } from './leave/leave.module';
import { AuditModule } from './audit/audit.module';
import { AuditClsModule } from './common/cls/audit-cls.module';
import { AccessRightsModule } from './access-rights/access-rights.module';
import { GoalsModule } from './goals/goals.module';
import { MeetingsModule } from './meetings/meetings.module';
import { WorkLogsModule } from './work-logs/work-logs.module';
import { ProcessHierarchyModule } from './process-hierarchy/process-hierarchy.module';
import { DelegationModule } from './delegation/delegation.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    AuditClsModule,
    PrismaModule,
    EncryptionModule,
    StorageModule,
    MailModule,
    SchedulerModule,
    ClockModule,
    NotificationsModule,
    AssigneeVisibilityModule,
    LeaveModule,
    AuditModule,
    AccessRightsModule,
    GoalsModule,
    MeetingsModule,
    WorkLogsModule,
    AuthModule,
    GroupsModule,
    OrganizationsModule,
    UsersModule,
    OrgIdentityModule,
    CultureModule,
    DepartmentsModule,
    RolesModule,
    EmployeesModule,
    LearningModule,
    AnnouncementsModule,
    BulletinModule,
    KnowledgeModule,
    MessagingModule,
    RecurringTasksModule,
    TasksModule,
    TaskMastersModule,
    WorkflowsModule,
    TicketsModule,
    HolidaysModule,
    ProjectsModule,
    EcsModule,
    ProcessHierarchyModule,
    DelegationModule,
  ],
})
export class AppModule {}
