'use client'

import { fmtDateTime, fmtDue } from '@/lib/phone-format'
import React from 'react'
import { createPortal } from 'react-dom'
import { useParams } from 'next/navigation'
import { Ellipsis, Paperclip, RotateCcw, Send, X } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useToast } from '@/components/ui/Toast'
import { tasksApi } from '@/lib/api/tasks'
import type { Task, TaskComment, TaskChecklistItem } from '@/lib/types/tasks'
import { TERMINAL_STATUS_PHASES } from '@/lib/types/tasks'
import { PHONE_HOME, type PhoneRoute } from '@/lib/phone-routes'
import { shrinkImageForUpload } from '@/lib/image-resize'
import { canQuickComplete, unfinishedChecklistItems } from '@/lib/tasks/finish-rules'
import { useTaskBadge } from '@/lib/task-badge'
import { COMPLETED_UNDO_MESSAGE, completeForMe, undoCompleteForMe } from '@/lib/tasks/complete-for-me'
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
import { useUndoToast } from '../UndoToast'

/*
 * The full task detail screen - plan-phone-2026-10-14.md §5.3, kit §41.6.
 * Replaces slice 3's minimal read-only placeholder.
 *
 *   - App bar: back + three-dot menu (a read-only "Details" sheet: who gave
 *     it, when, and its id - nothing invented beyond what the record has).
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
  const orgId = user?.organizationId ?? ''
  const userId = user?.id

  const [task, setTask] = React.useState<Task | null>(null)
  const [error, setError] = React.useState(false)
  const [checking, setChecking] = React.useState<Set<string>>(new Set())
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const [detailsOpen, setDetailsOpen] = React.useState(false)
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
  const [reopening, setReopening] = React.useState(false)
  const [reopenError, setReopenError] = React.useState(false)

  const load = React.useCallback(() => {
    if (!orgId || !taskId) return
    tasksApi
      .getTask(orgId, taskId)
      .then(setTask)
      .catch(() => setError(true))
  }, [orgId, taskId])

  React.useEffect(load, [load])

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

  // Oldest first; "Show earlier" adds 10 older ones at the top.
  const orderedComments = (comments ?? []).slice().sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  const visibleComments = orderedComments.slice(Math.max(0, orderedComments.length - commentCount))
  const totalCommentCount = comments?.length ?? task._count?.comments ?? 0

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
    // Only files not yet tied to a posted comment go with this one; failed ones from an earlier send stay put with their own Try again.
    const toSend = commentFiles.filter((f) => !f.commentId)
    let failed = 0
    for (const item of toSend) {
      patchCommentFile(item.id, { status: 'uploading', commentId: created.id })
      try {
        const shrunk = await shrinkImageForUpload(item.file)
        await tasksApi.uploadCommentAttachment(orgId, task.id, created.id, shrunk)
        setCommentFiles((prev) => prev.filter((u) => u.id !== item.id))
      } catch {
        failed += 1
        patchCommentFile(item.id, { status: 'failed' })
      }
    }
    if (toSend.length > 0) {
      // The files are on the server now: reload once so the comment shows them. Same row keys, so nothing flickers.
      const fresh = await tasksApi.getComments(orgId, task.id).catch(() => null)
      setComments(fresh ?? ((prev) => [...(prev ?? []), created]))
    } else {
      setComments((prev) => [...(prev ?? []), created])
    }
    setCommentText('')
    if (failed > 0) addToast(`Comment posted, but ${failed} file${failed === 1 ? '' : 's'} could not be uploaded. Use Try again on the file.`, 'error')
    // Show the new comment above the box.
    requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' }))
    // Sending a comment is a reply you'd want to hear back about (plan 9, kit 41.12 rule 4) - offer once, at most.
    if (shouldOfferPushNow(userId)) setOfferPush(true)
  }

  function patchCommentFile(id: string, change: Partial<UploadItem>) {
    setCommentFiles((prev) => prev.map((u) => (u.id === id ? { ...u, ...change } : u)))
  }

  /** Re-uploads one file that failed to attach to an already-posted comment. */
  async function retryCommentFile(id: string) {
    const item = commentFiles.find((u) => u.id === id)
    if (!item || !item.commentId || item.status === 'uploading') return
    const commentId = item.commentId
    patchCommentFile(id, { status: 'uploading' })
    try {
      const shrunk = await shrinkImageForUpload(item.file)
      await tasksApi.uploadCommentAttachment(orgId, task!.id, commentId, shrunk)
      setCommentFiles((prev) => prev.filter((u) => u.id !== id))
      const fresh = await tasksApi.getComments(orgId, task!.id).catch(() => null)
      if (fresh) setComments(fresh)
    } catch {
      patchCommentFile(id, { status: 'failed' })
      addToast('The file could not be uploaded. Try again.', 'error')
    }
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
        <button type="button" aria-label="More options" className={APP_BAR_BUTTON} onClick={() => setDetailsOpen(true)}>
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

        {isAssignee ? (
          myPartDone ? (
            <PhoneButton
              type="button"
              variant="secondary"
              fullWidth
              loading={reopening}
              onClick={() => {
                if (reopening) return
                setReopening(true)
                setReopenError(false)
                callUndo(task)
                  .then(() => {
                    load()
                    void refreshBadge()
                  })
                  .catch(() => {
                    setReopenError(true)
                    addToast('Could not reopen the task. Try again.', 'error')
                  })
                  .finally(() => setReopening(false))
              }}
            >
              {reopening ? 'Reopening…' : reopenError ? 'Try again' : 'Reopen task'}
            </PhoneButton>
          ) : (
            <PhoneButton type="button" variant="primary" fullWidth loading={completing} onClick={onTapComplete}>
              Complete task
            </PhoneButton>
          )
        ) : null}

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
            <UploadRows items={commentFiles} onRetry={(id) => void retryCommentFile(id)} onRemove={(id) => setCommentFiles((prev) => prev.filter((u) => u.id !== id))} />
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

      <PhoneSheet open={detailsOpen} onOpenChange={setDetailsOpen} title="Details">
        <dl className="flex flex-col gap-[12px]">
          <Detail label="Given by" value={task.created_by?.name ?? '—'} />
          <Detail label="Created" value={fmtDateTime(task.created_at)} />
          <Detail label="Last updated" value={fmtDateTime(task.updated_at)} />
          {task.completed_at ? <Detail label="Completed" value={fmtDateTime(task.completed_at)} /> : null}
        </dl>
      </PhoneSheet>

      <NotificationOfferSheet
        orgId={orgId}
        open={offerPush}
        onOpenChange={setOfferPush}
        onDeclined={() => declinePushOffer(userId)}
      />
    </PhoneScreen>
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
  /** Set once the comment this file belongs to is posted: a retry attaches to that comment. */
  commentId?: string
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
            <span className="shrink-0 text-meta text-text-secondary">Uploading…</span>
          ) : u.status === 'done' ? (
            <span className="shrink-0 text-label font-medium text-success">Done</span>
          ) : u.status === 'failed' ? (
            <>
              <span className="shrink-0 text-meta text-danger">Upload failed</span>
              <button
                type="button"
                onClick={() => onRetry(u.id)}
                className="inline-flex min-h-[44px] shrink-0 items-center gap-[4px] rounded-[6px] px-[8px] text-label font-medium text-danger active:bg-danger-bg"
              >
                <RotateCcw aria-hidden className="size-[14px]" />
                Try again
              </button>
              {onRemove ? (
                <button type="button" aria-label={`Remove ${u.file.name}`} onClick={() => onRemove(u.id)} className="inline-flex size-[44px] shrink-0 items-center justify-center rounded-full active:bg-surface-control">
                  <X aria-hidden className="size-[16px] text-text-secondary" />
                </button>
              ) : null}
            </>
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

