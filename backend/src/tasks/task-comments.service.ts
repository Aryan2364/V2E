import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ClockService } from '../clock/clock.service';
import { Principal } from '../access-rights/permissions.service';
import { WorkflowDiscussionService } from '../workflows/workflow-discussion.service';
import { R2Service } from '../storage/r2.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { swallow } from '../common/swallow';
import { TaskAccessService } from './task-access.service';

/** Task comments and the activity log. */
@Injectable()
export class TaskCommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly clock: ClockService,
    private readonly r2: R2Service,
    private readonly taskAccess: TaskAccessService,
    @Optional() private readonly discussion?: WorkflowDiscussionService,
  ) {}

  async getActivityLog(orgId: string, taskId: string, principal?: Principal) {
    await this.taskAccess.findTaskOrFail(orgId, taskId);
    await this.taskAccess.assertCanViewTask(orgId, principal, taskId);
    const logs = await this.prisma.taskActivityLog.findMany({
      where: { task_id: taskId, organization_id: orgId },
      orderBy: { created_at: 'desc' },
    });

    const userIds = [...new Set(logs.map((l) => l.performed_by_user_id))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));
    return logs.map((l) => ({
      ...l,
      performed_by: userMap.get(l.performed_by_user_id) ?? null,
    }));
  }

  // ─── Comments ────────────────────────────────────────────────────────────────

  async getComments(orgId: string, taskId: string, principal?: Principal) {
    await this.taskAccess.findTaskOrFail(orgId, taskId);
    await this.taskAccess.assertCanViewTask(orgId, principal, taskId);
    const attachmentSelect = {
      where: { is_deleted: false },
      // uploaded_by_user_id + is_proof let the UI show a "Mark as proof" action on the
      // author's own comment files (and hide it once already promoted).
      select: {
        id: true,
        file_name: true,
        mime_type: true,
        size_bytes: true,
        created_at: true,
        uploaded_by_user_id: true,
        is_proof: true,
      },
      orderBy: { created_at: 'asc' as const },
    };
    const comments = await this.prisma.taskComment.findMany({
      where: {
        task_id: taskId,
        organization_id: orgId,
        is_deleted: false,
        reply_to_comment_id: null,
      },
      include: {
        attachments: attachmentSelect,
        replies: {
          where: { is_deleted: false, task_id: taskId },
          orderBy: { created_at: 'asc' },
          include: { attachments: attachmentSelect },
        },
      },
      orderBy: { created_at: 'asc' },
    });

    const allUserIds = new Set<string>();
    for (const c of comments) {
      allUserIds.add(c.user_id);
      for (const r of c.replies) allUserIds.add(r.user_id);
    }
    const users = await this.prisma.user.findMany({
      where: { id: { in: Array.from(allUserIds) } },
      select: { id: true, name: true, email: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    return comments.map((c) => {
      const u = userMap.get(c.user_id);
      return {
        ...c,
        user_name: u?.name ?? null,
        user_email: u?.email ?? null,
        user: u ?? null,
        replies: c.replies.map((r) => {
          const ru = userMap.get(r.user_id);
          return {
            ...r,
            user_name: ru?.name ?? null,
            user_email: ru?.email ?? null,
            user: ru ?? null,
          };
        }),
      };
    });
  }

  /**
   * Post a comment. The HTTP route passes the caller's principal so the comment is
   * gated by `assertCanViewTask` (anyone who may read the task — including workflow
   * run participants and escalation contacts — may discuss it; nobody else).
   */

  /** Everyone who has already commented on this task (live comments). */
  async priorCommenterIds(orgId: string, taskId: string): Promise<string[]> {
    const rows = await this.prisma.taskComment.findMany({
      where: { task_id: taskId, organization_id: orgId, is_deleted: false },
      select: { user_id: true },
      distinct: ['user_id'],
    });
    return rows.map((r) => r.user_id);
  }

  async addComment(
    orgId: string,
    userId: string,
    taskId: string,
    dto: CreateCommentDto,
    principal?: Principal,
  ) {
    const task = await this.taskAccess.findTaskOrFail(orgId, taskId, true);
    await this.taskAccess.assertCanViewTask(orgId, principal, taskId);
    // A reply must answer a live comment of THIS task (never another task's thread).
    let replyToAuthorId: string | null = null;
    if (dto.reply_to_comment_id) {
      const parent = await this.prisma.taskComment.findFirst({
        where: {
          id: dto.reply_to_comment_id,
          task_id: taskId,
          organization_id: orgId,
          is_deleted: false,
        },
        select: { id: true, user_id: true },
      });
      if (!parent)
        throw new NotFoundException(
          'The comment you are replying to was not found on this task.',
        );
      replyToAuthorId = parent.user_id;
    }
    // A workflow step task's comments are messages of its instance's ONE discussion.
    const instanceId =
      task.workflow_instance_step_id && this.discussion
        ? await this.discussion
            .instanceIdForTask(orgId, taskId)
            .catch(swallow('tasks.addComment', null))
        : null;
    // Stamp with the org's clock (respects a test org's simulated time) rather than
    // the DB's real-time default, so comments read in the timeline the user is in.
    const now = await this.clock.now(orgId);
    const comment = await this.prisma.taskComment.create({
      data: {
        organization_id: orgId,
        task_id: taskId,
        workflow_instance_id: instanceId,
        user_id: userId,
        body: dto.body,
        reply_to_comment_id: dto.reply_to_comment_id,
        attachment_urls: dto.attachment_urls as any,
        created_at: now,
      },
    });
    await this.taskAccess.logActivity(orgId, taskId, userId, 'comment_added', {
      comment_id: comment.id,
    });
    // Post-commit enrichment read — the comment already exists, so degrade to a
    // nameless response rather than failing the whole request on a transient.
    const user = await this.prisma.user
      .findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true },
      })
      .catch(swallow('tasks.addComment', null));

    // Workflow step task: the discussion's rules decide who hears (step people, people
    // already in the discussion, the replied-to author, send-back counterparts).
    if (instanceId && this.discussion) {
      await this.discussion.notifyNewMessage(orgId, comment.id, {
        replyToAuthorId,
      });
      return {
        ...comment,
        user_name: user?.name ?? null,
        user_email: user?.email ?? null,
        user: user ?? null,
      };
    }

    // Notify everyone in the conversation except the commenter: the task's people
    // (assignees + CC + creator), anyone who has already commented here and the author
    // of the comment being replied to. Lead with WHO commented; show the comment, then the task.
    // A file-only comment (no text yet) reads as an attachment rather than a blank line.
    const trimmed = (dto.body ?? '').trim();
    const snippet =
      trimmed.length > 100 ? `${trimmed.slice(0, 100)}…` : trimmed;
    const payload = snippet ? `“${snippet}”` : 'Shared an attachment';
    // Extra recipients are best-effort: a failed lookup must never fail the comment.
    const priorCommenters = await this.priorCommenterIds(orgId, taskId).catch(
      () => [] as string[],
    );
    await this.notifications.emit({
      orgId,
      module: 'tasks',
      event_type: 'task_comment',
      recipients: Array.from(
        new Set([
          task.created_by_user_id,
          ...(task.assignees ?? []).map((a: any) => a.user_id),
          ...priorCommenters,
          ...(replyToAuthorId ? [replyToAuthorId] : []),
        ]),
      ).filter((uid) => !!uid && uid !== userId),
      title: `${user?.name ?? 'Someone'} commented`,
      body: `${payload}\non “${task.title}”`,
      // Lock-screen text names the event + task title only, never the comment
      // text (FRONTEND_RULES_PHONE.md §41.12 rule 3; plan D12/§6.4).
      pushBody: `${user?.name ?? 'Someone'} commented on “${task.title}”`,
      link: `/dashboard/tasks/${taskId}`,
      entity: { type: 'task', id: taskId },
    });

    return {
      ...comment,
      user_name: user?.name ?? null,
      user_email: user?.email ?? null,
      user: user ?? null,
    };
  }

  async deleteComment(orgId: string, userId: string, commentId: string) {
    const comment = await this.prisma.taskComment.findFirst({
      where: { id: commentId, organization_id: orgId },
    });
    // Messages written on a workflow instance page (no task) are removed through the
    // instance discussion, never here.
    if (!comment || !comment.task_id)
      throw new NotFoundException('Comment not found');
    await this.taskAccess.findTaskOrFail(orgId, comment.task_id, true);
    if (comment.user_id !== userId)
      throw new ForbiddenException("Cannot delete another user's comment");

    await this.prisma.taskComment.update({
      where: { id: commentId },
      data: { is_deleted: true, deleted_at: new Date() },
    });

    // Deleting a comment removes its files too — otherwise a file shared (and possibly
    // marked as proof) in that comment would linger in the attachments/proofs list and
    // keep counting toward the proof gate. Soft-delete the rows, then purge from R2.
    const orphaned = await this.prisma.taskAttachment.findMany({
      where: {
        comment_id: commentId,
        organization_id: orgId,
        is_deleted: false,
      },
      select: { id: true, storage_key: true },
    });
    if (orphaned.length) {
      await this.prisma.taskAttachment.updateMany({
        where: {
          comment_id: commentId,
          organization_id: orgId,
          is_deleted: false,
        },
        data: { is_deleted: true, deleted_at: new Date() },
      });
      // Best-effort file purge — never fail the delete on a storage hiccup.
      await Promise.all(
        orphaned.map((a) =>
          this.r2
            .deleteObject(a.storage_key)
            .catch(swallow('tasks.deleteComment')),
        ),
      );
    }

    await this.taskAccess.logActivity(
      orgId,
      comment.task_id,
      userId,
      'comment_deleted',
      { comment_id: commentId },
    );
    return { message: 'Comment deleted' };
  }

}
