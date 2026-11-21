import { DiscussionQueryDto, PostDiscussionMessageDto } from './dto/discussion.dto'
import { DiscussionViewer, WorkflowDiscussionService, discussionCtx } from './workflow-discussion.service'
import { ForbiddenException, Injectable } from '@nestjs/common'
import { MSG_REMOVE_FILE, MSG_RUN_FILES } from './workflow-template.types'
import { Principal } from '../access-rights/permissions.service'
import { UploadedFile } from '../tasks/task-attachments.service'
import { WorkflowAccessService } from './workflow-access.service'
import { WorkflowFilesService } from './workflow-files.service'
import { byDisplayOrder, isLegacyBranchRow } from './step-graph'
import { isAdminPrincipal } from './workflow-access'
import { stepTitle } from './workflow-view.formatter'

/** An instance's documents (run files) and discussion, behind the instance access check. */
@Injectable()
export class WorkflowInstanceCollabService {
  constructor(
    private readonly files: WorkflowFilesService,
    private readonly discussion: WorkflowDiscussionService,
    private readonly access: WorkflowAccessService,
  ) {}

  /** Every step's files (proof-visibility filtered) + the instance's own files: everyone who can see it. */
  async getDocuments(orgId: string, templateId: string, instanceId: string, p: Principal) {
    const { inst } = await this.access.loadInstance(orgId, templateId, instanceId, p)
    const rows = inst.steps
      .filter((s) => !isLegacyBranchRow(s))
      .sort(byDisplayOrder)
      .map((s) => ({ row_id: s.id, step_title: stepTitle(s), task_id: s.task_id }))
    return this.files.documents(orgId, instanceId, rows, { userId: p.userId, isAdmin: isAdminPrincipal(p) })
  }

  async uploadRunFile(orgId: string, templateId: string, instanceId: string, file: UploadedFile | undefined, p: Principal) {
    await this.loadRunForUpload(orgId, templateId, instanceId, p)
    return this.files.upload(orgId, p.userId, instanceId, file)
  }

  async downloadRunFile(orgId: string, templateId: string, instanceId: string, fileId: string, p: Principal) {
    await this.access.loadInstance(orgId, templateId, instanceId, p)
    return this.files.getDownloadUrl(orgId, instanceId, fileId)
  }

  /** Remove an instance file: its uploader, or editors / admins. */
  async deleteRunFile(orgId: string, templateId: string, instanceId: string, fileId: string, p: Principal) {
    const { caps } = await this.access.loadInstance(orgId, templateId, instanceId, p)
    const file = await this.files.findRunFile(orgId, instanceId, fileId)
    if (file.uploaded_by_user_id !== p.userId && !caps.can_edit) throw new ForbiddenException(MSG_REMOVE_FILE)
    return this.files.remove(orgId, p.userId, instanceId, fileId)
  }

  /** Adding instance documents: everyone who can see it except a pure viewer. */
  private async loadRunForUpload(orgId: string, templateId: string, instanceId: string, p: Principal) {
    const loaded = await this.access.loadInstance(orgId, templateId, instanceId, p)
    if (!(await loaded.mayAct())) throw new ForbiddenException(MSG_RUN_FILES)
    return loaded
  }

  /**
   * The gated instance as a discussion context + the caller as a discussion viewer.
   * Everyone who can see the instance (`loadInstance`: workflow viewers/editors/admins,
   * the person who ran it, everyone working in it) may read and write.
   */
  private async discussionAccess(orgId: string, templateId: string, instanceId: string, p: Principal) {
    const { inst, caps } = await this.access.loadInstance(orgId, templateId, instanceId, p)
    return {
      ctx: discussionCtx(orgId, inst),
      viewer: { userId: p.userId, isAdmin: isAdminPrincipal(p), canEdit: caps.can_edit } satisfies DiscussionViewer,
    }
  }

  /** `GET /:id/instances/:iid/discussion` — one page of the thread, newest last. */
  async getDiscussion(orgId: string, templateId: string, instanceId: string, q: DiscussionQueryDto, p: Principal) {
    const { ctx, viewer } = await this.discussionAccess(orgId, templateId, instanceId, p)
    return this.discussion.thread(ctx, viewer, { before: q?.before ?? null, limit: q?.limit ?? null })
  }

  /** `POST /:id/instances/:iid/discussion` — anyone who can see the instance. */
  async postDiscussion(orgId: string, templateId: string, instanceId: string, dto: PostDiscussionMessageDto, p: Principal) {
    const { ctx, viewer } = await this.discussionAccess(orgId, templateId, instanceId, p)
    return this.discussion.post(ctx, viewer, dto ?? {})
  }

  /** `DELETE /:id/instances/:iid/discussion/:messageId` — its author, editors and admins. */
  async deleteDiscussionMessage(orgId: string, templateId: string, instanceId: string, messageId: string, p: Principal) {
    const { ctx, viewer } = await this.discussionAccess(orgId, templateId, instanceId, p)
    return this.discussion.remove(ctx, viewer, messageId)
  }

  /** `POST /:id/instances/:iid/discussion/read` — the caller's own read marker. */
  async markDiscussionRead(orgId: string, templateId: string, instanceId: string, p: Principal) {
    const { ctx } = await this.discussionAccess(orgId, templateId, instanceId, p)
    return this.discussion.markRead(ctx, p.userId)
  }

  /** `GET /:id/instances/:iid/discussion/people` — who can be @mentioned (people who can see it). */
  async getDiscussionPeople(orgId: string, templateId: string, instanceId: string, p: Principal) {
    const { ctx } = await this.discussionAccess(orgId, templateId, instanceId, p)
    return this.discussion.people(ctx)
  }

  /** `POST /:id/instances/:iid/discussion/:messageId/files` — on the caller's own message. */
  async uploadDiscussionFile(
    orgId: string,
    templateId: string,
    instanceId: string,
    messageId: string,
    file: UploadedFile | undefined,
    p: Principal,
  ) {
    const { ctx } = await this.discussionAccess(orgId, templateId, instanceId, p)
    return this.discussion.uploadFile(ctx, p.userId, messageId, file)
  }

  /** `GET /:id/instances/:iid/discussion/files/:fileId/download` — a file on a message of this instance. */
  async downloadDiscussionFile(orgId: string, templateId: string, instanceId: string, fileId: string, p: Principal) {
    const { ctx, viewer } = await this.discussionAccess(orgId, templateId, instanceId, p)
    return this.discussion.downloadFile(ctx, viewer, fileId)
  }
}
