import 'reflect-metadata';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkflowTaskEventsService } from '../../workflows/workflow-task-events.service';
import { HolidaysService } from '../../holidays/holidays.service';
import { ProjectProgressService } from '../../projects/project-progress.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { AssigneeVisibilityService } from '../../assignee-visibility/assignee-visibility.service';
import { LeaveService } from '../../leave/leave.service';
import { ClockService } from '../../clock/clock.service';
import { SubjectEligibilityService } from '../../access-rights/subject-eligibility.service';
import { ScopeService } from '../../access-rights/scope.service';
import { AccessVisibilityService } from '../../access-rights/access-visibility.service';
import { ChecklistAccessService } from '../../task-masters/checklist-access.service';
import { R2Service } from '../../storage/r2.service';
import { WorkflowDiscussionService } from '../../workflows/workflow-discussion.service';
import { TasksAnalyticsService } from '../tasks-analytics.service';
import { TaskAccessService } from '../task-access.service';
import { TaskStatusService } from '../task-status.service';
import { TaskCommandService } from '../task-command.service';
import { TaskCreateService } from '../task-create.service';
import { TaskExportService } from '../task-export.service';
import { TaskReconcileService } from '../task-reconcile.service';
import { TaskDetailService } from '../task-detail.service';
import { TaskQueryService } from '../task-query.service';
import { TaskReportsService } from '../task-reports.service';
import { TaskBulkService } from '../task-bulk.service';
import { TaskCompletionService } from '../task-completion.service';
import { TaskNotificationsCron } from '../task-notifications.cron';
import { TaskCommentsService } from '../task-comments.service';
import { TaskChecklistService } from '../task-checklist.service';
import { TaskAssigneeService } from '../task-assignee.service';
import { TaskAssigneePreviewService } from '../task-assignee-preview.service';

/** The mockable leaf dependencies of the task services (the old TasksService constructor). */
export interface TaskServiceMocks {
  prisma?: any;
  workflowEngine?: any;
  holidays?: any;
  projectProgress?: any;
  notifications?: any;
  assigneeVisibility?: any;
  subjects?: any;
  scope?: any;
  leave?: any;
  clock?: any;
  checklistAccess?: any;
  visibility?: any;
  analytics?: any;
  r2?: any;
  discussion?: any;
}

const SERVICES = [
  TaskAccessService,
  TaskStatusService,
  TaskCommandService,
  TaskCreateService,
  TaskExportService,
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
];

/**
 * Test-only: wire the real task services together (constructor injection by design
 * metadata, leaf dependencies mocked) and return them plus a method-routing view, so a
 * spec can call `service.createTask(...)` without caring which service owns it.
 * Assigning a method on the view (e.g. `jest.spyOn(view, 'getTask')`) replaces it on the
 * owning instance, so collaborating services see the spy.
 */
export function buildTaskServices(mocks: TaskServiceMocks) {
  const leaf = new Map<unknown, unknown>([
    [PrismaService, mocks.prisma],
    [WorkflowTaskEventsService, mocks.workflowEngine ?? {}],
    [HolidaysService, mocks.holidays ?? {}],
    [ProjectProgressService, mocks.projectProgress ?? {}],
    [NotificationsService, mocks.notifications ?? {}],
    [AssigneeVisibilityService, mocks.assigneeVisibility ?? {}],
    [SubjectEligibilityService, mocks.subjects ?? {}],
    [ScopeService, mocks.scope ?? {}],
    [LeaveService, mocks.leave ?? {}],
    [ClockService, mocks.clock ?? {}],
    [ChecklistAccessService, mocks.checklistAccess ?? {}],
    [
      AccessVisibilityService,
      mocks.visibility ?? {
        registerCounter: () => undefined,
        whereForUser: () => undefined,
      },
    ],
    [TasksAnalyticsService, mocks.analytics ?? {}],
    [R2Service, mocks.r2 ?? {}],
    [WorkflowDiscussionService, mocks.discussion],
  ]);
  const built = new Map<any, any>();
  const resolve = (cls: any): any => {
    if (built.has(cls)) return built.get(cls);
    if (!SERVICES.includes(cls)) return leaf.get(cls);
    const types: any[] = Reflect.getMetadata('design:paramtypes', cls) ?? [];
    const inst = new cls(...types.map(resolve));
    built.set(cls, inst);
    return inst;
  };
  for (const cls of SERVICES) resolve(cls);
  const instances = [...built.values()];
  const ownerOf = (name: string | symbol) =>
    instances.find((i) => typeof i[name] === 'function');
  const view: any = new Proxy(
    {},
    {
      get: (_t, name) => {
        const owner = ownerOf(name);
        if (!owner) return undefined;
        const fn = owner[name];
        return fn._isMockFunction ? fn : fn.bind(owner);
      },
      set: (_t, name, value) => {
        const owner = ownerOf(name);
        if (owner) owner[name] = value;
        return true;
      },
    },
  );
  return { view, services: built as Map<any, any> };
}

/**
 * Test-only: construct a TasksController with `{}` for every task service the test does
 * not care about. Only the services a spec exercises are passed.
 */
export function buildTasksController(deps: {
  taskAccess?: any;
  importService?: any;
  attachments?: any;
  recurringService?: any;
  clock?: any;
}) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { TasksController } = require('../tasks.controller');
  const e = () => ({}) as any;
  return new TasksController(
    e(), // taskCommand
    e(), // taskCreate
    e(), // taskExport
    e(), // taskQuery
    e(), // taskAssigneePreview
    e(), // taskReports
    e(), // taskBulk
    e(), // taskDetail
    e(), // taskCompletion
    e(), // taskStatus
    deps.taskAccess ?? e(),
    e(), // taskComments
    e(), // taskChecklist
    e(), // taskAssignee
    deps.importService ?? e(),
    deps.attachments ?? e(),
    deps.recurringService ?? e(),
    deps.clock ?? e(),
  ) as import('../tasks.controller').TasksController;
}
