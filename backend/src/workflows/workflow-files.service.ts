import { randomUUID } from 'crypto'
import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { ProofVisibility } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { R2Service } from '../storage/r2.service'
import { WorkflowEngineService } from './workflow-engine.service'
import { extensionOf, validateAttachmentFile, type UploadedFile } from '../tasks/task-attachments.service'

export interface FileUserRef {
  id: string
  name: string
}

export interface StepFileOut {
  id: string
  file_name: string
  mime_type: string
  size_bytes: number
  uploaded_by: FileUserRef
  created_at: Date
  is_proof: boolean
  in_comment: boolean
}

export interface RunFileOut {
  id: string
  file_name: string
  mime_type: string
  size_bytes: number
  uploaded_by: FileUserRef
  created_at: Date
}

/** One run row with its task, for the documents aggregate. */
export interface DocumentRow {
  row_id: string
  step_title: string
  task_id: string | null
}

interface StepAttachmentRow {
  id: string
  task_id: string
  comment_id: string | null
  file_name: string
  mime_type: string
  size_bytes: number
  uploaded_by_user_id: string
  is_proof: boolean
  proof_visibility: ProofVisibility | null
  created_at: Date
}

/** The viewer the proof-visibility rule needs (same rule as TaskAttachmentsService.canSeeProof). */
export interface FileViewer {
  userId: string
  isAdmin: boolean
}

/**
 * Run-level documents for workflow runs (workflows v2 spec §C).
 *
 * - Run files (`WorkflowInstanceAttachment`) mirror `RecurringAttachmentsService`'s
 *   R2 conventions exactly: validate (same limits/types as task attachments) → put
 *   the object → insert the row, deleting the object if the insert fails; soft delete
 *   + purge on remove; a short-lived signed URL `{ url, file_name }` on download.
 * - Step files are the run's TASK attachments, aggregated with the recurring
 *   "instance attachments" rules: files of deleted comments are excluded and proofs
 *   are filtered by the task proof-visibility rule. They download through the task
 *   endpoints (which gate the task itself).
 *
 * AUTHORIZATION: this service performs NO caller gating — `WorkflowTemplateService`
 * gates the run (participant) before every call. Every query here is scoped by
 * `organization_id` + the parent instance id.
 */
@Injectable()
export class WorkflowFilesService {
  private readonly logger = new Logger(WorkflowFilesService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
    private readonly engine: WorkflowEngineService,
  ) {}

  // ── Run files ─────────────────────────────────────────────────────────────────

  async upload(orgId: string, userId: string, instanceId: string, file: UploadedFile | undefined): Promise<RunFileOut> {
    validateAttachmentFile(file)
    const f = file as UploadedFile
    const key = `org/${orgId}/workflows/${instanceId}/${randomUUID()}.${extensionOf(f.originalname)}`
    await this.r2.putObject(key, f.buffer, f.mimetype || 'application/octet-stream')

    let row
    try {
      row = await this.prisma.workflowInstanceAttachment.create({
        data: {
          organization_id: orgId,
          workflow_instance_id: instanceId,
          file_name: f.originalname,
          mime_type: f.mimetype || 'application/octet-stream',
          size_bytes: f.size,
          storage_key: key,
          uploaded_by_user_id: userId,
        },
      })
    } catch (err) {
      await this.r2.deleteObject(key) // best-effort; never throws
      throw err
    }
    await this.logEvent(orgId, instanceId, userId, 'file_added', `added “${f.originalname}”`, {
      file_id: row.id,
      file_name: f.originalname,
    })
    const [out] = await this.toRunFiles([row])
    return out
  }

  async listRunFiles(orgId: string, instanceId: string): Promise<RunFileOut[]> {
    const rows = await this.prisma.workflowInstanceAttachment.findMany({
      where: { organization_id: orgId, workflow_instance_id: instanceId, deleted_at: null },
      orderBy: { created_at: 'desc' },
    })
    return this.toRunFiles(rows)
  }

  /** The live run file (scoped to org + run), or 404. */
  async findRunFile(orgId: string, instanceId: string, fileId: string) {
    const att = await this.prisma.workflowInstanceAttachment.findFirst({
      where: { id: fileId, organization_id: orgId, workflow_instance_id: instanceId, deleted_at: null },
    })
    if (!att) throw new NotFoundException('File not found')
    return att
  }

  async getDownloadUrl(orgId: string, instanceId: string, fileId: string) {
    const att = await this.findRunFile(orgId, instanceId, fileId)
    const url = await this.r2.getSignedDownloadUrl(att.storage_key, att.file_name)
    return { url, file_name: att.file_name }
  }

  /** Soft-delete + purge. The caller has already checked uploader-or-can_edit. */
  async remove(orgId: string, actorUserId: string, instanceId: string, fileId: string) {
    const att = await this.findRunFile(orgId, instanceId, fileId)
    const res = await this.prisma.workflowInstanceAttachment.updateMany({
      where: { id: att.id, organization_id: orgId, workflow_instance_id: instanceId, deleted_at: null },
      data: { deleted_at: new Date() },
    })
    if (res.count !== 1) throw new NotFoundException('File not found')
    await this.r2.deleteObject(att.storage_key)
    await this.logEvent(orgId, instanceId, actorUserId, 'file_removed', `removed “${att.file_name}”`, {
      file_id: att.id,
      file_name: att.file_name,
    })
    return { id: att.id }
  }

  // ── Documents aggregate ───────────────────────────────────────────────────────

  /**
   * Step files grouped by run row (display order; rows without files omitted), each
   * group newest first, plus the run files.
   */
  async documents(orgId: string, instanceId: string, rows: DocumentRow[], viewer: FileViewer) {
    const taskIds = [...new Set(rows.map((r) => r.task_id).filter((x): x is string => !!x))]
    const [tasks, attachments, runFiles] = await Promise.all([
      taskIds.length
        ? this.prisma.task.findMany({
            where: { id: { in: taskIds }, organization_id: orgId, is_deleted: false },
            select: { id: true, created_by_user_id: true },
          })
        : Promise.resolve([] as { id: string; created_by_user_id: string }[]),
      taskIds.length
        ? this.prisma.taskAttachment.findMany({
            where: {
              organization_id: orgId,
              task_id: { in: taskIds },
              is_deleted: false,
              // Files of a deleted comment go with it (same rule as the task lists).
              OR: [{ comment_id: null }, { comment: { is_deleted: false } }],
            },
            orderBy: { created_at: 'desc' },
            select: {
              id: true,
              task_id: true,
              comment_id: true,
              file_name: true,
              mime_type: true,
              size_bytes: true,
              uploaded_by_user_id: true,
              is_proof: true,
              proof_visibility: true,
              created_at: true,
            },
          })
        : Promise.resolve([] as StepAttachmentRow[]),
      this.listRunFiles(orgId, instanceId),
    ])
    const creatorByTask = new Map(tasks.map((t) => [t.id, t.created_by_user_id]))
    const visible = attachments.filter((a) => {
      const creator = creatorByTask.get(a.task_id)
      if (creator === undefined) return false // deleted task
      return !a.is_proof || canSeeProof(a, { ...viewer, isCreator: creator === viewer.userId })
    })
    const names = await this.userNames(visible.map((a) => a.uploaded_by_user_id))
    const byTask = new Map<string, StepFileOut[]>()
    for (const a of visible) {
      const list = byTask.get(a.task_id) ?? []
      list.push({
        id: a.id,
        file_name: a.file_name,
        mime_type: a.mime_type,
        size_bytes: a.size_bytes,
        uploaded_by: { id: a.uploaded_by_user_id, name: names.get(a.uploaded_by_user_id) ?? 'Unknown user' },
        created_at: a.created_at,
        is_proof: a.is_proof,
        in_comment: !!a.comment_id,
      })
      byTask.set(a.task_id, list)
    }
    const step_files = rows
      .filter((r) => r.task_id && (byTask.get(r.task_id)?.length ?? 0) > 0)
      .map((r) => ({ row_id: r.row_id, step_title: r.step_title, task_id: r.task_id, files: byTask.get(r.task_id!)! }))
    return { step_files, run_files: runFiles }
  }

  // ── helpers ───────────────────────────────────────────────────────────────────

  private async toRunFiles(
    rows: {
      id: string
      file_name: string
      mime_type: string
      size_bytes: number
      uploaded_by_user_id: string
      created_at: Date
    }[],
  ): Promise<RunFileOut[]> {
    const names = await this.userNames(rows.map((r) => r.uploaded_by_user_id))
    return rows.map((r) => ({
      id: r.id,
      file_name: r.file_name,
      mime_type: r.mime_type,
      size_bytes: r.size_bytes,
      uploaded_by: { id: r.uploaded_by_user_id, name: names.get(r.uploaded_by_user_id) ?? 'Unknown user' },
      created_at: r.created_at,
    }))
  }

  private async userNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))]
    if (!unique.length) return new Map()
    const users = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } })
    return new Map(users.map((u) => [u.id, u.name]))
  }

  /**
   * Run history entry for a file change, through the engine's event writer (org
   * clock, same shape as every other run event). Best-effort: never fails the
   * upload/remove that already happened.
   */
  private async logEvent(
    orgId: string,
    instanceId: string,
    actorUserId: string,
    type: 'file_added' | 'file_removed',
    action: string,
    metadata: Record<string, unknown>,
  ) {
    try {
      const actor = await this.prisma.user.findUnique({ where: { id: actorUserId }, select: { name: true } })
      await this.engine.recordEvent(orgId, instanceId, type, `${actor?.name ?? 'Someone'} ${action}`, {
        actorUserId,
        metadata,
      })
    } catch (err) {
      this.logger.warn(`Run history (${type}) failed for run ${instanceId}: ${(err as Error).message}`)
    }
  }
}

/** Mirrors TaskAttachmentsService.canSeeProof (everyone / uploader / task creator / admin). */
export function canSeeProof(
  att: { proof_visibility: ProofVisibility | null; uploaded_by_user_id: string },
  viewer: { userId: string; isCreator: boolean; isAdmin: boolean },
): boolean {
  return (
    att.proof_visibility === 'everyone' ||
    att.uploaded_by_user_id === viewer.userId ||
    viewer.isCreator ||
    viewer.isAdmin
  )
}
