import { randomUUID } from 'crypto';
import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { LearningPreviewStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { R2Service } from '../storage/r2.service';
import {
  CONVERTIBLE_EXTENSIONS,
  DocumentConversionService,
  NATIVE_PREVIEW_EXTENSIONS,
} from '../storage/document-conversion.service';
import {
  extensionOf,
  validateAttachmentFile,
  type UploadedFile,
} from '../tasks/task-attachments.service';

/** How the frontend should render a material. Native browser elements, a client-side
 *  renderer (docx/xlsx/csv/text), or nothing. */
export type PreviewKind =
  | 'pdf' | 'image' | 'video' | 'audio'
  | 'docx' | 'xlsx' | 'csv' | 'text'
  | 'none';

function nativeKind(ext: string): PreviewKind {
  if (ext === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov'].includes(ext)) return 'video';
  if (ext === 'mp3') return 'audio';
  return 'none';
}

/**
 * Files rendered IN THE BROWSER from their raw bytes — Word via Mammoth, Excel/CSV
 * via SheetJS, plain text directly. No server conversion needed, so these are
 * previewable (and therefore allowed to be view-only).
 */
const CLIENT_RENDERABLE: Record<string, PreviewKind> = {
  docx: 'docx',
  xlsx: 'xlsx',
  xls: 'xlsx',
  csv: 'csv',
  txt: 'text',
};

function clientKind(ext: string): PreviewKind {
  return CLIENT_RENDERABLE[ext] ?? 'none';
}

@Injectable()
export class LearningFilesService {
  private readonly logger = new Logger(LearningFilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
    private readonly converter: DocumentConversionService,
  ) {}

  /** Load an item, asserting it belongs to the path AND the org (via its path). */
  private async loadItem(orgId: string, pathId: string, itemId: string) {
    const item = await this.prisma.learningItem.findFirst({
      where: { id: itemId, path_id: pathId, path: { organization_id: orgId } },
    });
    if (!item) throw new NotFoundException('Learning item not found');
    return item;
  }

  /**
   * Attach (or replace) an uploaded document on an item and, for office docs,
   * convert it to a preview PDF so it renders in-app. `allowDownload` is the
   * course-decider's per-material choice (false = view-only).
   */
  async uploadItemFile(
    orgId: string,
    pathId: string,
    itemId: string,
    file: UploadedFile | undefined,
    allowDownload: boolean,
  ) {
    validateAttachmentFile(file);
    const f = file as UploadedFile;
    const item = await this.loadItem(orgId, pathId, itemId);

    const ext = extensionOf(f.originalname);
    const key = `org/${orgId}/learning/${pathId}/${itemId}/${randomUUID()}.${ext}`;
    await this.r2.putObject(key, f.buffer, f.mimetype || 'application/octet-stream');

    // Purge whatever was there before (best-effort) — we're replacing it.
    if (item.storage_key) await this.r2.deleteObject(item.storage_key);
    if (item.preview_storage_key) await this.r2.deleteObject(item.preview_storage_key);

    // Decide preview strategy from the extension.
    let previewStatus: LearningPreviewStatus = 'none';
    let previewKey: string | null = null;
    if (NATIVE_PREVIEW_EXTENSIONS.has(ext)) {
      previewStatus = 'ready'; // browser renders the original directly
    } else if (CLIENT_RENDERABLE[ext]) {
      previewStatus = 'ready'; // rendered in-browser (Mammoth/SheetJS/text) from the original
    } else if (CONVERTIBLE_EXTENSIONS.has(ext)) {
      // Office→PDF conversion is dormant by default (see DocumentConversionService /
      // LEARNING_DOC_PREVIEW.md). When off we don't spawn LibreOffice at all — the
      // file uploads fine and is download-to-view. Policy today: upload slides as PDF.
      if (this.converter.enabled) {
        const pdf = await this.converter.convertToPdf(f.buffer, f.originalname);
        if (pdf) {
          previewKey = `org/${orgId}/learning/${pathId}/${itemId}/${randomUUID()}.preview.pdf`;
          await this.r2.putObject(previewKey, pdf, 'application/pdf');
          previewStatus = 'ready';
        } else {
          previewStatus = 'failed'; // couldn't convert — download-to-view fallback
        }
      } else {
        previewStatus = 'failed'; // conversion disabled — download-to-view fallback
      }
    }

    const updated = await this.prisma.learningItem.update({
      where: { id: itemId, path_id: pathId },
      data: {
        content_type: 'file',
        content_url: null,
        content_body: null,
        file_name: f.originalname,
        file_mime: f.mimetype || 'application/octet-stream',
        file_size_bytes: f.size,
        storage_key: key,
        preview_storage_key: previewKey,
        preview_status: previewStatus,
        allow_download: allowDownload,
        // A freshly uploaded file with no title yet inherits the filename.
        title: item.title?.trim() ? item.title : f.originalname,
      },
    });
    return updated;
  }

  /** The kind + which stored object backs the in-app preview for a file item. */
  private resolvePreview(item: {
    content_type: string;
    file_name: string | null;
    file_mime: string | null;
    storage_key: string | null;
    preview_storage_key: string | null;
    preview_status: LearningPreviewStatus;
  }): { kind: PreviewKind; key: string | null } {
    if (item.content_type !== 'file' || !item.storage_key) return { kind: 'none', key: null };
    if (item.preview_storage_key) return { kind: 'pdf', key: item.preview_storage_key };
    const ext = extensionOf(item.file_name ?? '');
    // Word/Excel/CSV/text render in-browser from the raw bytes — always available,
    // regardless of preview_status (so files uploaded before this feature still work).
    const client = clientKind(ext);
    if (client !== 'none') return { kind: client, key: item.storage_key };
    if (item.preview_status === 'ready') {
      const native = nativeKind(ext);
      return { kind: native, key: native === 'none' ? null : item.storage_key };
    }
    return { kind: 'none', key: null }; // pending / failed / none → nothing to render inline
  }

  /**
   * The raw preview bytes for in-app rendering. Streamed through the backend (not a
   * direct R2 URL) so the browser fetches SAME-ORIGIN — pdf.js can't fetch the
   * cross-origin R2 URL (CORS), and for view-only materials this keeps the file URL
   * off the network tab entirely. Returns the converted preview PDF when present,
   * else the original (native-viewable) file.
   */
  private previewBytesFor(item: Awaited<ReturnType<LearningFilesService['loadItem']>>) {
    const { kind, key } = this.resolvePreview(item);
    return { kind, key };
  }

  async getAdminPreviewFile(orgId: string, pathId: string, itemId: string) {
    const item = await this.loadItem(orgId, pathId, itemId);
    return this.readPreview(item);
  }

  async getLearnerPreviewFile(
    orgId: string,
    assignmentId: string,
    itemId: string,
    employeeProfileId: string,
  ) {
    const item = await this.assertLearnerItem(orgId, assignmentId, itemId, employeeProfileId);
    return this.readPreview(item);
  }

  /** Fetch the resolved preview object's bytes + mime. 404 when there's nothing to preview. */
  private async readPreview(item: Awaited<ReturnType<LearningFilesService['loadItem']>>) {
    const { kind, key } = this.previewBytesFor(item);
    if (!key) throw new NotFoundException('No preview available for this material.');
    const buffer = await this.r2.getObjectBuffer(key);
    const mime = kind === 'pdf' ? 'application/pdf' : item.file_mime ?? 'application/octet-stream';
    return { buffer, mime, fileName: item.file_name ?? 'file' };
  }

  /** Admin/creator preview from the builder — inline URL, no view tracking. */
  async getAdminViewUrl(orgId: string, pathId: string, itemId: string) {
    const item = await this.loadItem(orgId, pathId, itemId);
    const { kind, key } = this.resolvePreview(item);
    if (!key) {
      return { kind, url: null, allow_download: item.allow_download, file_name: item.file_name };
    }
    const url = await this.r2.getSignedInlineUrl(key, item.file_name ?? 'preview');
    return { kind, url, allow_download: item.allow_download, file_name: item.file_name };
  }

  /**
   * Learner-facing view: verifies the assignment belongs to this employee, records
   * the access (for engagement analytics), and returns an inline preview URL.
   */
  async getLearnerViewData(
    orgId: string,
    assignmentId: string,
    itemId: string,
    employeeProfileId: string,
    userId: string,
  ) {
    const item = await this.assertLearnerItem(orgId, assignmentId, itemId, employeeProfileId);
    await this.recordView(orgId, item.path_id, itemId, employeeProfileId, userId);

    const { kind, key } = this.resolvePreview(item);
    const url = key ? await this.r2.getSignedInlineUrl(key, item.file_name ?? 'preview') : null;
    return {
      kind,
      url,
      allow_download: item.allow_download,
      file_name: item.file_name,
      preview_status: item.preview_status,
    };
  }

  /** Creator/admin download of a material's original file (for previewing the course). */
  async getAdminDownloadUrl(orgId: string, pathId: string, itemId: string) {
    const item = await this.loadItem(orgId, pathId, itemId);
    if (!item.storage_key) throw new NotFoundException('No file on this material.');
    const url = await this.r2.getSignedDownloadUrl(item.storage_key, item.file_name ?? 'download');
    return { url, file_name: item.file_name };
  }

  /** Learner download — blocked when the course-decider set the material to view-only. */
  async getLearnerDownloadUrl(
    orgId: string,
    assignmentId: string,
    itemId: string,
    employeeProfileId: string,
  ) {
    const item = await this.assertLearnerItem(orgId, assignmentId, itemId, employeeProfileId);
    if (!item.allow_download) {
      throw new ForbiddenException('This material is view-only — downloading is disabled.');
    }
    if (!item.storage_key) throw new NotFoundException('No file on this material.');
    const url = await this.r2.getSignedDownloadUrl(item.storage_key, item.file_name ?? 'download');
    return { url, file_name: item.file_name };
  }

  /** Assert the item is part of a path assigned to this employee; return the item. */
  private async assertLearnerItem(
    orgId: string,
    assignmentId: string,
    itemId: string,
    employeeProfileId: string,
  ) {
    const assignment = await this.prisma.learningPathAssignment.findFirst({
      where: { id: assignmentId, employee_profile_id: employeeProfileId, path: { organization_id: orgId } },
      select: { path_id: true },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');
    const item = await this.prisma.learningItem.findFirst({
      where: { id: itemId, path_id: assignment.path_id, path: { organization_id: orgId } },
    });
    if (!item) throw new NotFoundException('Learning item not found');
    return item;
  }

  /** Upsert the (item, learner) view row: first open creates it, repeats bump the count. */
  private async recordView(
    orgId: string,
    pathId: string,
    itemId: string,
    employeeProfileId: string,
    userId: string,
  ) {
    try {
      await this.prisma.learningItemView.upsert({
        where: { item_id_employee_profile_id: { item_id: itemId, employee_profile_id: employeeProfileId } },
        update: { view_count: { increment: 1 }, last_viewed_at: new Date() },
        create: {
          organization_id: orgId,
          path_id: pathId,
          item_id: itemId,
          employee_profile_id: employeeProfileId,
          user_id: userId,
        },
      });
    } catch (err) {
      // Analytics must never break the viewing experience.
      this.logger.warn(`Failed to record learning view for item ${itemId}: ${(err as Error).message}`);
    }
  }

  /**
   * Engagement analytics for a path: who accessed what. Per item we report how many
   * assigned learners opened it, total opens, and how many completed it; plus a
   * per-learner matrix (opened/completed each item).
   */
  async getEngagement(orgId: string, pathId: string) {
    const path = await this.prisma.learningPath.findFirst({
      where: { id: pathId, organization_id: orgId },
      include: { items: { orderBy: { order_index: 'asc' } } },
    });
    if (!path) throw new NotFoundException('Learning path not found');

    const assignments = await this.prisma.learningPathAssignment.findMany({
      where: { path_id: pathId },
      include: {
        employee_profile: {
          include: {
            user: { select: { id: true, name: true, email: true } },
            role: { select: { title: true } },
          },
        },
      },
    });

    const [views, itemProgress] = await Promise.all([
      this.prisma.learningItemView.findMany({ where: { path_id: pathId, organization_id: orgId } }),
      this.prisma.learningItemProgress.findMany({
        where: { assignment: { path_id: pathId } },
        select: { item_id: true, employee_profile_id: true, status: true, completed_at: true },
      }),
    ]);

    const viewKey = (itemId: string, emp: string) => `${itemId}::${emp}`;
    const viewMap = new Map(views.map((v) => [viewKey(v.item_id, v.employee_profile_id), v]));
    const completedSet = new Set(
      itemProgress.filter((p) => p.status === 'completed').map((p) => viewKey(p.item_id, p.employee_profile_id)),
    );
    const assignedEmployeeIds = assignments.map((a) => a.employee_profile_id);

    const items = path.items.map((item) => {
      let viewed = 0;
      let opens = 0;
      let completed = 0;
      for (const emp of assignedEmployeeIds) {
        const v = viewMap.get(viewKey(item.id, emp));
        if (v) {
          viewed++;
          opens += v.view_count;
        }
        if (completedSet.has(viewKey(item.id, emp))) completed++;
      }
      return {
        item_id: item.id,
        title: item.title,
        content_type: item.content_type,
        assigned: assignedEmployeeIds.length,
        viewed,
        total_opens: opens,
        completed,
      };
    });

    const learners = assignments.map((a) => {
      const emp = a.employee_profile;
      const per = path.items.map((item) => {
        const v = viewMap.get(viewKey(item.id, a.employee_profile_id));
        return {
          item_id: item.id,
          viewed: !!v,
          views: v?.view_count ?? 0,
          last_viewed_at: v?.last_viewed_at ?? null,
          completed: completedSet.has(viewKey(item.id, a.employee_profile_id)),
        };
      });
      return {
        employee_profile_id: a.employee_profile_id,
        name: emp?.user?.name ?? '—',
        email: emp?.user?.email ?? null,
        role: emp?.role?.title ?? null,
        status: a.status,
        items: per,
        opened_count: per.filter((p) => p.viewed).length,
        completed_count: per.filter((p) => p.completed).length,
      };
    });

    return {
      path_id: path.id,
      title: path.title,
      total_items: path.items.length,
      total_assigned: assignedEmployeeIds.length,
      items,
      learners,
    };
  }
}
