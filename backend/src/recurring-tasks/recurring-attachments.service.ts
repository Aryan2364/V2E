import { randomUUID } from 'crypto';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { R2Service } from '../storage/r2.service';
import {
  extensionOf,
  validateAttachmentFile,
  type UploadedFile,
} from '../tasks/task-attachments.service';

/**
 * Attachments defined on a recurring template. These are the "master" copies —
 * the scheduler copies them into each spawned child task (see
 * SchedulerService.copyTemplateAttachmentsToTask). Mirrors the task attachment
 * flow (validate → R2 → DB row, with rollback on insert failure).
 */
@Injectable()
export class RecurringAttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
  ) {}

  private async assertTemplate(orgId: string, templateId: string) {
    const t = await this.prisma.recurringTemplate.findFirst({
      where: { id: templateId, organization_id: orgId },
      select: { id: true },
    });
    if (!t) throw new NotFoundException('Recurring template not found');
  }

  async upload(orgId: string, userId: string, templateId: string, file: UploadedFile | undefined) {
    validateAttachmentFile(file);
    await this.assertTemplate(orgId, templateId);

    const f = file as UploadedFile;
    const key = `org/${orgId}/recurring/${templateId}/${randomUUID()}.${extensionOf(f.originalname)}`;
    await this.r2.putObject(key, f.buffer, f.mimetype || 'application/octet-stream');

    let attachment;
    try {
      attachment = await this.prisma.recurringTemplateAttachment.create({
        data: {
          organization_id: orgId,
          recurring_template_id: templateId,
          file_name: f.originalname,
          mime_type: f.mimetype || 'application/octet-stream',
          size_bytes: f.size,
          storage_key: key,
          uploaded_by_user_id: userId,
        },
      });
    } catch (err) {
      await this.r2.deleteObject(key); // best-effort; never throws
      throw err;
    }

    return this.enrich(attachment.id);
  }

  async listForTemplate(orgId: string, templateId: string) {
    await this.assertTemplate(orgId, templateId);
    const rows = await this.prisma.recurringTemplateAttachment.findMany({
      where: { organization_id: orgId, recurring_template_id: templateId, is_deleted: false },
      orderBy: { created_at: 'desc' },
    });
    return this.attachUploaderNames(rows);
  }

  async getDownloadUrl(orgId: string, templateId: string, attachmentId: string) {
    const att = await this.prisma.recurringTemplateAttachment.findFirst({
      where: { id: attachmentId, organization_id: orgId, recurring_template_id: templateId, is_deleted: false },
    });
    if (!att) throw new NotFoundException('Attachment not found');
    const url = await this.r2.getSignedDownloadUrl(att.storage_key, att.file_name);
    return { url, file_name: att.file_name };
  }

  async remove(orgId: string, userId: string, templateId: string, attachmentId: string) {
    const att = await this.prisma.recurringTemplateAttachment.findFirst({
      where: { id: attachmentId, organization_id: orgId, recurring_template_id: templateId, is_deleted: false },
    });
    if (!att) throw new NotFoundException('Attachment not found');
    if (att.uploaded_by_user_id !== userId) {
      throw new ForbiddenException('You can only remove attachments you uploaded.');
    }
    await this.prisma.recurringTemplateAttachment.update({
      where: { id: attachmentId },
      data: { is_deleted: true, deleted_at: new Date() },
    });
    await this.r2.deleteObject(att.storage_key);
    return { message: 'Attachment removed' };
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  private async enrich(id: string) {
    const row = await this.prisma.recurringTemplateAttachment.findUniqueOrThrow({ where: { id } });
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
