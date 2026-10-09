import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { TaskAttachmentsService } from './task-attachments.service';
import { Principal } from '../access-rights/permissions.service';

/**
 * Task object-level access (backend/AUTHORIZATION.md) for workflows v2:
 *  - escalation contacts (active TaskEscalation rows) may open the task;
 *  - for a workflow step task, everyone who may see that instance may open it (the
 *    workflow's editors and viewers, the person who ran it, everyone working in it);
 *  - comments and file uploads are gated by the same view rule;
 *  - everyone else still falls through to the data-scope check (fail closed).
 */

const ORG = 'org-1';
const principal = (userId: string): Principal => ({ userId, systemRoleId: null, isAdmin: false, isSuperAdmin: false });

interface World {
  task: { id: string; created_by_user_id: string; workflow_instance_step_id: string | null; assignees: { user_id: string; is_cc: boolean }[] };
  escalations: { task_id: string; escalate_to_user_id: string; is_active: boolean; organization_id: string }[];
  /** run row id → run id */
  rows: Record<string, string>;
  run: { id: string; triggered_by_user_id: string | null; template: { created_by_user_id: string; owner_user_ids: string[]; editors: string[]; viewers: string[] } };
  /** other tasks of the run (by id) with their live rosters */
  runTasks: { id: string; assignees: string[]; escalations: string[] }[];
}

function makeWorld(over: Partial<World> = {}): World {
  return {
    task: { id: 'task-1', created_by_user_id: 'u-creator', workflow_instance_step_id: null, assignees: [{ user_id: 'u-worker', is_cc: false }] },
    escalations: [],
    rows: { 'row-1': 'run-1', 'row-2': 'run-1' },
    run: { id: 'run-1', triggered_by_user_id: 'u-starter', template: { created_by_user_id: 'u-wf-creator', owner_user_ids: ['u-wf-owner'], editors: ['u-wf-editor'], viewers: ['u-wf-viewer'] } },
    runTasks: [],
    ...over,
  };
}

function makePrisma(w: World) {
  const prisma: any = {
    task: {
      findFirst: jest.fn(async ({ where }: any) => {
        // assertCanViewTask / findTaskOrFail / getTask lookups of THE task.
        if (where.id === w.task.id && where.organization_id === ORG) {
          return {
            ...w.task,
            title: 'File returns',
            organization_id: ORG,
            created_at: new Date('2026-01-01T00:00:00Z'),
            escalations: [],
            status: { type: 'in_progress' },
            tags: [],
          };
        }
        // isRunTaskParticipant: any run task the user is on?
        if (where.id?.in) {
          const userId = where.OR?.[0]?.assignees?.some?.user_id;
          const hit = w.runTasks.find(
            (t) => where.id.in.includes(t.id) && (t.assignees.includes(userId) || t.escalations.includes(userId)),
          );
          return hit ? { id: hit.id } : null;
        }
        return null;
      }),
    },
    taskEscalation: {
      findFirst: jest.fn(async ({ where }: any) =>
        w.escalations.find(
          (e) =>
            e.task_id === where.task_id &&
            e.organization_id === where.organization_id &&
            e.escalate_to_user_id === where.escalate_to_user_id &&
            e.is_active === where.is_active,
        )
          ? { id: 'esc' }
          : null,
      ),
    },
    workflowInstanceStep: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.organization_id === ORG && w.rows[where.id] ? { workflow_instance_id: w.rows[where.id] } : null,
      ),
      findMany: jest.fn(async () => w.runTasks.map((t) => ({ task_id: t.id }))),
    },
    workflowInstance: { findFirst: jest.fn() },
    taskComment: {
      create: jest.fn(async ({ data }: any) => ({ id: 'c-1', ...data })),
      findFirst: jest.fn(async () => null),
    },
    taskActivityLog: { create: jest.fn(async () => ({})) },
    user: { findUnique: jest.fn(async () => ({ id: 'u', name: 'Asha', email: 'a@x.test' })) },
  };
  // Editors: emulate the per-user `access` filter of isRunParticipant.
  prisma.workflowInstance.findFirst.mockImplementation(async (args: any) => {
    if (args.where.id !== w.run.id || args.where.organization_id !== ORG) return null;
    const asked = args.select?.template?.select?.access?.where?.user_id;
    return {
      triggered_by_user_id: w.run.triggered_by_user_id,
      template: {
        created_by_user_id: w.run.template.created_by_user_id,
        owner_user_ids: w.run.template.owner_user_ids,
        access: w.run.template.editors.includes(asked)
          ? [{ access_type: 'edit' }]
          : w.run.template.viewers.includes(asked)
            ? [{ access_type: 'view' }]
            : [],
      },
    };
  });
  return prisma;
}

function makeService(prisma: any, discussion?: any) {
  const scope = {
    registerWiredList: jest.fn(),
    listWhere: jest.fn(async () => ({})),
    assertCanActOn: jest.fn(async () => {
      throw new ForbiddenException('out of scope');
    }),
  };
  const notifications = { userName: jest.fn(async () => 'Asha'), emit: jest.fn(async () => undefined) };
  const service = new TasksService(
    prisma,
    {} as any, // workflowEngine
    {} as any, // holidays
    {} as any, // projectProgress
    notifications as any,
    {} as any, // assigneeVisibility
    {} as any, // subjects
    scope as any,
    {} as any, // leave
    { now: jest.fn(async () => new Date('2026-10-04T10:00:00Z')) } as any,
    {} as any, // checklistAccess
    { registerCounter: jest.fn(), whereForUser: jest.fn() } as any,
    {} as any, // analytics
    {} as any, // r2
    discussion,
  );
  return { service, scope, notifications };
}

describe('TasksService — view gate (assertCanViewTask)', () => {
  it('people on the task pass without any extra lookup', async () => {
    const w = makeWorld();
    const prisma = makePrisma(w);
    const { service, scope } = makeService(prisma);
    await service.assertCanViewTask(ORG, principal('u-worker'), 'task-1');
    await service.assertCanViewTask(ORG, principal('u-creator'), 'task-1');
    expect(prisma.taskEscalation.findFirst).not.toHaveBeenCalled();
    expect(scope.assertCanActOn).not.toHaveBeenCalled();
  });

  it('admits an ACTIVE escalation contact (the Escalated page can open the task)', async () => {
    const w = makeWorld({
      escalations: [
        { task_id: 'task-1', escalate_to_user_id: 'u-boss', is_active: true, organization_id: ORG },
        { task_id: 'task-1', escalate_to_user_id: 'u-old-boss', is_active: false, organization_id: ORG },
      ],
    });
    const { service, scope } = makeService(makePrisma(w));
    await expect(service.assertCanViewTask(ORG, principal('u-boss'), 'task-1')).resolves.toBeUndefined();
    expect(scope.assertCanActOn).not.toHaveBeenCalled();
    // An inactive escalation row grants nothing.
    await expect(service.assertCanViewTask(ORG, principal('u-old-boss'), 'task-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('admits everyone who may see the instance a step task belongs to (owners are retired)', async () => {
    const w = makeWorld({
      task: { id: 'task-1', created_by_user_id: 'u-creator', workflow_instance_step_id: 'row-1', assignees: [{ user_id: 'u-worker', is_cc: false }] },
      runTasks: [
        { id: 'task-1', assignees: ['u-worker'], escalations: [] },
        { id: 'task-2', assignees: ['u-other-step', 'u-cc-elsewhere'], escalations: ['u-esc-elsewhere'] },
      ],
    });
    for (const who of ['u-wf-creator', 'u-wf-editor', 'u-wf-viewer', 'u-starter', 'u-other-step', 'u-cc-elsewhere', 'u-esc-elsewhere']) {
      const { service, scope } = makeService(makePrisma(w));
      await expect(service.assertCanViewTask(ORG, principal(who), 'task-1')).resolves.toBeUndefined();
      expect(scope.assertCanActOn).not.toHaveBeenCalled();
    }
    // A legacy owner who is not an editor no longer gets in through the workflow.
    const { service } = makeService(makePrisma(w));
    await expect(service.assertCanViewTask(ORG, principal('u-wf-owner'), 'task-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('everyone else falls through to the data-scope check (fail closed)', async () => {
    const w = makeWorld({
      task: { id: 'task-1', created_by_user_id: 'u-creator', workflow_instance_step_id: 'row-1', assignees: [{ user_id: 'u-worker', is_cc: false }] },
      runTasks: [{ id: 'task-1', assignees: ['u-worker'], escalations: [] }],
    });
    const { service, scope } = makeService(makePrisma(w));
    await expect(service.assertCanViewTask(ORG, principal('u-stranger'), 'task-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(scope.assertCanActOn).toHaveBeenCalledWith(ORG, principal('u-stranger'), 'tasks.task.manage', 'read', [
      'u-creator',
      'u-worker',
    ]);
  });

  it('a workflow row of another org grants nothing', async () => {
    const w = makeWorld({
      task: { id: 'task-1', created_by_user_id: 'u-creator', workflow_instance_step_id: 'row-foreign', assignees: [] },
    });
    const { service } = makeService(makePrisma(w));
    await expect(service.assertCanViewTask(ORG, principal('u-wf-owner'), 'task-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('no principal = internal caller, no gate', async () => {
    const w = makeWorld();
    const prisma = makePrisma(w);
    const { service } = makeService(prisma);
    await service.assertCanViewTask(ORG, undefined, 'task-1');
    expect(prisma.task.findFirst).not.toHaveBeenCalled();
  });
});

describe('TasksService — addComment is gated by the view rule', () => {
  it('a stranger cannot comment; nothing is written', async () => {
    const w = makeWorld();
    const prisma = makePrisma(w);
    const { service } = makeService(prisma);
    await expect(
      service.addComment(ORG, 'u-stranger', 'task-1', { body: 'hi' } as any, principal('u-stranger')),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.taskComment.create).not.toHaveBeenCalled();
  });

  it('a run participant may comment (view + comment, not complete)', async () => {
    const w = makeWorld({
      task: { id: 'task-1', created_by_user_id: 'u-creator', workflow_instance_step_id: 'row-1', assignees: [{ user_id: 'u-worker', is_cc: false }] },
      runTasks: [{ id: 'task-2', assignees: ['u-next-step'], escalations: [] }],
    });
    const prisma = makePrisma(w);
    const { service } = makeService(prisma);
    await service.addComment(ORG, 'u-next-step', 'task-1', { body: 'Looks good' } as any, principal('u-next-step'));
    expect(prisma.taskComment.create).toHaveBeenCalledTimes(1);
  });

  it('a workflow step task comment joins the instance discussion: instance id stamped, discussion rules notify', async () => {
    const w = makeWorld({
      task: { id: 'task-1', created_by_user_id: 'u-creator', workflow_instance_step_id: 'row-1', assignees: [{ user_id: 'u-worker', is_cc: false }] },
    });
    const prisma = makePrisma(w);
    const discussion = {
      instanceIdForTask: jest.fn(async () => 'run-1'),
      notifyNewMessage: jest.fn(async () => undefined),
    };
    const { service, notifications } = makeService(prisma, discussion);
    await service.addComment(ORG, 'u-worker', 'task-1', { body: 'Done' } as any, principal('u-worker'));
    expect(discussion.instanceIdForTask).toHaveBeenCalledWith(ORG, 'task-1');
    expect(prisma.taskComment.create.mock.calls[0][0].data).toMatchObject({ task_id: 'task-1', workflow_instance_id: 'run-1', body: 'Done' });
    expect(discussion.notifyNewMessage).toHaveBeenCalledWith(ORG, 'c-1', { replyToAuthorId: null });
    // The task-only notification is not sent on top.
    expect(notifications.emit).not.toHaveBeenCalled();
  });

  it('an ordinary task comment stays a task comment (no instance, task notification)', async () => {
    const w = makeWorld();
    const prisma = makePrisma(w);
    const discussion = { instanceIdForTask: jest.fn(), notifyNewMessage: jest.fn() };
    const { service, notifications } = makeService(prisma, discussion);
    prisma.taskComment.findMany = jest.fn(async () => []);
    await service.addComment(ORG, 'u-worker', 'task-1', { body: 'Done' } as any, principal('u-worker'));
    expect(discussion.instanceIdForTask).not.toHaveBeenCalled();
    expect(prisma.taskComment.create.mock.calls[0][0].data.workflow_instance_id).toBeNull();
    expect(notifications.emit).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'task_comment', recipients: ['u-creator'] }));
  });

  it('a reply must answer a comment of the same task', async () => {
    const w = makeWorld();
    const prisma = makePrisma(w);
    const { service } = makeService(prisma);
    await expect(
      service.addComment(ORG, 'u-worker', 'task-1', { body: 'x', reply_to_comment_id: 'c-other-task' } as any, principal('u-worker')),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.taskComment.findFirst.mock.calls[0][0].where).toEqual({
      id: 'c-other-task',
      task_id: 'task-1',
      organization_id: ORG,
      is_deleted: false,
    });
    expect(prisma.taskComment.create).not.toHaveBeenCalled();
  });
});

describe('TasksController — uploads are gated by the view rule', () => {
  function makeController(gate: () => Promise<void>) {
    const service = { assertCanViewTask: jest.fn(gate) };
    const attachments = { upload: jest.fn(async () => ({ id: 'att' })) };
    const controller = new TasksController(service as any, {} as any, attachments as any, {} as any, {} as any);
    return { controller, service, attachments };
  }
  const req = { user: { id: 'u-x', is_admin: false } };
  const file = { originalname: 'a.pdf', mimetype: 'application/pdf', size: 3, buffer: Buffer.from('abc') };

  it('task and comment attachments check the task first and stop on denial', async () => {
    const denied = makeController(async () => {
      throw new ForbiddenException('no');
    });
    await expect(denied.controller.uploadTaskAttachment(ORG, req, 'task-1', file)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(denied.controller.uploadCommentAttachment(ORG, req, 'task-1', 'c-1', file)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(denied.attachments.upload).not.toHaveBeenCalled();

    const ok = makeController(async () => undefined);
    await ok.controller.uploadCommentAttachment(ORG, req, 'task-1', 'c-1', file);
    expect(ok.service.assertCanViewTask).toHaveBeenCalledWith(ORG, expect.objectContaining({ userId: 'u-x' }), 'task-1');
    expect(ok.attachments.upload).toHaveBeenCalledWith(ORG, 'u-x', 'task-1', file, 'c-1');
  });
});

describe('TaskAttachmentsService — comment files go on your own comment only', () => {
  it("403s a file added to someone else's comment", async () => {
    const prisma: any = {
      task: { findFirst: jest.fn(async () => ({ id: 'task-1', created_at: new Date('2026-01-01T00:00:00Z') })) },
      taskComment: { findFirst: jest.fn(async () => ({ id: 'c-1', user_id: 'u-author' })) },
      taskAttachment: { create: jest.fn() },
    };
    const r2 = { putObject: jest.fn(), deleteObject: jest.fn() };
    const svc = new TaskAttachmentsService(prisma, r2 as any, {} as any, {
      now: jest.fn(async () => new Date('2026-10-04T10:00:00Z')),
    } as any);
    const file = { originalname: 'a.pdf', mimetype: 'application/pdf', size: 3, buffer: Buffer.from('abc') };
    await expect(svc.upload(ORG, 'u-other', 'task-1', file, 'c-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.taskComment.findFirst.mock.calls[0][0].where).toEqual({
      id: 'c-1',
      organization_id: ORG,
      task_id: 'task-1',
      is_deleted: false,
    });
    expect(r2.putObject).not.toHaveBeenCalled();
  });
});
