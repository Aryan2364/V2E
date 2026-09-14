import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProofVisibility } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { R2Service } from '../storage/r2.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ClockService } from '../clock/clock.service';
import { isTerminal } from './status-phase';
import { ACTIVE_ASSIGNEE } from './active-assignee';

/** 25 MB cap, matching the product decision for document attachments. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/**
 * Allowed file types (documents, images, archives + common video/audio), keyed
 * by lowercase extension. We validate on extension
 * (reliable across browsers) and keep the browser-provided MIME for display/download.
 */
export const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'txt',
  'csv',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'zip',
  'mp4',
  'webm',
  'mov',
  'mp3',
]);

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * A file counts as "live" only if it isn't tied to a soft-deleted comment — deleting a
 * comment takes its files with it. Task-level files (comment_id null) always qualify.
 * Applied defensively so an orphan (e.g. a comment deleted before the delete-cascade
 * existed) can never surface in a list, download, or the proof gate.
 */
const LIVE_PARENT_COMMENT: Prisma.TaskAttachmentWhereInput = {
  OR: [{ comment_id: null }, { comment: { is_deleted: false } }],
};

/** Lowercase file extension (no dot), or '' when none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Shared size/type validation for document attachments (tasks + recurring templates). */
export function validateAttachmentFile(file: UploadedFile | undefined): void {
  if (!file) throw new BadRequestException('No file was provided.');
  if (file.size <= 0) throw new BadRequestException('File is empty.');
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new BadRequestException('File exceeds the 25 MB limit.');
  }
  const ext = extensionOf(file.originalname);
  if (!ALLOWED_ATTACHMENT_EXTENSIONS.has(ext)) {
    throw new BadRequestException(
      `File type ".${ext || 'unknown'}" is not allowed. Allowed: ${Array.from(ALLOWED_ATTACHMENT_EXTENSIONS).join(', ')}.`,
    );
  }
}

/** Normalise a stored allowed-extensions list: lowercase, no leading dot, deduped. */
export function normaliseExtensions(list: string[] | null | undefined): string[] {
  return Array.from(
    new Set((list ?? []).map((e) => e.replace(/^\./, '').trim().toLowerCase()).filter(Boolean)),
  );
}

/**
 * Proof validation: the global attachment rules PLUS the task's own allowed-types
 * restriction (empty = anything the global allowlist permits).
 */
export function validateProofFile(file: UploadedFile | undefined, allowedExtensions: string[]): void {
  validateAttachmentFile(file);
  const allowed = normaliseExtensions(allowedExtensions);
  if (allowed.length > 0) {
    const ext = extensionOf((file as UploadedFile).originalname);
    if (!allowed.includes(ext)) {
      throw new BadRequestException(
        `Proof must be one of: ${allowed.join(', ')}. ".${ext || 'unknown'}" is not accepted.`,
      );
    }
  }
}

@Injectable()
export class TaskAttachmentsService {
  private readonly logger = new Logger(TaskAttachmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
    private readonly notifications: NotificationsService,
    private readonly clock: ClockService,
  ) {}

  private async assertNotFutureTask(orgId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organization_id: orgId },
      select: { created_at: true },
    });
    if (task) {
      const now = await this.clock.now(orgId);
      if (task.created_at > now) {
        throw new ForbiddenException("This task was created in a simulated future. To interact with it, please time-travel to this date or later.");
      }
    }
  }

  private async assertTask(orgId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organization_id: orgId, is_deleted: false },
      select: { id: true },
    });
    if (!task) throw new NotFoundException(`Task ${taskId} not found`);
  }

  /** Attach a document to a task (commentId null) or one of its comments. */
  async upload(
    orgId: string,
    userId: string,
    taskId: string,
    file: UploadedFile | undefined,
    commentId?: string,
  ) {
    validateAttachmentFile(file);
    await this.assertTask(orgId, taskId);
    await this.assertNotFutureTask(orgId, taskId);

    if (commentId) {
      const comment = await this.prisma.taskComment.findFirst({
        where: { id: commentId, organization_id: orgId, task_id: taskId, is_deleted: false },
        select: { id: true },
      });
      if (!comment) throw new NotFoundException(`Comment ${commentId} not found`);
    }

    const f = file as UploadedFile;
    const attachment = await this.storeFile(orgId, userId, taskId, f, { comment_id: commentId ?? null });

    // Everything below runs AFTER the attachment is committed — activity trail
    // and notifications are best-effort and must never fail the upload itself.
    try {
      await this.prisma.taskActivityLog.create({
        data: {
          organization_id: orgId,
          task_id: taskId,
          performed_by_user_id: userId,
          action: 'file_attached',
          metadata: { attachment_id: attachment.id, file_name: f.originalname, comment_id: commentId ?? null },
        },
      });

      // Files added straight to the task (not via a comment — comments notify on their
      // own) should ping everyone on the task except the uploader.
      if (!commentId) {
        const task = await this.prisma.task.findUnique({
          where: { id: taskId },
          select: {
            title: true,
            created_by_user_id: true,
            // Ping the LIVE roster only — someone taken off the task shouldn't keep
            // hearing about files added to it.
            assignees: { where: ACTIVE_ASSIGNEE, select: { user_id: true } },
          },
        });
        if (task) {
          const uploaderName = await this.notifications.userName(userId);
          const recipients = [
            task.created_by_user_id,
            ...task.assignees.map((a) => a.user_id),
          ].filter((uid) => uid !== userId);
          await this.notifications.emit({
            orgId,
            module: 'tasks',
            event_type: 'task_attachment_added',
            recipients,
            title: `${uploaderName} attached a file`,
            body: `“${f.originalname}”\non “${task.title}”`,
            link: `/dashboard/tasks/${taskId}`,
            entity: { type: 'task', id: taskId },
          });
        }
      }
    } catch (err) {
      this.logger.warn(`Post-upload activity/notify failed for attachment ${attachment.id}: ${(err as Error).message}`);
    }

    // Post-commit enrichment read — fall back to the raw row on a transient.
    return this.enrich(attachment.id).catch(() => ({ ...attachment, uploaded_by_name: null }));
  }

  /**
   * A "private" proof must stay private EVERYWHERE — the ordinary attachments list and
   * download must never surface what the Proof panel hides. Same rule as listProofs:
   * the uploader, the assigner (task creator), or an admin.
   */
  private filterProofVisibility<
    T extends { is_proof: boolean; proof_visibility: ProofVisibility | null; uploaded_by_user_id: string },
  >(rows: T[], creatorUserId: string, viewer: { userId: string; isAdmin: boolean }): T[] {
    const isCreator = creatorUserId === viewer.userId;
    return rows.filter((r) => !r.is_proof || this.canSeeProof(r, { ...viewer, isCreator }));
  }

  /** Task-level attachments (not tied to a comment), newest first. */
  async listForTask(orgId: string, taskId: string, viewer: { userId: string; isAdmin: boolean }) {
    const task = await this.loadTaskForProof(orgId, taskId);
    const rows = await this.prisma.taskAttachment.findMany({
      where: { organization_id: orgId, task_id: taskId, comment_id: null, is_deleted: false },
      orderBy: { created_at: 'desc' },
    });
    return this.attachUploaderNames(this.filterProofVisibility(rows, task.created_by_user_id, viewer));
  }

  /**
   * Every attachment on the task — those added at creation time / on the task itself
   * AND those shared inside comments — newest first. Each row keeps its `comment_id`
   * so the UI can show where it came from, plus the uploader's name.
   */
  async listAllForTask(orgId: string, taskId: string, viewer: { userId: string; isAdmin: boolean }) {
    const task = await this.loadTaskForProof(orgId, taskId);
    const rows = await this.prisma.taskAttachment.findMany({
      where: { organization_id: orgId, task_id: taskId, is_deleted: false, ...LIVE_PARENT_COMMENT },
      orderBy: { created_at: 'desc' },
    });
    return this.attachUploaderNames(this.filterProofVisibility(rows, task.created_by_user_id, viewer));
  }

  /** A short-lived signed URL that streams the file with its original name. */
  async getDownloadUrl(orgId: string, taskId: string, attachmentId: string, viewer: { userId: string; isAdmin: boolean }) {
    const task = await this.loadTaskForProof(orgId, taskId);
    const att = await this.prisma.taskAttachment.findFirst({
      where: { id: attachmentId, organization_id: orgId, task_id: taskId, is_deleted: false, ...LIVE_PARENT_COMMENT },
    });
    // 404 (not 403) when hidden — never leak that a private proof exists.
    if (!att || (att.is_proof && !this.canSeeProof(att, { ...viewer, isCreator: task.created_by_user_id === viewer.userId }))) {
      throw new NotFoundException('Attachment not found');
    }
    const url = await this.r2.getSignedDownloadUrl(att.storage_key, att.file_name);
    return { url, file_name: att.file_name };
  }

  /** Soft-delete + purge from R2. Only the uploader may remove their attachment. */
  async remove(orgId: string, userId: string, taskId: string, attachmentId: string) {
    const att = await this.prisma.taskAttachment.findFirst({
      where: { id: attachmentId, organization_id: orgId, task_id: taskId, is_deleted: false },
    });
    if (!att) throw new NotFoundException('Attachment not found');
    await this.assertNotFutureTask(orgId, taskId);
    if (att.uploaded_by_user_id !== userId) {
      throw new ForbiddenException('You can only remove attachments you uploaded.');
    }

    // A proof file can be freely removed/replaced UNTIL it's locked in as evidence:
    // once the task is closed, or (all_must) once the uploader has completed their own
    // part with it, it's frozen — reopen first to change it.
    if (att.is_proof) {
      const task = await this.prisma.task.findFirst({
        where: { id: taskId, organization_id: orgId },
        select: {
          completion_mode: true,
          status: { select: { type: true } },
          // Deliberately NOT filtered by ACTIVE_ASSIGNEE: this reads the uploader's own
          // part to decide whether their proof is already frozen as evidence. A completed
          // part is a historical fact (see assigneeOutcome) — filtering removed rows here
          // would UNFREEZE the proof for someone taken off the task and let them delete
          // the evidence of a part they had already completed.
          assignees: { where: { user_id: userId, is_cc: false }, select: { is_completed: true } },
        },
      });
      if (task && isTerminal(task.status?.type)) {
        throw new BadRequestException('Proof can’t be removed after the task is closed. Reopen it first.');
      }
      if (task?.completion_mode === 'all_must_complete' && task.assignees[0]?.is_completed) {
        throw new BadRequestException('You’ve completed your part with this proof — ask the assigner to reopen your part to change it.');
      }
    }

    await this.prisma.taskAttachment.update({
      where: { id: attachmentId },
      data: { is_deleted: true, deleted_at: new Date() },
    });
    await this.r2.deleteObject(att.storage_key);
    return { message: 'Attachment removed' };
  }

  // ─── proof of completion ───────────────────────────────────────────────────

  /**
   * Load the fields the proof flow needs, with the task's primary/CC assignees.
   * Fails closed (404) if the task doesn't exist in this org.
   */
  private async loadTaskForProof(orgId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organization_id: orgId, is_deleted: false },
      select: {
        id: true,
        title: true,
        proof_required: true,
        proof_allowed_extensions: true,
        completion_mode: true,
        created_by_user_id: true,
        // The proof gate asks "is this person ON the task right now?" — a removed
        // assignee may no longer submit or promote proof.
        assignees: { where: ACTIVE_ASSIGNEE, select: { user_id: true, is_cc: true } },
      },
    });
    if (!task) throw new NotFoundException(`Task ${taskId} not found`);
    return task;
  }

  /**
   * Submit a proof file for the current user's part. Only a non-CC primary assignee
   * may submit; the file is validated against the task's allowed types. In
   * `any_can_complete` mode the proof is always visible to everyone (one proof closes
   * the task for all, so hiding it adds nothing); otherwise the uploader's choice stands.
   */
  async uploadProof(
    orgId: string,
    userId: string,
    taskId: string,
    file: UploadedFile | undefined,
    visibility: ProofVisibility,
  ) {
    const task = await this.loadTaskForProof(orgId, taskId);
    await this.assertNotFutureTask(orgId, taskId);
    if (!task.proof_required) {
      throw new BadRequestException('This task does not require proof of completion.');
    }
    const isPrimaryAssignee = task.assignees.some((a) => a.user_id === userId && !a.is_cc);
    if (!isPrimaryAssignee) {
      throw new ForbiddenException('Only assignees can submit proof of completion.');
    }
    validateProofFile(file, task.proof_allowed_extensions);

    const effectiveVisibility: ProofVisibility =
      task.completion_mode === 'any_can_complete' ? 'everyone' : visibility;

    const attachment = await this.storeFile(orgId, userId, taskId, file as UploadedFile, {
      is_proof: true,
      proof_visibility: effectiveVisibility,
    });

    try {
      await this.prisma.taskActivityLog.create({
        data: {
          organization_id: orgId,
          task_id: taskId,
          performed_by_user_id: userId,
          action: 'proof_attached',
          metadata: {
            attachment_id: attachment.id,
            file_name: (file as UploadedFile).originalname,
            visibility: effectiveVisibility,
          },
        },
      });
    } catch (err) {
      this.logger.warn(`Proof activity log failed for ${attachment.id}: ${(err as Error).message}`);
    }

    // The assigner is waiting on this — tell them the proof arrived (best-effort,
    // mirroring how ordinary attachments already notify).
    await this.notifyProofSubmitted(orgId, userId, taskId, task, (file as UploadedFile).originalname);

    return this.enrich(attachment.id).catch(() => ({ ...attachment, uploaded_by_name: null }));
  }

  /** Best-effort "proof submitted" ping to the assigner. Never fails the upload. */
  private async notifyProofSubmitted(
    orgId: string,
    uploaderId: string,
    taskId: string,
    task: { title: string; created_by_user_id: string },
    fileName: string,
  ) {
    try {
      if (task.created_by_user_id === uploaderId) return;
      const uploaderName = await this.notifications.userName(uploaderId);
      await this.notifications.emit({
        orgId,
        module: 'tasks',
        event_type: 'task_proof_submitted',
        recipients: [task.created_by_user_id],
        title: `${uploaderName} submitted proof of completion`,
        body: `“${fileName}”\non “${task.title}”`,
        link: `/dashboard/tasks/${taskId}`,
        entity: { type: 'task', id: taskId },
      });
    } catch (err) {
      this.logger.warn(`Proof-submitted notification failed for task ${taskId}: ${(err as Error).message}`);
    }
  }

  /**
   * Promote a file the user already shared in a comment to be their proof. Comment
   * files are already visible to everyone on the task, so proof visibility is `everyone`.
   * Only the uploader (a non-CC assignee) may do this, and only when proof is required.
   */
  async markCommentAttachmentAsProof(orgId: string, userId: string, taskId: string, attachmentId: string) {
    const task = await this.loadTaskForProof(orgId, taskId);
    await this.assertNotFutureTask(orgId, taskId);
    if (!task.proof_required) {
      throw new BadRequestException('This task does not require proof of completion.');
    }
    const att = await this.prisma.taskAttachment.findFirst({
      where: { id: attachmentId, organization_id: orgId, task_id: taskId, is_deleted: false },
    });
    if (!att) throw new NotFoundException('Attachment not found');
    if (!att.comment_id) {
      throw new BadRequestException('Only a file shared in a comment can be marked as proof.');
    }
    if (att.uploaded_by_user_id !== userId) {
      throw new ForbiddenException('You can only mark your own file as proof.');
    }
    if (!task.assignees.some((a) => a.user_id === userId && !a.is_cc)) {
      throw new ForbiddenException('Only assignees can submit proof of completion.');
    }
    const allowed = normaliseExtensions(task.proof_allowed_extensions);
    if (allowed.length > 0 && !allowed.includes(extensionOf(att.file_name))) {
      throw new BadRequestException(`Proof must be one of: ${allowed.join(', ')}.`);
    }

    if (!att.is_proof) {
      await this.prisma.taskAttachment.update({
        where: { id: att.id },
        data: { is_proof: true, proof_visibility: 'everyone' },
      });
      try {
        await this.prisma.taskActivityLog.create({
          data: {
            organization_id: orgId,
            task_id: taskId,
            performed_by_user_id: userId,
            action: 'proof_attached',
            metadata: { attachment_id: att.id, file_name: att.file_name, from_comment: true },
          },
        });
      } catch (err) {
        this.logger.warn(`Proof (from comment) log failed for ${att.id}: ${(err as Error).message}`);
      }
      await this.notifyProofSubmitted(orgId, userId, taskId, task, att.file_name);
    }
    return this.enrich(att.id).catch(() => ({ ...att, uploaded_by_name: null }));
  }

  /**
   * Proof files the viewer may see: `everyone` proofs always; `private` proofs only
   * for their uploader, the assigner (task creator), or an admin.
   */
  async listProofs(orgId: string, taskId: string, viewer: { userId: string; isAdmin: boolean }) {
    const task = await this.loadTaskForProof(orgId, taskId);
    const isCreator = task.created_by_user_id === viewer.userId;
    const rows = await this.prisma.taskAttachment.findMany({
      where: { organization_id: orgId, task_id: taskId, is_proof: true, is_deleted: false, ...LIVE_PARENT_COMMENT },
      orderBy: { created_at: 'desc' },
    });
    const visible = rows.filter((r) => this.canSeeProof(r, { ...viewer, isCreator }));
    return this.attachUploaderNames(visible);
  }

  /** Signed download URL for a proof, gated by the same visibility rule. Fails closed. */
  async getProofDownloadUrl(
    orgId: string,
    taskId: string,
    attachmentId: string,
    viewer: { userId: string; isAdmin: boolean },
  ) {
    const task = await this.loadTaskForProof(orgId, taskId);
    const isCreator = task.created_by_user_id === viewer.userId;
    const att = await this.prisma.taskAttachment.findFirst({
      where: { id: attachmentId, organization_id: orgId, task_id: taskId, is_proof: true, is_deleted: false, ...LIVE_PARENT_COMMENT },
    });
    // 404 (not 403) when hidden — never leak that a private proof exists.
    if (!att || !this.canSeeProof(att, { ...viewer, isCreator })) {
      throw new NotFoundException('Attachment not found');
    }
    const url = await this.r2.getSignedDownloadUrl(att.storage_key, att.file_name);
    return { url, file_name: att.file_name };
  }

  private canSeeProof(
    att: { proof_visibility: ProofVisibility | null; uploaded_by_user_id: string },
    viewer: { userId: string; isCreator: boolean; isAdmin: boolean },
  ): boolean {
    return (
      att.proof_visibility === 'everyone' ||
      att.uploaded_by_user_id === viewer.userId ||
      viewer.isCreator ||
      viewer.isAdmin
    );
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  /**
   * Put the file in R2 then record the row, deleting the object if the insert fails
   * so we never strand an orphan. Shared by ordinary uploads and proof uploads.
   */
  private async storeFile(
    orgId: string,
    userId: string,
    taskId: string,
    f: UploadedFile,
    extra: { comment_id?: string | null; is_proof?: boolean; proof_visibility?: ProofVisibility | null },
  ) {
    const key = `org/${orgId}/tasks/${taskId}/${randomUUID()}.${extensionOf(f.originalname)}`;
    await this.r2.putObject(key, f.buffer, f.mimetype || 'application/octet-stream');
    try {
      return await this.prisma.taskAttachment.create({
        data: {
          organization_id: orgId,
          task_id: taskId,
          comment_id: extra.comment_id ?? null,
          file_name: f.originalname,
          mime_type: f.mimetype || 'application/octet-stream',
          size_bytes: f.size,
          storage_key: key,
          uploaded_by_user_id: userId,
          is_proof: extra.is_proof ?? false,
          proof_visibility: extra.proof_visibility ?? null,
        },
      });
    } catch (err) {
      await this.r2.deleteObject(key); // best-effort; never throws
      throw err;
    }
  }

  private async enrich(id: string) {
    const row = await this.prisma.taskAttachment.findUniqueOrThrow({ where: { id } });
    const [enriched] = await this.attachUploaderNames([row]);
    return enriched;
  }

  private async attachUploaderNames<T extends { uploaded_by_user_id: string }>(rows: T[]) {
    const ids = Array.from(new Set(rows.map((r) => r.uploaded_by_user_id)));
    const users = ids.length
      ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((r) => ({ ...r, uploaded_by_name: nameById.get(r.uploaded_by_user_id) ?? null }));
  }
}
