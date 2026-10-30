'use client'

import { fmtDateTime, fmtDue } from '@/lib/phone-format'
import React from 'react'
import { createPortal } from 'react-dom'
import { useParams, useRouter } from 'next/navigation'
import { Ellipsis, History, Info, Paperclip, Pencil, RotateCcw, Trash2, X, XCircle } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { usePermissions } from '@/lib/auth/use-permissions'
import { getNow } from '@/lib/clock'
import { useToast } from '@/components/ui/Toast'
import { tasksApi } from '@/lib/api/tasks'
import type { Task, TaskComment, TaskChecklistItem, TaskMasterConfig } from '@/lib/types/tasks'
import { TERMINAL_STATUS_PHASES } from '@/lib/types/tasks'
import { PHONE_HOME, taskEditHref, type PhoneRoute } from '@/lib/phone-routes'
import { shrinkImageForUpload } from '@/lib/image-resize'
import { canQuickComplete, unfinishedChecklistItems } from '@/lib/tasks/finish-rules'
import { useTaskBadge } from '@/lib/task-badge'
import { COMPLETED_UNDO_MESSAGE, completeForMe, isUndoWindowOpen, reopenAfterWindow, undoCompleteForMe } from '@/lib/tasks/complete-for-me'
import { apiErrorMessage } from '@/lib/tasks/api-error'
import useCanEditTask from '@/lib/tasks/useCanEditTask'
import TagChip from '@/components/ui/TagChip'
import { PermissionTooltip } from '@/components/ui/permission-tooltip'
import { shouldOfferPushNow, declinePushOffer } from '@/lib/push'
import { CommentBox } from '@/components/ui/comment-box'
import { CommentThread, type ThreadItem } from '@/components/ui/comment-thread'
import PhoneScreen from '../PhoneScreen'
import { PhoneFailedState } from '../PhoneEmptyState'
import { PhoneButton, PhoneLinkButton, ROW, ROW_BLOCK, cx } from '../primitives'
import { APP_BAR_BUTTON } from '../PhoneAppBar'
import { PhoneSheet } from '../PhoneSheet'
import { NotificationOfferSheet } from '../NotificationOfferSheet'
import { FinishTaskSheet } from '../FinishTaskSheet'
import { TaskFilesSection } from '../TaskFilesSection'
import { TaskCcSection } from '../TaskCcSection'
import { TaskReasonSheet } from '../TaskReasonSheet'
import { ActivitySheet } from '../ActivitySheet'
import { useUndoToast } from '../UndoToast'

/*
 * The full task detail screen - plan-phone-2026-10-14.md §5.3, kit §41.6.
 * Replaces slice 3's minimal read-only placeholder.
 *
 *   - App bar: back + three-dot menu sheet: Edit task, Can't complete,
 *     Activity, Details (read-only: who gave it and when) and Delete. Each
 *     mirrors the desktop task page's rule for it; one that applies to the
 *     person but is not allowed is disabled with its reason on tap, one that
 *     cannot apply (Can't complete for a non-assignee) is left out.
 *   - CC people (add / remove) and the task's tags (read-only) sit under the
 *     facts. Reopen after the undo window is creator/admin only, with a reason.
 *   - Title, status badge(s), the 4 key facts, description, checklist
 *     (tickable through the SAME endpoints the Finish sheet uses), "Files &
 *     proof" as one row with a count opening a full-screen files/proof
 *     overlay, comments newest-first 10 at a time with "Show more".
 *   - The primary action (Complete task / Reopen) is a full-width button under
 *     the title and facts - the SAME completion path as My work (FinishTaskSheet
 *     + Undo toast via lib/tasks/finish-rules.ts). The bottom of the screen
 *     belongs to the comment box (KIT-PENDING-phone-inline-comments.md).
 *   - Opening the task (tasksApi.getTask) marks its comments read server
 *     side (tasks.service.ts getTask: TaskView upsert) - no extra call needed.
 *   - Comments are inline under the details (kit comment thread, oldest first,
 *     "Show earlier" 10 at a time) with the kit comment box pinned at the
 *     bottom: grows to 5 lines, Enter = newline, send inside the box. Photos
 *     and files attach with the paperclip through the SAME comment-attachment
 *     endpoint, images shrunk to 1600px (lib/image-resize.ts). @mentions are
 *     DEFERRED - CreateCommentDto/addComment take no mention list, and faking
 *     one client-side would silently fail to notify anyone.
 */

const COMMENTS_PAGE = 10
const COMMENT_MAX = 1000 // CreateCommentDto body @MaxLength(1000)

export default function TaskDetailScreen({ route }: { route: PhoneRoute }) {
  const params = useParams<{ taskId: string }>()
  const taskId = params?.taskId
  const { user } = useAuth()
  const { addToast } = useToast()
  const { showUndo } = useUndoToast()
  const { refresh: refreshBadge } = useTaskBadge()
  const router = useRouter()
  const perms = usePermissions()
  const orgId = user?.organizationId ?? ''
  const userId = user?.id

  const [task, setTask] = React.useState<Task | null>(null)
  const [error, setError] = React.useState(false)
  const [checking, setChecking] = React.useState<Set<string>>(new Set())
  const [sheetOpen, setSheetOpen] = React.useState(false)
  // One panel open at a time: the ... menu and the sheets it leads to.
  const [panel, setPanel] = React.useState<null | 'menu' | 'details' | 'activity' | 'cant' | 'delete' | 'reopen'>(null)
  const [config, setConfig] = React.useState<TaskMasterConfig | null | undefined>(undefined)
  const [, setWindowTick] = React.useState(0)
  const [offerPush, setOfferPush] = React.useState(false)
  const [comments, setComments] = React.useState<TaskComment[] | null>(null)
  const [commentsFailed, setCommentsFailed] = React.useState(false)
  const [commentCount, setCommentCount] = React.useState(COMMENTS_PAGE)
  const [commentText, setCommentText] = React.useState('')
  const [commentFiles, setCommentFiles] = React.useState<UploadItem[]>([])
  const commentFileInput = React.useRef<HTMLInputElement>(null)
  const commentRef = React.useRef<HTMLTextAreaElement>(null)
  // 'done' while the optimistic complete animation/collapse is running, so
  // the row-style strike-through can play before the task state updates.
  const [completing, setCompleting] = React.useState(false)

  const load = React.useCallback(() => {
    if (!orgId || !taskId) return
    tasksApi
      .getTask(orgId, taskId)
      .then(setTask)
      .catch(() => setError(true))
  }, [orgId, taskId])

  React.useEffect(load, [load])

  // Delete's rule needs the org's task config (task_delete_roles), as on desktop.
  React.useEffect(() => {
    if (!orgId) return
    tasksApi.getConfig(orgId).then(setConfig).catch(() => setConfig(null))
  }, [orgId])

  // Re-evaluate who may reopen the moment the undo window ends.
  const reopenExpiresAt = task?.reopen_expires_at
  React.useEffect(() => {
    if (!reopenExpiresAt) return
    const ms = new Date(reopenExpiresAt).getTime() - getNow().getTime()
    if (ms <= 0) return
    const id = setTimeout(() => setWindowTick((n) => n + 1), ms + 50)
    return () => clearTimeout(id)
  }, [reopenExpiresAt])

  // Edit: the same rule the server applies to updateTask (undefined = not known yet).
  const canEditTask = useCanEditTask(task)

  const loadComments = React.useCallback(() => {
    if (!orgId || !taskId) return
    setCommentsFailed(false)
    tasksApi.getComments(orgId, taskId).then(setComments).catch(() => setCommentsFailed(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, taskId])

  React.useEffect(loadComments, [loadComments])

  if (error) {
    return (
      <PhoneScreen title="Task" parent={route.parent ?? PHONE_HOME}>
        <PhoneFailedState what="This task" onRetry={() => { setError(false); load() }} />
        <PhoneLinkButton href={route.parent ?? PHONE_HOME} fullWidth>
          Go to home
        </PhoneLinkButton>
      </PhoneScreen>
    )
  }

  if (!task) {
    return (
      <PhoneScreen title="Task" parent={route.parent ?? PHONE_HOME}>
        <div className="flex flex-col gap-[12px]" aria-hidden>
          <span className="h-[24px] w-2/3 rounded-full bg-surface-control" />
          <span className="h-[16px] w-1/3 rounded-full bg-surface-control" />
        </div>
      </PhoneScreen>
    )
  }

  const assignees = (task.assignees ?? []).filter((a) => !a.is_cc)
  const assigneeLabel =
    assignees.length === 0
      ? '—'
      : assignees.length === 1
        ? assignees[0].user_name ?? assignees[0].user?.name ?? '—'
        : `${assignees[0].user_name ?? assignees[0].user?.name ?? 'Someone'} +${assignees.length - 1}`

  const facts: { label: string; value: string }[] = [
    { label: 'Given by', value: task.created_by?.name ?? '—' },
    { label: assignees.length === 1 ? 'Assignee' : 'Assignees', value: assigneeLabel },
    { label: 'Due', value: task.deadline ? fmtDue(task.deadline) : 'No deadline' },
    { label: 'Priority', value: task.priority?.label ?? '—' },
  ]

  const myAssignment = assignees.find((a) => a.user_id === userId)
  const sharedDone = task.status?.type ? TERMINAL_STATUS_PHASES.includes(task.status.type) : false
  const isAssignee = !!myAssignment
  // Whether THIS viewer's part is already done (drives "Complete task" vs "Undo"/"Reopen").
  const myPartDone = task.completion_mode === 'all_must_complete' ? !!myAssignment?.is_completed : sharedDone

  // Desktop page.tsx: canEdit (~835) = creator or admin; canManageCc (~846) = (that, or on the
  // task as assignee or CC) and not a simulated-future task and not closed; canDelete (~772).
  const isCreator = task.created_by_user_id === userId
  const isAdminUser = !!user?.is_admin || perms.isAdmin
  const isFutureTask = new Date(task.created_at) > getNow()
  const isCc = (task.assignees ?? []).some((a) => a.user_id === userId && a.is_cc)
  const canManageCc = (isCreator || isAdminUser || isAssignee || isCc) && !isFutureTask && !sharedDone
  const canDelete: boolean | undefined = user?.is_admin
    ? true
    : config === undefined
      ? undefined
      : (config?.task_delete_roles ?? []).includes('employee')
  const allMust = task.completion_mode === 'all_must_complete'
  // Can't complete: desktop's "Can't complete (my part)" / "mark incomplete" (~1099-1132). An open
  // task, an assignee whose part is not already finished or flagged.
  const canCantComplete = isAssignee && !isFutureTask && !sharedDone && !myAssignment?.is_completed && !myAssignment?.cannot_complete
  // Reopen (backend reopenTask ~3528-3550): inside the undo window any participant reverses a
  // closure with no reason; after it only the creator or an admin may, with a reason. In
  // all_must_complete an assignee can also take back just their own finished part (~937-960).
  const windowOpen = isUndoWindowOpen(task)
  const reopenKind: 'direct' | 'reason' | null = sharedDone
    ? windowOpen && (isAssignee || isCreator || isAdminUser)
      ? 'direct'
      : isCreator || isAdminUser
        ? 'reason'
        : null
    : allMust && !!myAssignment?.is_completed
      ? 'direct'
      : null
  const partReopen = allMust && !!myAssignment?.is_completed
  const tags = task.tags ?? []

  // Oldest first; "Show earlier" adds 10 older ones at the top.
  const orderedComments = (comments ?? []).slice().sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  const visibleComments = orderedComments.slice(Math.max(0, orderedComments.length - commentCount))
  const totalCommentCount = comments?.length ?? task._count?.comments ?? 0

  /** Reopen with no reason (inside the undo window, or just my own part). Shows the server's message if refused. */
  async function reopenNow() {
    if (!task) return
    try {
      if (partReopen) await undoCompleteForMe(orgId, task)
      else await tasksApi.reopenTask(orgId, task.id)
      load()
      void refreshBadge()
    } catch (e) {
      addToast(apiErrorMessage(e, 'Could not reopen the task. Try again.'), 'error')
      load()
    }
  }

  /** Switches to another panel once the current sheet has finished closing (each sheet owns a history entry). */
  function goPanel(next: 'details' | 'activity' | 'cant' | 'delete' | 'reopen') {
    setPanel(null)
    window.setTimeout(() => setPanel(next), 250)
  }

  function updateTask(updated: Task) {
    setTask(updated)
  }

  // The same completion + undo calls My work uses (lib/tasks/complete-for-me.ts).
  const callComplete = (current: Task) => completeForMe(orgId, current)
  const callUndo = (current: Task) => undoCompleteForMe(orgId, current)

  function completeOptimistically() {
    if (!task) return
    const previous = task
    setCompleting(true)
    const apiCall = callComplete(previous)

    apiCall
      .then((updated) => {
        setTask(updated)
        void refreshBadge()
        showUndo(COMPLETED_UNDO_MESSAGE, async () => {
          try {
            await callUndo(previous)
            load()
            void refreshBadge()
          } catch {
            addToast('Could not undo. Reopen the task below instead.', 'error')
          }
        })
      })
      .catch(() => {
        setTask(previous)
        addToast('Could not complete the task. Try again.', 'error')
      })
      .finally(() => setCompleting(false))
  }

  function onTapComplete() {
    if (completing || !task) return
    if (canQuickComplete(task, userId)) completeOptimistically()
    else setSheetOpen(true)
  }

  /** Posts the comment from the pinned box. Throws (so the box keeps the text and toasts) when the comment itself fails. */
  async function sendComment() {
    if (!task) return
    const text = commentText.trim()
    if (!text || text.length > COMMENT_MAX) return
    let created: TaskComment
    try {
      created = await tasksApi.addComment(orgId, task.id, text)
    } catch {
      throw new Error('Could not post the comment. Try again.')
    }
    let failed = 0
    for (const item of commentFiles) {
      try {
        const shrunk = await shrinkImageForUpload(item.file)
        await tasksApi.uploadCommentAttachment(orgId, task.id, created.id, shrunk)
      } catch {
        failed += 1
      }
    }
    if (commentFiles.length > 0) {
      // The files are on the server now: reload once so the comment shows them. Same row keys, so nothing flickers.
      const fresh = await tasksApi.getComments(orgId, task.id).catch(() => null)
      setComments(fresh ?? ((prev) => [...(prev ?? []), created]))
    } else {
      setComments((prev) => [...(prev ?? []), created])
    }
    setCommentText('')
    setCommentFiles([])
    if (failed > 0) addToast(`Comment posted, but ${failed} file${failed === 1 ? '' : 's'} failed to upload. Add them from Files & proof.`, 'error')
    // Show the new comment above the box.
    requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' }))
    // Sending a comment is a reply you'd want to hear back about (plan 9, kit 41.12 rule 4) - offer once, at most.
    if (shouldOfferPushNow(userId)) setOfferPush(true)
  }

  async function toggleChecklistItem(item: TaskChecklistItem) {
    if (checking.has(item.id) || !task) return
    setChecking((s) => new Set(s).add(item.id))
    try {
      const unfinishedBefore = unfinishedChecklistItems(task).some((i) => i.id === item.id)
      const updated = unfinishedBefore
        ? await tasksApi.checkChecklistItem(orgId, task.id, item.id)
        : await tasksApi.uncheckChecklistItem(orgId, task.id, item.id)
      setTask(updated)
    } catch {
      addToast('Could not update the checklist. Try again.', 'error')
    } finally {
      setChecking((s) => {
        const next = new Set(s)
        next.delete(item.id)
        return next
      })
    }
  }

  // Only the people doing the task tick its checklist (tasks.service.ts). Anyone
  // else sees it read-only, with who ticks it and how far it has got - never
  // circles that look tappable and silently do nothing.
  const checklistReadOnlyNote = !isAssignee ? checklistNote(task) : null

  return (
    <PhoneScreen
      title="Task"
      parent={route.parent ?? PHONE_HOME}
      actions={
        <button type="button" aria-label="More options" className={APP_BAR_BUTTON} onClick={() => setPanel('menu')}>
          <Ellipsis aria-hidden />
        </button>
      }
    >
      <div className="flex flex-col gap-[20px]">
        {task.status ? (
          <span
            className="inline-flex w-fit items-center rounded-full px-[10px] py-[2px] text-label font-medium"
            style={{ backgroundColor: `${task.status.color}22`, color: task.status.color }}
          >
            {task.status.label}
          </span>
        ) : null}

        <h1 className="whitespace-pre-wrap text-page-title font-medium text-text-primary">{task.title}</h1>

        <dl className="grid grid-cols-2 gap-y-[12px] gap-x-[12px]">
          {facts.map((f) => (
            <div key={f.label} className="flex flex-col gap-[2px]">
              <dt className="text-meta text-text-secondary">{f.label}</dt>
              <dd className="truncate text-body text-text-primary">{f.value}</dd>
            </div>
          ))}
        </dl>

        {reopenKind ? (
          <PhoneButton type="button" variant="secondary" fullWidth onClick={() => (reopenKind === 'reason' ? setPanel('reopen') : void reopenNow())}>
            Reopen task
          </PhoneButton>
        ) : isAssignee && !myPartDone && !sharedDone ? (
          <PhoneButton type="button" variant="primary" fullWidth loading={completing} onClick={onTapComplete}>
            Complete task
          </PhoneButton>
        ) : isAssignee && sharedDone ? (
          <p className="text-label text-text-secondary">This task is closed. Only the person who gave it, or an admin, can reopen it.</p>
        ) : null}

        {tags.length > 0 ? (
          <section className="flex flex-col gap-[8px]">
            <h2 className="text-label font-medium text-text-secondary">Tags</h2>
            <div className="flex flex-wrap gap-[8px]">
              {tags.map((t) => (
                <TagChip key={t.id} tag={t} size="md" />
              ))}
            </div>
          </section>
        ) : null}

        <TaskCcSection orgId={orgId} task={task} canManage={canManageCc} onTaskUpdate={updateTask} />

        {task.description ? (
          <div className="flex flex-col gap-[4px]">
            <h2 className="text-label font-medium text-text-secondary">Description</h2>
            <p className="whitespace-pre-wrap text-body text-text-primary">{task.description}</p>
          </div>
        ) : null}

        {(task.checklist ?? []).length > 0 ? (
          <section className="flex flex-col gap-[8px]">
            <h2 className="text-label font-medium text-text-secondary">Checklist</h2>
            {checklistReadOnlyNote ? <p className="text-label text-text-secondary">{checklistReadOnlyNote}</p> : null}
            <ul className={ROW_BLOCK}>
              {(task.checklist ?? []).map((item) => {
                const done =
                  task.completion_mode === 'all_must_complete' ? item.my_state === 'done' || item.my_state === 'skipped' : !!item.is_completed
                return (
                  <li key={item.id}>
                    <ChecklistItemShell
                      readOnly={!isAssignee}
                      busy={checking.has(item.id)}
                      onToggle={() => void toggleChecklistItem(item)}
                    >
                      <span
                        aria-hidden
                        className={cx(
                          'flex size-[22px] shrink-0 items-center justify-center rounded-full border-2',
                          done ? 'border-primary bg-primary' : 'border-border-strong bg-transparent',
                        )}
                      >
                        {done ? (
                          <svg viewBox="0 0 16 16" className="size-[12px] text-primary-foreground" fill="none">
                            <path d="M3 8.5L6.2 11.5L13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        ) : null}
                      </span>
                      <span className={cx('min-w-0 flex-1 truncate text-body text-text-primary', done && 'text-text-muted line-through')}>
                        {item.title}
                      </span>
                    </ChecklistItemShell>
                  </li>
                )
              })}
            </ul>
          </section>
        ) : null}

        <TaskFilesSection orgId={orgId} task={task} onTaskUpdate={updateTask} />

        <section className="flex flex-col gap-[8px]">
          <h2 className="text-label font-medium text-text-secondary">
            Comments{totalCommentCount > 0 ? ` (${totalCommentCount})` : ''}
          </h2>
          {commentsFailed ? (
            <div className="flex flex-col items-start gap-[8px]">
              <p className="text-body text-text-secondary">Comments could not be loaded. Check your connection, then try again.</p>
              <PhoneButton variant="secondary" onClick={loadComments}>
                Try again
              </PhoneButton>
            </div>
          ) : (
          <CommentThread
            followLatest={false}
            loading={comments === null}
            hasEarlier={orderedComments.length > commentCount}
            onShowEarlier={() => setCommentCount((n) => n + COMMENTS_PAGE)}
            onWrite={() => commentRef.current?.focus()}
            items={visibleComments.map((c): ThreadItem => ({
              id: c.id,
              who: c.user_name ?? 'Someone',
              when: c.created_at,
              text: c.body,
              attachments:
                (c.attachments ?? []).length > 0 ? (
                  <div className="flex flex-wrap gap-[8px]">
                    {(c.attachments ?? []).map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => tasksApi.downloadAttachment(orgId, task.id, a.id)}
                        className="inline-flex min-h-[44px] items-center gap-[4px] rounded-[6px] border border-border-light px-[8px] py-[4px] text-label text-text-secondary"
                      >
                        <Paperclip aria-hidden className="size-[12px]" />
                        <span className="max-w-[160px] truncate">{a.file_name}</span>
                      </button>
                    ))}
                  </div>
                ) : undefined,
            }))}
          />
          )}
        </section>
      </div>

      <input
        ref={commentFileInput}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files ? Array.from(e.target.files) : []
          if (picked.length) setCommentFiles((prev) => [...prev, ...picked.map(newUpload)])
          e.target.value = ''
        }}
      />
      <CommentBox
        value={commentText}
        onChange={(t) => setCommentText(t.slice(0, COMMENT_MAX))}
        maxLength={COMMENT_MAX}
        onSend={sendComment}
        textareaRef={commentRef}
        placeholder="Write a comment…"
        attachments={
          commentFiles.length > 0 ? (
            <UploadRows items={commentFiles} onRetry={() => {}} onRemove={(id) => setCommentFiles((prev) => prev.filter((u) => u.id !== id))} />
          ) : undefined
        }
        tools={
          <button
            type="button"
            aria-label="Attach photo or file"
            onClick={() => commentFileInput.current?.click()}
            className="inline-flex size-[44px] shrink-0 items-center justify-center rounded-full text-text-secondary active:bg-surface-control"
          >
            <Paperclip aria-hidden className="size-[20px]" />
          </button>
        }
      />

      <FinishTaskSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        orgId={orgId}
        userId={userId}
        task={task}
        onTaskUpdate={updateTask}
        onComplete={() => {
          setSheetOpen(false)
          completeOptimistically()
        }}
      />

      <PhoneSheet open={panel === 'menu'} onOpenChange={(o) => !o && setPanel(null)} title="More">
        <ul className={ROW_BLOCK}>
          <MenuItem
            icon={<Pencil aria-hidden />}
            label="Edit task"
            allowed={canEditTask}
            reason="Only people allowed to edit this task can change it"
            onClick={() => router.push(taskEditHref(task.id))}
          />
          {canCantComplete ? (
            <MenuItem icon={<XCircle aria-hidden />} label="Can't complete" onClick={() => goPanel('cant')} />
          ) : null}
          <MenuItem icon={<History aria-hidden />} label="Activity" onClick={() => goPanel('activity')} />
          <MenuItem icon={<Info aria-hidden />} label="Details" onClick={() => goPanel('details')} />
          <MenuItem
            icon={<Trash2 aria-hidden />}
            label="Delete task"
            danger
            allowed={canDelete}
            reason="Only people allowed to delete tasks can do this"
            onClick={() => goPanel('delete')}
          />
        </ul>
      </PhoneSheet>

      <PhoneSheet open={panel === 'details'} onOpenChange={(o) => !o && setPanel(null)} title="Details">
        <dl className="flex flex-col gap-[12px]">
          <Detail label="Given by" value={task.created_by?.name ?? '—'} />
          <Detail label="Created" value={fmtDateTime(task.created_at)} />
          <Detail label="Last updated" value={fmtDateTime(task.updated_at)} />
          {task.completed_at ? <Detail label="Completed" value={fmtDateTime(task.completed_at)} /> : null}
        </dl>
      </PhoneSheet>

      <ActivitySheet open={panel === 'activity'} onOpenChange={(o) => !o && setPanel(null)} orgId={orgId} taskId={task.id} />

      <TaskReasonSheet
        open={panel === 'reopen'}
        onOpenChange={(o) => !o && setPanel(null)}
        title="Reopen task"
        intro="The undo window has ended, so reopening needs a reason. It is recorded in the activity."
        placeholder="For example, the work needs another pass"
        confirmLabel="Reopen task"
        busyLabel="Reopening…"
        onConfirm={async (reason) => {
          await reopenAfterWindow(orgId, task.id, reason)
          load()
          void refreshBadge()
        }}
      />

      <TaskReasonSheet
        open={panel === 'cant'}
        onOpenChange={(o) => !o && setPanel(null)}
        title="Can't complete"
        intro={
          allMust
            ? 'This closes only your part as not done. The person who gave the task is told why.'
            : 'This closes the whole task as incomplete. The person who gave the task is told why.'
        }
        placeholder="For example, I am waiting on a supplier"
        confirmLabel={allMust ? 'Flag my part' : 'Mark incomplete'}
        busyLabel="Saving…"
        onConfirm={async (reason) => {
          // Desktop: all_must_complete flags my part (flagCannotComplete); otherwise any assignee closes the task incomplete.
          const updated = allMust
            ? await tasksApi.flagCannotComplete(orgId, task.id, reason)
            : await tasksApi.markIncomplete(orgId, task.id, reason)
          setTask(updated)
          load()
          void refreshBadge()
        }}
      />

      <TaskReasonSheet
        open={panel === 'delete'}
        onOpenChange={(o) => !o && setPanel(null)}
        title="Delete task"
        intro="This deletes the task for everyone and cannot be undone."
        placeholder="Why is it being deleted?"
        confirmLabel="Delete task"
        busyLabel="Deleting…"
        destructive
        onConfirm={async (reason) => {
          await tasksApi.deleteTask(orgId, task.id, reason)
          void refreshBadge()
          addToast('Task deleted', 'success')
          router.replace(route.parent ?? PHONE_HOME)
        }}
      />

      <NotificationOfferSheet
        orgId={orgId}
        open={offerPush}
        onOpenChange={setOfferPush}
        onDeclined={() => declinePushOffer(userId)}
      />
    </PhoneScreen>
  )
}

/**
 * One row of the ... menu. `allowed` false: disabled, its reason on tap
 * (kit 41.8 rule 17); undefined: disabled with no reason yet (not known is
 * not "not allowed"); omitted: always available.
 */
function MenuItem({
  icon,
  label,
  onClick,
  danger = false,
  allowed = true,
  reason = '',
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
  allowed?: boolean | undefined
  reason?: string
}) {
  return (
    <li className="[&>span]:flex [&>span]:w-full">
      <PermissionTooltip allowed={allowed} reason={reason}>
        <button
          type="button"
          disabled={allowed !== true}
          onClick={onClick}
          className={cx(ROW, '[&_svg]:size-[20px] [&_svg]:shrink-0', danger && 'text-danger', 'disabled:pointer-events-none disabled:text-text-muted')}
        >
          {icon}
          {label}
        </button>
      </PermissionTooltip>
    </li>
  )
}

/** A checklist row: a button for whoever may tick it, a plain row for everyone else. */
function ChecklistItemShell({
  readOnly,
  busy,
  onToggle,
  children,
}: {
  readOnly: boolean
  busy: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  const className = 'flex min-h-[48px] w-full items-center gap-[12px] px-[16px] py-[10px] text-left'
  if (readOnly) return <div className={className}>{children}</div>
  return (
    <button type="button" onClick={onToggle} disabled={busy} className={cx(className, 'active:bg-surface-control disabled:opacity-100')}>
      {children}
    </button>
  )
}

function checklistNote(task: Task): string {
  const items = task.checklist ?? []
  const done = items.filter((i) => i.is_completed).length
  const workers = (task.assignees ?? []).filter((a) => !a.is_cc)
  const who = workers.length === 1 ? workers[0].user?.name ?? workers[0].user_name ?? 'The assignee' : 'The assignees'
  const progress = task.completion_mode === 'all_must_complete' && workers.length > 1 ? '' : ` · ${done} of ${items.length} done`
  return `${who} ticks these off as they work${progress}`
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-[2px]">
      <dt className="text-meta text-text-secondary">{label}</dt>
      <dd className="text-body text-text-primary">{value}</dd>
    </div>
  )
}

/**
 * A full-screen takeover with its own header and a back/close arrow, used
 * for "Add comment" and "Files & proof" (kit §41.6/41.16: both are a full
 * screen, not a sheet). Kept as an in-screen overlay rather than a new route:
 * no new Next.js page exists for a dynamic task's sub-path, and this is
 * functionally identical for the person using it - its own header, its own
 * scroll, and closing returns to the task exactly like a route's back arrow.
 */
function FullScreenOverlay({ title, onClose, footer, children }: { title: string; onClose: () => void; footer?: React.ReactNode; children: React.ReactNode }) {
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])
  const onCloseRef = React.useRef(onClose)
  onCloseRef.current = onClose

  // Android/back-gesture: one history entry while open, same pattern as PhoneSheet.
  React.useEffect(() => {
    window.history.pushState({ ...(window.history.state ?? {}), kitLayer: true }, '', window.location.href)
    const onPop = () => onCloseRef.current()
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
    }
  }, [])

  function close() {
    onClose()
    if ((window.history.state as { kitLayer?: boolean } | null)?.kitLayer) window.history.back()
  }

  if (!mounted) return null
  return createPortal(
    // The overlay's bottom edge follows --keyboard-inset (lib/keyboard.ts, kit
    // 41.13 rule 6), so a footer - the comment composer - sits directly above
    // the on-screen keyboard on iPhone. Android resizes the layout viewport
    // itself and the inset stays ~0.
    <div className="fixed inset-x-0 top-0 bottom-(--keyboard-inset) z-75 flex flex-col bg-surface-sunken">
      <header
        className={cx(
          'sticky top-0 z-10 flex h-(--spacing-topbar) shrink-0 items-center gap-[8px] bg-primary text-on-brand',
          'pt-(--safe-top) pl-[max(4px,var(--safe-left))] pr-[max(16px,var(--safe-right))]',
        )}
      >
        <button type="button" aria-label="Close" onClick={close} className={APP_BAR_BUTTON}>
          <X aria-hidden />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-bar-title font-medium">{title}</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-[16px] pb-[16px] pt-[16px]">{children}</div>
      {footer ? <div className="shrink-0">{footer}</div> : null}
    </div>,
    document.body,
  )
}

/** One file being uploaded: its own row, progress and Retry (kit §41.16). */
type UploadItem = {
  id: string
  file: File
  progress: number
  status: 'queued' | 'uploading' | 'done' | 'failed'
}

function newUpload(file: File): UploadItem {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file, progress: 0, status: 'queued' }
}

function UploadRows({ items, onRetry, onRemove }: { items: UploadItem[]; onRetry: (id: string) => void; onRemove?: (id: string) => void }) {
  if (items.length === 0) return null
  return (
    <ul className="flex flex-col gap-[8px]">
      {items.map((u) => (
        <li key={u.id} className="flex min-h-[44px] items-center gap-[8px] rounded-[8px] border border-border-light bg-surface px-[12px] py-[6px]">
          <Paperclip aria-hidden className="size-[16px] shrink-0 text-text-secondary" />
          <span className="min-w-0 flex-1 truncate text-label text-text-primary">{u.file.name}</span>
          {u.status === 'uploading' ? (
            <span className="shrink-0 text-meta text-text-secondary">{u.progress}%</span>
          ) : u.status === 'done' ? (
            <span className="shrink-0 text-label font-medium text-success">Done</span>
          ) : u.status === 'failed' ? (
            <button
              type="button"
              onClick={() => onRetry(u.id)}
              className="inline-flex min-h-[44px] shrink-0 items-center gap-[4px] rounded-[6px] px-[8px] text-label font-medium text-danger active:bg-danger-bg"
            >
              <RotateCcw aria-hidden className="size-[14px]" />
              Retry
            </button>
          ) : onRemove ? (
            <button type="button" aria-label={`Remove ${u.file.name}`} onClick={() => onRemove(u.id)} className="inline-flex size-[44px] shrink-0 items-center justify-center rounded-full active:bg-surface-control">
              <X aria-hidden className="size-[16px] text-text-secondary" />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

