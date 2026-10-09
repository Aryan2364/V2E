import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { ClockService } from '../clock/clock.service'
import { NotificationsService } from '../notifications/notifications.service'
import { R2Service } from '../storage/r2.service'
import { ACTIVE_ASSIGNEE } from '../tasks/active-assignee'
import { TaskAttachmentsService, type UploadedFile } from '../tasks/task-attachments.service'
import { WorkflowEngineService } from './workflow-engine.service'
import { WorkflowFilesService, canSeeProof } from './workflow-files.service'
import { isBranchRow, readSnapshot } from './engine/snapshot'
import { isOpen } from './engine/dag'
import { DISCUSSION_PAGE, DISCUSSION_PAGE_MAX, MENTION_MAX, MESSAGE_BODY_MAX } from './dto/discussion.dto'

/**
 * One discussion per workflow instance (instance-thread spec).
 *
 * STORAGE: `TaskComment` is the one store. Every message of an instance carries
 * `workflow_instance_id`; a message written on a step's task page keeps that `task_id`
 * (the step it was written on — its files live with that task and show under that step
 * in the Documents drawer); a message written on the instance page has no task. The
 * thread is every live message of the instance in time order, replies one level deep
 * under the message they answer. The former instance notes are messages tagged
 * `for_instance_step_id` ("For “Issue PO”"); the reason a send-back posts is a message
 * marked `sent_back_from_row_id` / `sent_back_to_row_id`.
 *
 * AUTHORIZATION: this service performs NO caller gating — `WorkflowTemplateService`
 * gates the instance (run-access participant rule / workflow capabilities) before every
 * call, and `TasksService` gates the task before it asks for notifications. Every query
 * here is scoped by `organization_id` + the instance id (AUTHORIZATION.md rule 2/3);
 * read markers are scoped by `user_id` (rule 4).
 */

/** A step of the instance as the discussion needs it. */
export interface DiscussionRow {
  id: string
  title: string
  status: string
  task_id: string | null
  is_branch: boolean
  returned_to_row_id: string | null
  waiting_on_row_id: string | null
}

/** The instance a discussion belongs to (already gated by the caller). */
export interface DiscussionCtx {
  orgId: string
  instanceId: string
  templateId: string
  instanceName: string
  templateCreatorId: string
  triggeredById: string | null
  rows: DiscussionRow[]
}

/** Who is reading / writing: `canEdit` = editor or admin of the workflow. */
export interface DiscussionViewer {
  userId: string
  isAdmin: boolean
  canEdit: boolean
}

export interface DiscussionPerson {
  id: string
  name: string
}

export interface DiscussionFile {
  id: string
  file_name: string
  mime_type: string
  size_bytes: number
  created_at: Date
  uploaded_by_user_id: string
  is_proof: boolean
  /** The step task the file lives on (null = an instance file). */
  task_id: string | null
}

export interface DiscussionMessage {
  id: string
  body: string
  author: DiscussionPerson | null
  created_at: Date
  /** The step task it was written on (null = the instance page). Not shown as a label. */
  task_id: string | null
  reply_to_id: string | null
  /** "For “Issue PO”" — the later step it is for. */
  for_step: { row_id: string; title: string; status: string } | null
  /** "↩ Sent back to “Collect documents”" — the reason a send-back posted. */
  send_back: { from_row_id: string | null; from_title: string | null; to_row_id: string; to_title: string } | null
  mentions: DiscussionPerson[]
  attachments: DiscussionFile[]
  /** Its author, editors and admins. */
  can_delete: boolean
  /** A removed message kept only because it has replies (no text, files or author). */
  deleted: boolean
  replies: DiscussionMessage[]
}

export interface DiscussionPage {
  messages: DiscussionMessage[]
  /** Older messages exist — load them with `before` = `next_before`. */
  has_more: boolean
  next_before: string | null
  /** Live messages in the whole discussion. */
  total_count: number
  /** Messages by others after the viewer's read marker (all of them when never read). */
  unread_count: number
  /** The viewer's read marker before this read (the unread divider goes after it). */
  last_read_at: Date | null
  /** The instance's steps in order (the "For a later step" picker; `task_id` = its live task). */
  steps: { row_id: string; title: string; status: string; task_id: string | null }[]
}

export interface PostMessageInput {
  body?: string | null
  reply_to_id?: string | null
  for_row_id?: string | null
  mention_user_ids?: string[] | null
  task_id?: string | null
  with_files?: boolean | null
}

/** A tagged message as "Notes for this step" reads it. */
export interface TaggedMessageRow {
  id: string
  workflow_instance_id: string
  author_user_id: string
  body: string
  for_instance_step_id: string
  created_at: Date
}

const MESSAGE_SELECT = {
  id: true,
  task_id: true,
  user_id: true,
  body: true,
  reply_to_comment_id: true,
  for_instance_step_id: true,
  mentioned_user_ids: true,
  sent_back_from_row_id: true,
  sent_back_to_row_id: true,
  is_deleted: true,
  created_at: true,
} satisfies Prisma.TaskCommentSelect

type MessageRow = Prisma.TaskCommentGetPayload<{ select: typeof MESSAGE_SELECT }>

const MSG_NOT_FOUND = 'Message not found'
const MSG_REPLY_NOT_FOUND = 'The message you are replying to was not found.'
const MSG_REMOVE = 'Only the person who wrote this message, editors and admins can remove it.'
const MSG_STEP = 'Choose a step of this instance that isn’t done or skipped.'
const MSG_TASK = 'That task isn’t part of this instance.'
const MSG_EMPTY = 'Write a message.'
const MSG_FILE_OWN = 'You can only attach files to your own messages.'
const MSG_FUTURE =
  'This task was created in a simulated future. To interact with it, please time-travel to this date or later.'
const TAGGED_LIMIT = 500
/** Step statuses a message can no longer be "for". */
const DONE_ROW = ['completed', 'skipped']

function unique<T>(xs: Iterable<T>): T[] {
  return [...new Set(xs)]
}

/** “Short excerpt” of a message for a notification; a file-only message reads as one. */
export function messageExcerpt(body: string | null | undefined, max = 100): string {
  const t = (body ?? '').trim()
  if (!t) return 'Shared an attachment'
  return `“${t.length > max ? `${t.slice(0, max)}…` : t}”`
}

/**
 * Who is told about a new message, each person once, author never:
 *  - `mentioned`: @mentioned people ("mentioned you");
 *  - `tagged`: the working assignees of the later step it is for, when that step has started;
 *  - `others`: the people on the step it was written on (assignees + CC + task creator),
 *    everyone who already wrote in this discussion, the author of the message replied to,
 *    and — on an open send-back — the people on the other side.
 * Everyone must still be able to see the instance (`canSee`) — fail closed.
 */
export function discussionRecipients(p: {
  authorId: string
  stepPeople: string[]
  priorAuthors: string[]
  replyToAuthorId: string | null
  mentioned: string[]
  sendBackPeople: string[]
  taggedStepPeople: string[]
  canSee: (userId: string) => boolean
}): { mentioned: string[]; tagged: string[]; others: string[] } {
  const seen = new Set<string>([p.authorId])
  const take = (ids: (string | null | undefined)[]) => {
    const out: string[] = []
    for (const id of ids) {
      if (!id || seen.has(id) || !p.canSee(id)) continue
      seen.add(id)
      out.push(id)
    }
    return out
  }
  const mentioned = take(p.mentioned)
  const tagged = take(p.taggedStepPeople)
  const others = take([...p.stepPeople, ...p.priorAuthors, p.replyToAuthorId, ...p.sendBackPeople])
  return { mentioned, tagged, others }
}

/** The discussion context from an instance already loaded (with its steps + template). */
export function discussionCtx(
  orgId: string,
  inst: {
    id: string
    name: string
    workflow_template_id: string
    triggered_by_user_id: string | null
    template: { created_by_user_id: string }
    steps: {
      id: string
      status: string
      task_id: string | null
      step_snapshot: unknown
      returned_to_row_id?: string | null
      waiting_on_row_id?: string | null
      order_index?: number
      created_at?: Date
    }[]
  },
): DiscussionCtx {
  // Display order (track position, then creation) when the rows carry it.
  const steps = [...inst.steps].sort(
    (a, b) =>
      (a.order_index ?? 0) - (b.order_index ?? 0) ||
      (a.created_at?.getTime() ?? 0) - (b.created_at?.getTime() ?? 0) ||
      a.id.localeCompare(b.id),
  )
  return {
    orgId,
    instanceId: inst.id,
    templateId: inst.workflow_template_id,
    instanceName: inst.name,
    templateCreatorId: inst.template.created_by_user_id,
    triggeredById: inst.triggered_by_user_id,
    rows: steps.map((s) => ({
      id: s.id,
      title: readSnapshot(s.step_snapshot as never)?.title ?? 'Step',
      status: String(s.status),
      task_id: s.task_id,
      is_branch: isBranchRow(s),
      returned_to_row_id: s.returned_to_row_id ?? null,
      waiting_on_row_id: s.waiting_on_row_id ?? null,
    })),
  }
}

@Injectable()
export class WorkflowDiscussionService {
  private readonly logger = new Logger(WorkflowDiscussionService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly notifications: NotificationsService,
    private readonly engine: WorkflowEngineService,
    private readonly r2: R2Service,
    private readonly files: WorkflowFilesService,
    // TaskAttachmentsService lives in TasksModule (which imports this module), so it is
    // resolved lazily for files on messages written on a step task.
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  // ════════════════════════════════════════════════════════════════════════════
  // Context
  // ════════════════════════════════════════════════════════════════════════════

  /** The instance (org-scoped) as a discussion context, or null when it isn't there. */
  async loadCtx(orgId: string, instanceId: string): Promise<DiscussionCtx | null> {
    const inst = await this.prisma.workflowInstance.findFirst({
      where: { id: instanceId, organization_id: orgId },
      select: {
        id: true,
        name: true,
        workflow_template_id: true,
        triggered_by_user_id: true,
        template: { select: { created_by_user_id: true } },
        steps: {
          select: {
            id: true,
            status: true,
            task_id: true,
            step_snapshot: true,
            returned_to_row_id: true,
            waiting_on_row_id: true,
            order_index: true,
            created_at: true,
          },
        },
      },
    })
    return inst ? discussionCtx(orgId, inst) : null
  }

  /** The instance a workflow step task belongs to (org-scoped), or null for an ordinary task. */
  async instanceIdForTask(orgId: string, taskId: string): Promise<string | null> {
    const row = await this.prisma.workflowInstanceStep.findFirst({
      where: { task_id: taskId, organization_id: orgId },
      select: { workflow_instance_id: true },
    })
    return row?.workflow_instance_id ?? null
  }

  /**
   * Everyone who may see the instance without an admin bypass (run-access.ts): its
   * workflow's editors (creator + `edit` grants) and viewers, the person who ran it, and
   * everyone working in it — live assignees/CCs of any of its tasks (withdrawn tasks
   * included) and their escalation contacts.
   */
  private async visibleUserIds(ctx: DiscussionCtx): Promise<Set<string>> {
    const taskIds = unique(ctx.rows.map((r) => r.task_id).filter((x): x is string => !!x))
    const [grants, assignees, escalations] = await Promise.all([
      this.prisma.workflowAccess.findMany({
        where: { organization_id: ctx.orgId, workflow_template_id: ctx.templateId, access_type: { in: ['edit', 'view'] } },
        select: { user_id: true },
      }),
      taskIds.length
        ? this.prisma.taskAssignee.findMany({
            where: { organization_id: ctx.orgId, task_id: { in: taskIds }, removed_at: null },
            select: { user_id: true },
          })
        : Promise.resolve([] as { user_id: string }[]),
      taskIds.length
        ? this.prisma.taskEscalation.findMany({
            where: { organization_id: ctx.orgId, task_id: { in: taskIds } },
            select: { escalate_to_user_id: true },
          })
        : Promise.resolve([] as { escalate_to_user_id: string }[]),
    ])
    return new Set(
      [
        ctx.templateCreatorId,
        ctx.triggeredById,
        ...grants.map((g) => g.user_id),
        ...assignees.map((a) => a.user_id),
        ...escalations.map((e) => e.escalate_to_user_id),
      ].filter((x): x is string => !!x),
    )
  }

  /** Active members among `ids`. */
  private async activeMembers(orgId: string, ids: Iterable<string>): Promise<Set<string>> {
    const list = unique([...ids].filter(Boolean))
    if (!list.length) return new Set()
    const rows = await this.prisma.organizationMember.findMany({
      where: { organization_id: orgId, user_id: { in: list }, is_active: true },
      select: { user_id: true },
    })
    return new Set(rows.map((r) => r.user_id))
  }

  /** `GET …/discussion/people` — who can be @mentioned: active members who can see the instance, by name. */
  async people(ctx: DiscussionCtx): Promise<DiscussionPerson[]> {
    const visible = await this.visibleUserIds(ctx)
    const active = await this.activeMembers(ctx.orgId, visible)
    const names = await this.userNames(active)
    return [...active]
      .map((id) => ({ id, name: names.get(id) ?? 'Unknown user' }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Read
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * `GET …/discussion` — one page of the thread, newest last: the latest `limit`
   * top-level messages (older ones with `before`), each with its replies. A removed
   * message that still has live replies stays as a placeholder so its replies keep
   * their place.
   */
  async thread(
    ctx: DiscussionCtx,
    viewer: DiscussionViewer,
    opts: { before?: string | null; limit?: number | null } = {},
  ): Promise<DiscussionPage> {
    const limit = Math.min(Math.max(Math.trunc(opts.limit ?? DISCUSSION_PAGE) || DISCUSSION_PAGE, 1), DISCUSSION_PAGE_MAX)
    const scope = { organization_id: ctx.orgId, workflow_instance_id: ctx.instanceId }
    let cursor: Prisma.TaskCommentWhereInput = {}
    if (opts.before) {
      const cur = await this.prisma.taskComment.findFirst({
        where: { id: opts.before, ...scope },
        select: { id: true, created_at: true },
      })
      if (!cur) throw new NotFoundException(MSG_NOT_FOUND)
      cursor = { OR: [{ created_at: { lt: cur.created_at } }, { created_at: cur.created_at, id: { lt: cur.id } }] }
    }
    const tops = await this.prisma.taskComment.findMany({
      where: {
        AND: [
          { ...scope, reply_to_comment_id: null },
          { OR: [{ is_deleted: false }, { replies: { some: { is_deleted: false } } }] },
          cursor,
        ],
      },
      select: MESSAGE_SELECT,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    })
    const hasMore = tops.length > limit
    const page = tops.slice(0, limit).reverse()
    const replies = page.length
      ? await this.prisma.taskComment.findMany({
          where: { ...scope, reply_to_comment_id: { in: page.map((m) => m.id) }, is_deleted: false },
          select: MESSAGE_SELECT,
          orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
        })
      : []
    const [messages, counts] = await Promise.all([
      this.format(ctx, viewer, page, replies),
      this.counts(ctx.orgId, ctx.instanceId, viewer.userId),
    ])
    return {
      messages,
      has_more: hasMore,
      next_before: hasMore && page.length ? page[0].id : null,
      total_count: counts.count,
      unread_count: counts.unread_count,
      last_read_at: counts.last_read_at,
      steps: ctx.rows.filter((r) => !r.is_branch).map((r) => ({ row_id: r.id, title: r.title, status: r.status, task_id: r.task_id })),
    }
  }

  /** Live messages and the viewer's unread count (+ marker) for one instance. */
  async counts(
    orgId: string,
    instanceId: string,
    userId: string,
  ): Promise<{ count: number; unread_count: number; last_read_at: Date | null }> {
    const scope = { organization_id: orgId, workflow_instance_id: instanceId, is_deleted: false }
    const marker = await this.prisma.workflowDiscussionRead.findFirst({
      where: { organization_id: orgId, workflow_instance_id: instanceId, user_id: userId },
      select: { last_read_at: true },
    })
    const [count, unread] = await Promise.all([
      this.prisma.taskComment.count({ where: scope }),
      this.prisma.taskComment.count({
        where: {
          ...scope,
          user_id: { not: userId },
          ...(marker ? { created_at: { gt: marker.last_read_at } } : {}),
        },
      }),
    ])
    return { count, unread_count: unread, last_read_at: marker?.last_read_at ?? null }
  }

  /** One message (top-level or reply) as the thread shows it — the post response. */
  private async one(ctx: DiscussionCtx, viewer: DiscussionViewer, id: string): Promise<DiscussionMessage> {
    const row = await this.prisma.taskComment.findFirst({
      where: { id, organization_id: ctx.orgId, workflow_instance_id: ctx.instanceId },
      select: MESSAGE_SELECT,
    })
    if (!row) throw new NotFoundException(MSG_NOT_FOUND)
    const [out] = await this.format(ctx, viewer, [row], [])
    return out
  }

  /** Shapes top-level messages + their replies (authors, mentions, tags, files). */
  private async format(
    ctx: DiscussionCtx,
    viewer: DiscussionViewer,
    tops: MessageRow[],
    replies: MessageRow[],
  ): Promise<DiscussionMessage[]> {
    const all = [...tops, ...replies]
    if (!all.length) return []
    const liveIds = all.filter((m) => !m.is_deleted).map((m) => m.id)
    const [taskFiles, instanceFiles] = liveIds.length
      ? await Promise.all([
          this.prisma.taskAttachment.findMany({
            where: { organization_id: ctx.orgId, comment_id: { in: liveIds }, is_deleted: false },
            select: {
              id: true,
              comment_id: true,
              task_id: true,
              file_name: true,
              mime_type: true,
              size_bytes: true,
              created_at: true,
              uploaded_by_user_id: true,
              is_proof: true,
              proof_visibility: true,
            },
            orderBy: { created_at: 'asc' },
          }),
          this.prisma.workflowInstanceAttachment.findMany({
            where: {
              organization_id: ctx.orgId,
              workflow_instance_id: ctx.instanceId,
              comment_id: { in: liveIds },
              deleted_at: null,
            },
            select: {
              id: true,
              comment_id: true,
              file_name: true,
              mime_type: true,
              size_bytes: true,
              created_at: true,
              uploaded_by_user_id: true,
            },
            orderBy: { created_at: 'asc' },
          }),
        ])
      : [[], []]
    // Private proofs stay private here too (uploader / task creator / admin).
    const fileTaskIds = unique(taskFiles.map((f) => f.task_id))
    const creators = fileTaskIds.length
      ? await this.prisma.task.findMany({
          where: { id: { in: fileTaskIds }, organization_id: ctx.orgId },
          select: { id: true, created_by_user_id: true },
        })
      : []
    const creatorOf = new Map(creators.map((t) => [t.id, t.created_by_user_id]))
    const filesBy = new Map<string, DiscussionFile[]>()
    const push = (commentId: string | null, f: DiscussionFile) => {
      if (!commentId) return
      const list = filesBy.get(commentId) ?? []
      list.push(f)
      filesBy.set(commentId, list)
    }
    for (const f of taskFiles) {
      const visible =
        !f.is_proof ||
        canSeeProof(f, { userId: viewer.userId, isAdmin: viewer.isAdmin, isCreator: creatorOf.get(f.task_id) === viewer.userId })
      if (!visible) continue
      push(f.comment_id, {
        id: f.id,
        file_name: f.file_name,
        mime_type: f.mime_type,
        size_bytes: f.size_bytes,
        created_at: f.created_at,
        uploaded_by_user_id: f.uploaded_by_user_id,
        is_proof: f.is_proof,
        task_id: f.task_id,
      })
    }
    for (const f of instanceFiles) {
      push(f.comment_id, {
        id: f.id,
        file_name: f.file_name,
        mime_type: f.mime_type,
        size_bytes: f.size_bytes,
        created_at: f.created_at,
        uploaded_by_user_id: f.uploaded_by_user_id,
        is_proof: false,
        task_id: null,
      })
    }

    const names = await this.userNames(all.flatMap((m) => (m.is_deleted ? [] : [m.user_id, ...(m.mentioned_user_ids ?? [])])))
    const rowById = new Map(ctx.rows.map((r) => [r.id, r]))
    const shape = (m: MessageRow, kids: DiscussionMessage[]): DiscussionMessage => {
      if (m.is_deleted) {
        return {
          id: m.id,
          body: '',
          author: null,
          created_at: m.created_at,
          task_id: null,
          reply_to_id: m.reply_to_comment_id,
          for_step: null,
          send_back: null,
          mentions: [],
          attachments: [],
          can_delete: false,
          deleted: true,
          replies: kids,
        }
      }
      const forRow = m.for_instance_step_id ? rowById.get(m.for_instance_step_id) : undefined
      const toRow = m.sent_back_to_row_id ? rowById.get(m.sent_back_to_row_id) : undefined
      const fromRow = m.sent_back_from_row_id ? rowById.get(m.sent_back_from_row_id) : undefined
      return {
        id: m.id,
        body: m.body,
        author: { id: m.user_id, name: names.get(m.user_id) ?? 'Unknown user' },
        created_at: m.created_at,
        task_id: m.task_id,
        reply_to_id: m.reply_to_comment_id,
        for_step: forRow ? { row_id: forRow.id, title: forRow.title, status: forRow.status } : null,
        send_back: toRow
          ? { from_row_id: fromRow?.id ?? null, from_title: fromRow?.title ?? null, to_row_id: toRow.id, to_title: toRow.title }
          : null,
        mentions: unique(m.mentioned_user_ids ?? [])
          .filter((id) => names.has(id))
          .map((id) => ({ id, name: names.get(id)! })),
        attachments: filesBy.get(m.id) ?? [],
        can_delete: m.user_id === viewer.userId || viewer.canEdit,
        deleted: false,
        replies: kids,
      }
    }
    const kidsOf = new Map<string, DiscussionMessage[]>()
    for (const r of replies) {
      if (!r.reply_to_comment_id) continue
      const list = kidsOf.get(r.reply_to_comment_id) ?? []
      list.push(shape(r, []))
      kidsOf.set(r.reply_to_comment_id, list)
    }
    return tops.map((m) => shape(m, kidsOf.get(m.id) ?? []))
  }

  /**
   * Live tagged messages ("For <step>") of these instances — optionally only those for
   * one step — newest first. Feeds "Notes for this step" on the task and step panel.
   */
  async taggedMessages(orgId: string, instanceIds: string[], forRowId?: string): Promise<TaggedMessageRow[]> {
    if (!instanceIds.length) return []
    const rows = await this.prisma.taskComment.findMany({
      where: {
        organization_id: orgId,
        workflow_instance_id: { in: instanceIds },
        is_deleted: false,
        for_instance_step_id: forRowId ? forRowId : { not: null },
      },
      select: { id: true, workflow_instance_id: true, user_id: true, body: true, for_instance_step_id: true, created_at: true },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: TAGGED_LIMIT,
    })
    return rows.map((r) => ({
      id: r.id,
      workflow_instance_id: r.workflow_instance_id!,
      author_user_id: r.user_id,
      body: r.body,
      for_instance_step_id: r.for_instance_step_id!,
      created_at: r.created_at,
    }))
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Write
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * `POST …/discussion` — anyone who can see the instance (the caller gated it). The
   * message belongs to `task_id` when written on a step's task page (it must be a live
   * task of this instance), else to the instance. A reply answers any live message of
   * this instance (replies stay one level deep under the top message). `for_row_id`
   * tags it for a later step (not done or skipped). Mentions keep only people who can
   * see the instance. Then: activity / history entries and notifications (best-effort).
   */
  async post(ctx: DiscussionCtx, author: DiscussionViewer, input: PostMessageInput): Promise<DiscussionMessage> {
    const body = typeof input.body === 'string' ? input.body.trim() : ''
    if (!body && !input.with_files) {
      throw new BadRequestException({ message: MSG_EMPTY, code: 'message_body_required', field: 'body' })
    }
    if (body.length > MESSAGE_BODY_MAX) {
      throw new BadRequestException({
        message: `Keep the message to ${MESSAGE_BODY_MAX} characters or fewer.`,
        code: 'message_body_too_long',
        field: 'body',
      })
    }
    const now = await this.clock.now(ctx.orgId)

    // Written on a step's task page: that task must be a live task of THIS instance.
    let taskId: string | null = null
    if (input.task_id) {
      const row = ctx.rows.find((r) => r.task_id === input.task_id)
      const task = row
        ? await this.prisma.task.findFirst({
            where: { id: input.task_id, organization_id: ctx.orgId, is_deleted: false, workflow_instance_step_id: row.id },
            select: { id: true, created_at: true },
          })
        : null
      if (!task) throw new NotFoundException({ message: MSG_TASK, code: 'message_task_invalid', field: 'task_id' })
      if (task.created_at > now) throw new ForbiddenException(MSG_FUTURE)
      taskId = task.id
    }

    // A reply answers a live message of THIS instance; it hangs under the top message.
    let replyRootId: string | null = null
    let replyToAuthorId: string | null = null
    if (input.reply_to_id) {
      const parent = await this.prisma.taskComment.findFirst({
        where: {
          id: input.reply_to_id,
          organization_id: ctx.orgId,
          workflow_instance_id: ctx.instanceId,
          is_deleted: false,
        },
        select: { id: true, user_id: true, reply_to_comment_id: true },
      })
      if (!parent) throw new NotFoundException({ message: MSG_REPLY_NOT_FOUND, code: 'message_reply_invalid', field: 'reply_to_id' })
      replyRootId = parent.reply_to_comment_id ?? parent.id
      replyToAuthorId = parent.user_id
    }

    const forRowId = input.for_row_id || null
    const forRow = forRowId ? ctx.rows.find((r) => r.id === forRowId) : undefined
    if (forRowId && (!forRow || forRow.is_branch || DONE_ROW.includes(forRow.status))) {
      throw new BadRequestException({ message: MSG_STEP, code: 'message_step_invalid', field: 'for_row_id' })
    }

    const asked = unique((input.mention_user_ids ?? []).filter((x) => typeof x === 'string' && x)).slice(0, MENTION_MAX)
    let mentions: string[] = []
    if (asked.length) {
      const visible = await this.visibleUserIds(ctx)
      const active = await this.activeMembers(ctx.orgId, asked.filter((id) => visible.has(id)))
      mentions = asked.filter((id) => active.has(id))
    }

    const created = await this.prisma.taskComment.create({
      data: {
        organization_id: ctx.orgId,
        task_id: taskId,
        workflow_instance_id: ctx.instanceId,
        user_id: author.userId,
        body,
        reply_to_comment_id: replyRootId,
        for_instance_step_id: forRow?.id ?? null,
        mentioned_user_ids: mentions,
        created_at: now,
      },
      select: { id: true },
    })

    if (taskId) await this.taskActivity(ctx.orgId, taskId, author.userId, 'comment_added', { comment_id: created.id })
    if (forRow) {
      try {
        const name = await this.notifications.userName(author.userId)
        await this.engine.recordEvent(ctx.orgId, ctx.instanceId, 'note_added', `${name} left a message for “${forRow.title}”.`, {
          rowId: forRow.id,
          actorUserId: author.userId,
          metadata: { note_id: created.id, comment_id: created.id, for_row_id: forRow.id },
        })
      } catch (err) {
        this.logger.warn(`Instance history (note_added) failed for ${ctx.instanceId}: ${(err as Error).message}`)
      }
    }
    await this.notifyNewMessage(ctx.orgId, created.id, { replyToAuthorId, ctx })
    return this.one(ctx, author, created.id)
  }

  /**
   * Tell the right people about a new message (see `discussionRecipients`). Best-effort:
   * never throws. Used by `post` and by the task comments route for a workflow step task.
   */
  async notifyNewMessage(
    orgId: string,
    messageId: string,
    opts: { replyToAuthorId?: string | null; ctx?: DiscussionCtx } = {},
  ): Promise<void> {
    try {
      const m = await this.prisma.taskComment.findFirst({
        where: { id: messageId, organization_id: orgId, is_deleted: false },
        select: { ...MESSAGE_SELECT, workflow_instance_id: true },
      })
      if (!m?.workflow_instance_id) return
      const ctx =
        opts.ctx && opts.ctx.instanceId === m.workflow_instance_id ? opts.ctx : await this.loadCtx(orgId, m.workflow_instance_id)
      if (!ctx) return
      const scope = { organization_id: orgId, workflow_instance_id: ctx.instanceId }
      const writtenOn = m.task_id ? ctx.rows.find((r) => r.task_id === m.task_id) : undefined

      const [task, prior, parent, root] = await Promise.all([
        m.task_id
          ? this.prisma.task.findFirst({
              where: { id: m.task_id, organization_id: orgId },
              select: { created_by_user_id: true, assignees: { where: ACTIVE_ASSIGNEE, select: { user_id: true } } },
            })
          : Promise.resolve(null),
        this.prisma.taskComment.findMany({
          where: { ...scope, is_deleted: false, id: { not: m.id } },
          select: { user_id: true },
          distinct: ['user_id'],
        }),
        opts.replyToAuthorId === undefined && m.reply_to_comment_id
          ? this.prisma.taskComment.findFirst({ where: { ...scope, id: m.reply_to_comment_id }, select: { user_id: true } })
          : Promise.resolve(null),
        m.reply_to_comment_id
          ? this.prisma.taskComment.findFirst({
              where: { ...scope, id: m.reply_to_comment_id },
              select: { sent_back_from_row_id: true, sent_back_to_row_id: true },
            })
          : Promise.resolve(null),
      ])
      const forRow = m.for_instance_step_id ? ctx.rows.find((r) => r.id === m.for_instance_step_id) : undefined
      const replyToAuthorId = opts.replyToAuthorId !== undefined ? opts.replyToAuthorId : parent?.user_id ?? null
      const stepPeople = task ? [task.created_by_user_id, ...task.assignees.map((a) => a.user_id)] : []
      const [sendBackPeople, taggedPeople, visible] = await Promise.all([
        this.sendBackPeople(ctx, writtenOn, root),
        forRow?.task_id && isOpen(forRow.status) ? this.workers(orgId, forRow.task_id) : Promise.resolve([] as string[]),
        this.visibleUserIds(ctx),
      ])
      const candidates = unique([
        ...stepPeople,
        ...prior.map((p) => p.user_id),
        ...(replyToAuthorId ? [replyToAuthorId] : []),
        ...(m.mentioned_user_ids ?? []),
        ...sendBackPeople,
        ...taggedPeople,
      ])
      // Admins see every instance; anyone else must be able to see this one.
      const outside = candidates.filter((id) => !visible.has(id))
      const admins = outside.length
        ? await this.prisma.organizationMember.findMany({
            where: { organization_id: orgId, user_id: { in: outside }, is_admin: true, is_active: true },
            select: { user_id: true },
          })
        : []
      const adminSet = new Set(admins.map((a) => a.user_id))
      const to = discussionRecipients({
        authorId: m.user_id,
        stepPeople,
        priorAuthors: prior.map((p) => p.user_id),
        replyToAuthorId,
        mentioned: m.mentioned_user_ids ?? [],
        sendBackPeople,
        taggedStepPeople: taggedPeople,
        canSee: (id) => visible.has(id) || adminSet.has(id),
      })
      if (!to.mentioned.length && !to.tagged.length && !to.others.length) return

      const author = await this.notifications.userName(m.user_id)
      const excerpt = messageExcerpt(m.body)
      const instanceLink = `/dashboard/tasks/workflows/${ctx.templateId}/instances/${ctx.instanceId}`
      const link = m.task_id ? `/dashboard/tasks/${m.task_id}` : instanceLink
      const where = `in “${ctx.instanceName}”`
      const entity = { type: 'workflow_instance', id: ctx.instanceId }
      const sends: Promise<unknown>[] = []
      if (to.mentioned.length) {
        sends.push(
          this.notifications.emit({
            orgId,
            module: 'workflows',
            event_type: 'workflow_mention',
            recipients: to.mentioned,
            title: `${author} mentioned you`,
            body: `${excerpt}\n${where}`,
            link,
            entity,
          }),
        )
      }
      if (to.tagged.length && forRow) {
        sends.push(
          this.notifications.emit({
            orgId,
            module: 'workflows',
            event_type: 'workflow_note_added',
            recipients: to.tagged,
            title: 'New message for your step',
            body: `${author} left a message for “${forRow.title}” ${where}: ${messageExcerpt(m.body, 200)}`,
            link: forRow.task_id ? `/dashboard/tasks/${forRow.task_id}` : instanceLink,
            entity,
          }),
        )
      }
      if (to.others.length) {
        sends.push(
          this.notifications.emit({
            orgId,
            module: 'workflows',
            event_type: 'workflow_discussion',
            recipients: to.others,
            title: `${author} commented`,
            body: `${excerpt}\n${where}`,
            link,
            entity,
          }),
        )
      }
      await Promise.all(sends)
    } catch (err) {
      this.logger.warn(`Discussion notification failed for message ${messageId}: ${(err as Error).message}`)
    }
  }

  /**
   * People on the other side of an open send-back: for a message written on the step
   * that was sent back TO, the sender step's people; on the paused sender step, the
   * people of the step it waits on; and for a reply to a send-back's reason while that
   * send-back is open, the people on both steps.
   */
  private async sendBackPeople(
    ctx: DiscussionCtx,
    writtenOn: DiscussionRow | undefined,
    root: { sent_back_from_row_id: string | null; sent_back_to_row_id: string | null } | null,
  ): Promise<string[]> {
    const byId = new Map(ctx.rows.map((r) => [r.id, r]))
    const rowIds = new Set<string>()
    if (writtenOn) {
      const other = writtenOn.returned_to_row_id ?? (writtenOn.status === 'sent_back' ? writtenOn.waiting_on_row_id : null)
      if (other) rowIds.add(other)
    }
    if (root?.sent_back_from_row_id && root.sent_back_to_row_id) {
      const from = byId.get(root.sent_back_from_row_id)
      const to = byId.get(root.sent_back_to_row_id)
      const open =
        !!from &&
        !!to &&
        ((from.status === 'sent_back' && from.waiting_on_row_id === to.id) || to.returned_to_row_id === from.id)
      if (open) {
        rowIds.add(from!.id)
        rowIds.add(to!.id)
      }
    }
    const taskIds = [...rowIds].map((id) => byId.get(id)?.task_id).filter((x): x is string => !!x)
    if (!taskIds.length) return []
    const people = await this.prisma.taskAssignee.findMany({
      where: { task_id: { in: taskIds }, organization_id: ctx.orgId, ...ACTIVE_ASSIGNEE },
      select: { user_id: true },
    })
    return unique(people.map((p) => p.user_id))
  }

  /** Live non-CC workers of a task. */
  private async workers(orgId: string, taskId: string): Promise<string[]> {
    const rows = await this.prisma.taskAssignee.findMany({
      where: { task_id: taskId, organization_id: orgId, is_cc: false, removed_at: null },
      select: { user_id: true },
    })
    return rows.map((r) => r.user_id)
  }

  /**
   * `DELETE …/discussion/:messageId` — its author, editors and admins. Soft delete; its
   * files go with it (rows soft-deleted, objects purged best-effort).
   */
  async remove(ctx: DiscussionCtx, viewer: DiscussionViewer, messageId: string): Promise<{ id: string; deleted: true }> {
    const scope = { organization_id: ctx.orgId, workflow_instance_id: ctx.instanceId }
    const m = await this.prisma.taskComment.findFirst({
      where: { id: messageId, ...scope, is_deleted: false },
      select: { id: true, user_id: true, task_id: true },
    })
    if (!m) throw new NotFoundException(MSG_NOT_FOUND)
    if (m.user_id !== viewer.userId && !viewer.canEdit) throw new ForbiddenException(MSG_REMOVE)
    const now = await this.clock.now(ctx.orgId)
    const res = await this.prisma.taskComment.updateMany({
      where: { id: m.id, ...scope, is_deleted: false },
      data: { is_deleted: true, deleted_at: now },
    })
    if (res.count === 0) throw new NotFoundException(MSG_NOT_FOUND)

    const [taskFiles, instanceFiles] = await Promise.all([
      this.prisma.taskAttachment.findMany({
        where: { comment_id: m.id, organization_id: ctx.orgId, is_deleted: false },
        select: { id: true, storage_key: true },
      }),
      this.prisma.workflowInstanceAttachment.findMany({
        where: { comment_id: m.id, ...scope, deleted_at: null },
        select: { id: true, storage_key: true },
      }),
    ])
    if (taskFiles.length) {
      await this.prisma.taskAttachment.updateMany({
        where: { comment_id: m.id, organization_id: ctx.orgId, is_deleted: false },
        data: { is_deleted: true, deleted_at: now },
      })
    }
    if (instanceFiles.length) {
      await this.prisma.workflowInstanceAttachment.updateMany({
        where: { comment_id: m.id, ...scope, deleted_at: null },
        data: { deleted_at: now },
      })
    }
    await Promise.all([...taskFiles, ...instanceFiles].map((f) => this.r2.deleteObject(f.storage_key).catch(() => undefined)))
    if (m.task_id) await this.taskActivity(ctx.orgId, m.task_id, viewer.userId, 'comment_deleted', { comment_id: m.id })
    return { id: m.id, deleted: true }
  }

  /**
   * `POST …/discussion/read` — the caller has read everything up to now (never moves
   * back; covers messages stamped up to the latest one). Scoped to the caller's own row.
   */
  async markRead(ctx: DiscussionCtx, userId: string): Promise<{ last_read_at: Date; unread_count: 0 }> {
    const now = await this.clock.now(ctx.orgId)
    const [latest, existing] = await Promise.all([
      this.prisma.taskComment.findFirst({
        where: { organization_id: ctx.orgId, workflow_instance_id: ctx.instanceId, is_deleted: false },
        orderBy: { created_at: 'desc' },
        select: { created_at: true },
      }),
      this.prisma.workflowDiscussionRead.findFirst({
        where: { organization_id: ctx.orgId, workflow_instance_id: ctx.instanceId, user_id: userId },
        select: { last_read_at: true },
      }),
    ])
    let at = now
    if (latest && latest.created_at > at) at = latest.created_at
    if (existing && existing.last_read_at > at) at = existing.last_read_at
    await this.prisma.workflowDiscussionRead.upsert({
      where: { workflow_instance_id_user_id: { workflow_instance_id: ctx.instanceId, user_id: userId } },
      create: { organization_id: ctx.orgId, workflow_instance_id: ctx.instanceId, user_id: userId, last_read_at: at },
      update: { last_read_at: at },
    })
    return { last_read_at: at, unread_count: 0 }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Files
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * `POST …/discussion/:messageId/files` — a file on the caller's OWN live message of
   * this instance. A message written on a step task stores it with that task (it shows
   * under that step in Documents and can become proof); an instance-page message stores
   * it as an instance file.
   */
  async uploadFile(ctx: DiscussionCtx, userId: string, messageId: string, file: UploadedFile | undefined): Promise<DiscussionFile> {
    const m = await this.prisma.taskComment.findFirst({
      where: { id: messageId, organization_id: ctx.orgId, workflow_instance_id: ctx.instanceId, is_deleted: false },
      select: { id: true, user_id: true, task_id: true },
    })
    if (!m) throw new NotFoundException(MSG_NOT_FOUND)
    if (m.user_id !== userId) throw new ForbiddenException(MSG_FILE_OWN)
    if (m.task_id) {
      const attachments = this.taskAttachments()
      const a: any = await attachments.upload(ctx.orgId, userId, m.task_id, file, m.id)
      return {
        id: a.id,
        file_name: a.file_name,
        mime_type: a.mime_type,
        size_bytes: a.size_bytes,
        created_at: a.created_at,
        uploaded_by_user_id: a.uploaded_by_user_id,
        is_proof: !!a.is_proof,
        task_id: m.task_id,
      }
    }
    const f = await this.files.upload(ctx.orgId, userId, ctx.instanceId, file, { commentId: m.id })
    return {
      id: f.id,
      file_name: f.file_name,
      mime_type: f.mime_type,
      size_bytes: f.size_bytes,
      created_at: f.created_at,
      uploaded_by_user_id: f.uploaded_by.id,
      is_proof: false,
      task_id: null,
    }
  }

  /**
   * `GET …/discussion/files/:fileId/download` — a short-lived signed URL for a file on a
   * live message of THIS instance (private proofs only for uploader / task creator / admin).
   */
  async downloadFile(ctx: DiscussionCtx, viewer: DiscussionViewer, fileId: string): Promise<{ url: string; file_name: string }> {
    const ta = await this.prisma.taskAttachment.findFirst({
      where: {
        id: fileId,
        organization_id: ctx.orgId,
        is_deleted: false,
        comment: { workflow_instance_id: ctx.instanceId, organization_id: ctx.orgId, is_deleted: false },
      },
      select: {
        storage_key: true,
        file_name: true,
        is_proof: true,
        proof_visibility: true,
        uploaded_by_user_id: true,
        task: { select: { created_by_user_id: true } },
      },
    })
    if (ta) {
      const visible =
        !ta.is_proof ||
        canSeeProof(ta, { userId: viewer.userId, isAdmin: viewer.isAdmin, isCreator: ta.task?.created_by_user_id === viewer.userId })
      if (!visible) throw new NotFoundException('File not found')
      return { url: await this.r2.getSignedDownloadUrl(ta.storage_key, ta.file_name), file_name: ta.file_name }
    }
    const ia = await this.prisma.workflowInstanceAttachment.findFirst({
      where: {
        id: fileId,
        organization_id: ctx.orgId,
        workflow_instance_id: ctx.instanceId,
        deleted_at: null,
        comment: { is_deleted: false },
      },
      select: { storage_key: true, file_name: true },
    })
    if (!ia) throw new NotFoundException('File not found')
    return { url: await this.r2.getSignedDownloadUrl(ia.storage_key, ia.file_name), file_name: ia.file_name }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // helpers
  // ════════════════════════════════════════════════════════════════════════════

  private taskAttachments(): TaskAttachmentsService {
    let svc: TaskAttachmentsService | null = null
    try {
      svc = this.moduleRef?.get(TaskAttachmentsService, { strict: false }) ?? null
    } catch {
      svc = null
    }
    if (!svc) throw new BadRequestException('Files can’t be added right now. Try again.')
    return svc
  }

  private async taskActivity(
    orgId: string,
    taskId: string,
    userId: string,
    action: 'comment_added' | 'comment_deleted',
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.taskActivityLog.create({
        data: { organization_id: orgId, task_id: taskId, performed_by_user_id: userId, action, metadata: metadata as Prisma.InputJsonValue },
      })
    } catch (err) {
      this.logger.warn(`Activity log (${action}) failed for task ${taskId}: ${(err as Error).message}`)
    }
  }

  private async userNames(ids: Iterable<string>): Promise<Map<string, string>> {
    const list = unique([...ids].filter(Boolean))
    if (!list.length) return new Map()
    const users = await this.prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true } })
    return new Map(users.map((u) => [u.id, u.name]))
  }
}
