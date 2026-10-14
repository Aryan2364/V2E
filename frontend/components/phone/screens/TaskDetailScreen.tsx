'use client'

import { fmtDateTime, fmtDue } from '@/lib/phone-format'
import React from 'react'
import { createPortal } from 'react-dom'
import { useParams } from 'next/navigation'
import { Camera, ChevronRight, FileUp, MoreVertical, Paperclip, RotateCcw, Send, X } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useToast } from '@/components/ui/Toast'
import { tasksApi } from '@/lib/api/tasks'
import type { Task, TaskAttachment, TaskComment, TaskChecklistItem } from '@/lib/types/tasks'
import { TERMINAL_STATUS_PHASES } from '@/lib/types/tasks'
import { PHONE_HOME, type PhoneRoute } from '@/lib/phone-routes'
import { shrinkImageForUpload } from '@/lib/image-resize'
import { canQuickComplete, unfinishedChecklistItems } from '@/lib/tasks/finish-rules'
import { useTaskBadge } from '@/lib/task-badge'
import { detectPlatform, isInstalledApp } from '@/lib/install'
import { COMPLETED_UNDO_MESSAGE, completeForMe, undoCompleteForMe } from '@/lib/tasks/complete-for-me'
import { shouldOfferPushNow, declinePushOffer } from '@/lib/push'
import PhoneScreen from '../PhoneScreen'
import { PhoneEmptyState } from '../PhoneEmptyState'
import { PhoneButton, PhoneLinkButton, ROW, ROW_BLOCK, cx } from '../primitives'
import { APP_BAR_BUTTON } from '../PhoneAppBar'
import { PhoneSheet } from '../PhoneSheet'
import { NotificationOfferSheet } from '../NotificationOfferSheet'
import { FinishTaskSheet } from '../FinishTaskSheet'
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
 *   - Action bar: the SAME completion path as My work (FinishTaskSheet +
 *     Undo toast via lib/tasks/finish-rules.ts) - no second mechanism.
 *   - Opening the task (tasksApi.getTask) marks its comments read server
 *     side (tasks.service.ts getTask: TaskView upsert) - no extra call needed.
 *   - "Add comment" opens a full-screen compose overlay (CommentComposeOverlay
 *     below): message grows to 5 lines then scrolls, Enter = newline, a
 *     dedicated Send button, photo/file attach via the SAME comment-attachment
 *     endpoint, images shrunk to 1600px (lib/image-resize.ts). @mentions are
 *     DEFERRED - CreateCommentDto/addComment take no mention list, and faking
 *     one client-side would silently fail to notify anyone.
 */

const COMMENTS_PAGE = 10

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
  const [panel, setPanel] = React.useState<'comments' | 'files' | null>(null)
  const [offerPush, setOfferPush] = React.useState(false)
  const [comments, setComments] = React.useState<TaskComment[] | null>(null)
  const [commentCount, setCommentCount] = React.useState(COMMENTS_PAGE)
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

  const loadComments = React.useCallback(() => {
    if (!orgId || !taskId) return
    tasksApi.getComments(orgId, taskId).then(setComments).catch(() => addToast('Comments could not be loaded.', 'error'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, taskId])

  React.useEffect(loadComments, [loadComments])

  if (error) {
    return (
      <PhoneScreen title="Task" parent={route.parent ?? PHONE_HOME}>
        <PhoneEmptyState
          icon={<span aria-hidden>!</span>}
          heading="This task could not be opened"
          line="It may have been removed, or you may no longer have access to it."
        >
          <PhoneLinkButton href={route.parent ?? PHONE_HOME} fullWidth>
            Go to My work
          </PhoneLinkButton>
        </PhoneEmptyState>
      </PhoneScreen>
    )
  }

  if (!task) {
    return (
      <PhoneScreen title="Task" parent={route.parent ?? PHONE_HOME}>
        <div className="flex flex-col gap-[12px]" aria-hidden>
          <span className="h-[24px] w-2/3 rounded-full bg-phone-surface-control" />
          <span className="h-[16px] w-1/3 rounded-full bg-phone-surface-control" />
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

  const filesCount = (task._count?.attachments ?? 0)
  const visibleComments = (comments ?? []).slice(0, commentCount)
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
      title={task.title}
      parent={route.parent ?? PHONE_HOME}
      actions={
        <button type="button" aria-label="More options" className={APP_BAR_BUTTON} onClick={() => setDetailsOpen(true)}>
          <MoreVertical aria-hidden />
        </button>
      }
    >
      <div className="flex flex-col gap-[20px] pb-[80px]">
        {task.status ? (
          <span
            className="inline-flex w-fit items-center rounded-full px-[10px] py-[2px] text-phone-label font-semibold"
            style={{ backgroundColor: `${task.status.color}22`, color: task.status.color }}
          >
            {task.status.label}
          </span>
        ) : null}

        <h1 className="whitespace-pre-wrap text-phone-page-title font-semibold text-phone-text-primary">{task.title}</h1>

        <dl className="grid grid-cols-2 gap-y-[12px] gap-x-[12px]">
          {facts.map((f) => (
            <div key={f.label} className="flex flex-col gap-[2px]">
              <dt className="text-phone-meta text-phone-text-secondary">{f.label}</dt>
              <dd className="truncate text-phone-body text-phone-text-primary">{f.value}</dd>
            </div>
          ))}
        </dl>

        {task.description ? (
          <div className="flex flex-col gap-[4px]">
            <h2 className="text-phone-label font-medium text-phone-text-secondary">Description</h2>
            <p className="whitespace-pre-wrap text-phone-body text-phone-text-primary">{task.description}</p>
          </div>
        ) : null}

        {(task.checklist ?? []).length > 0 ? (
          <section className="flex flex-col gap-[8px]">
            <h2 className="text-phone-label font-medium text-phone-text-secondary">Checklist</h2>
            {checklistReadOnlyNote ? <p className="text-phone-label text-phone-text-secondary">{checklistReadOnlyNote}</p> : null}
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
                          done ? 'border-phone-primary bg-phone-primary' : 'border-phone-border-strong bg-transparent',
                        )}
                      >
                        {done ? (
                          <svg viewBox="0 0 16 16" className="size-[12px] text-phone-primary-foreground" fill="none">
                            <path d="M3 8.5L6.2 11.5L13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        ) : null}
                      </span>
                      <span className={cx('min-w-0 flex-1 truncate text-phone-body text-phone-text-primary', done && 'text-phone-text-muted line-through')}>
                        {item.title}
                      </span>
                    </ChecklistItemShell>
                  </li>
                )
              })}
            </ul>
          </section>
        ) : null}

        <section className="flex flex-col gap-[8px]">
          <h2 className="text-phone-label font-medium text-phone-text-secondary">Files &amp; proof</h2>
          {filesCount === 0 ? (
            // Nothing to list yet: one plain action instead of an empty bordered row.
            <button
              type="button"
              onClick={() => setPanel('files')}
              className="flex min-h-[44px] items-center gap-[8px] self-start text-phone-body font-semibold text-phone-primary-text"
            >
              <Paperclip aria-hidden className="size-[18px] shrink-0" />
              Add file or proof
            </button>
          ) : (
            <div className={ROW_BLOCK}>
              <button type="button" onClick={() => setPanel('files')} className={ROW}>
                <Paperclip aria-hidden className="size-[18px] shrink-0 text-phone-text-secondary" />
                <span className="min-w-0 flex-1">{`${filesCount} file${filesCount === 1 ? '' : 's'}`}</span>
                <ChevronRight aria-hidden className="size-[18px] shrink-0 text-phone-text-secondary" />
              </button>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-[8px]">
          <div className="flex items-center justify-between">
            <h2 className="text-phone-label font-medium text-phone-text-secondary">
              Comments{totalCommentCount > 0 ? ` (${totalCommentCount})` : ''}
            </h2>
            <button type="button" onClick={() => setPanel('comments')} className="text-phone-label font-semibold text-phone-primary-text">
              Add comment
            </button>
          </div>

          {comments === null ? (
            <p className="text-phone-body text-phone-text-secondary">Loading comments…</p>
          ) : comments.length === 0 ? (
            <p className="text-phone-body text-phone-text-secondary">No comments yet.</p>
          ) : (
            <>
              <ul className={ROW_BLOCK}>
                {visibleComments
                  .slice()
                  .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                  .map((c) => (
                    <li key={c.id} className="flex flex-col gap-[4px] px-[16px] py-[10px]">
                      <div className="flex items-baseline justify-between gap-[8px]">
                        <span className="truncate text-phone-label font-semibold text-phone-text-primary">{c.user_name}</span>
                        <span className="shrink-0 text-phone-meta text-phone-text-secondary">{fmtDateTime(c.created_at)}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-phone-body text-phone-text-primary">{c.body}</p>
                      {(c.attachments ?? []).length > 0 ? (
                        <div className="flex flex-wrap gap-[8px]">
                          {(c.attachments ?? []).map((a) => (
                            <button
                              key={a.id}
                              type="button"
                              onClick={() => tasksApi.downloadAttachment(orgId, task.id, a.id)}
                              className="inline-flex items-center gap-[4px] rounded-[6px] border border-phone-border-light px-[8px] py-[4px] text-phone-meta text-phone-text-secondary"
                            >
                              <Paperclip aria-hidden className="size-[12px]" />
                              <span className="max-w-[160px] truncate">{a.file_name}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  ))}
              </ul>
              {comments.length > commentCount ? (
                <button
                  type="button"
                  onClick={() => setCommentCount((n) => n + COMMENTS_PAGE)}
                  className="self-center text-phone-label font-semibold text-phone-primary-text"
                >
                  Show more
                </button>
              ) : null}
            </>
          )}
        </section>
      </div>

      {isAssignee ? (
        <ActionBar>
          {myPartDone ? (
            <PhoneButton
              type="button"
              variant="secondary"
              fullWidth
              onClick={() => {
                callUndo(task)
                  .then(() => {
                    load()
                    void refreshBadge()
                  })
                  .catch(() => addToast('Could not reopen the task. Try again.', 'error'))
              }}
            >
              Reopen task
            </PhoneButton>
          ) : (
            <PhoneButton type="button" variant="primary" fullWidth disabled={completing} onClick={onTapComplete}>
              {completing ? 'Completing…' : 'Complete task'}
            </PhoneButton>
          )}
        </ActionBar>
      ) : null}

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

      {panel === 'comments' ? (
        <CommentComposeOverlay
          orgId={orgId}
          taskId={task.id}
          onClose={() => setPanel(null)}
          onPosted={() => {
            setPanel(null)
            loadComments()
            // Sending a comment is a reply you'd want to hear back about
            // (plan §9, kit §41.12 rule 4) - offer once, at most.
            if (shouldOfferPushNow(userId)) setOfferPush(true)
          }}
        />
      ) : null}

      {panel === 'files' ? (
        <FilesProofOverlay orgId={orgId} task={task} onClose={() => setPanel(null)} onTaskUpdate={updateTask} />
      ) : null}

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
    <button type="button" onClick={onToggle} disabled={busy} className={cx(className, 'active:bg-phone-surface-control disabled:opacity-100')}>
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
      <dt className="text-phone-meta text-phone-text-secondary">{label}</dt>
      <dd className="text-phone-body text-phone-text-primary">{value}</dd>
    </div>
  )
}

/** The fixed action bar at the bottom of the task record (kit §41.6). */
function ActionBar({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={cx(
        'fixed inset-x-0 bottom-0 z-30 flex gap-[8px] border-t border-phone-border-light bg-phone-surface px-[16px] pt-[12px]',
        'pb-[calc(12px+var(--safe-bottom))] pl-[max(16px,var(--safe-left))] pr-[max(16px,var(--safe-right))]',
      )}
    >
      {children}
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
    <div className="fixed inset-x-0 top-0 bottom-[var(--keyboard-inset)] z-[75] flex flex-col bg-phone-surface-sunken">
      <header
        className={cx(
          'sticky top-0 z-10 flex h-[var(--h-topbar)] shrink-0 items-center gap-[8px] bg-phone-primary text-phone-on-brand',
          'pt-[var(--safe-top)] pl-[max(4px,var(--safe-left))] pr-[max(16px,var(--safe-right))]',
        )}
      >
        <button type="button" aria-label="Close" onClick={close} className={APP_BAR_BUTTON}>
          <X aria-hidden />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-phone-bar-title font-medium">{title}</h2>
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
        <li key={u.id} className="flex min-h-[44px] items-center gap-[8px] rounded-[8px] border border-phone-border-light bg-phone-surface px-[12px] py-[6px]">
          <Paperclip aria-hidden className="size-[16px] shrink-0 text-phone-text-secondary" />
          <span className="min-w-0 flex-1 truncate text-phone-label text-phone-text-primary">{u.file.name}</span>
          {u.status === 'uploading' ? (
            <span className="shrink-0 text-phone-meta text-phone-text-secondary">{u.progress}%</span>
          ) : u.status === 'done' ? (
            <span className="shrink-0 text-phone-label font-medium text-phone-success">Done</span>
          ) : u.status === 'failed' ? (
            <button
              type="button"
              onClick={() => onRetry(u.id)}
              className="inline-flex min-h-[36px] shrink-0 items-center gap-[4px] rounded-[6px] px-[8px] text-phone-label font-semibold text-phone-danger active:bg-phone-danger-bg"
            >
              <RotateCcw aria-hidden className="size-[14px]" />
              Retry
            </button>
          ) : onRemove ? (
            <button type="button" aria-label={`Remove ${u.file.name}`} onClick={() => onRemove(u.id)} className="inline-flex size-[36px] shrink-0 items-center justify-center rounded-full active:bg-phone-surface-control">
              <X aria-hidden className="size-[16px] text-phone-text-secondary" />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

const COMMENT_MAX = 1000 // CreateCommentDto body @MaxLength(1000)
const COMPOSER_MAX_LINES = 5

/**
 * "Add comment" full screen - kit §41.6 rule 5, §41.7. The message box and
 * Send sit in a bar pinned to the bottom, above the keyboard; the box grows
 * with its text up to 5 lines, then scrolls. Enter is a newline; only Send
 * sends. Once the comment exists it is never created again: a failed
 * attachment gets its own Retry that uploads to that same comment.
 */
function CommentComposeOverlay({ orgId, taskId, onClose, onPosted }: { orgId: string; taskId: string; onClose: () => void; onPosted: () => void }) {
  const { addToast } = useToast()
  const [body, setBody] = React.useState('')
  const [uploads, setUploads] = React.useState<UploadItem[]>([])
  const [sending, setSending] = React.useState(false)
  // Set once addComment has succeeded - from then on only attachments are retried.
  const [commentId, setCommentId] = React.useState<string | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  // Grow with the content up to 5 lines, then scroll.
  React.useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    const cs = window.getComputedStyle(el)
    const lineHeight = parseFloat(cs.lineHeight) || 22
    const chrome =
      parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)
    const max = lineHeight * COMPOSER_MAX_LINES + chrome
    el.style.height = 'auto'
    const wanted = el.scrollHeight + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)
    el.style.height = `${Math.min(wanted, max)}px`
    el.style.overflowY = wanted > max ? 'auto' : 'hidden'
  }, [body])

  const setUpload = (id: string, patch: Partial<UploadItem>) =>
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)))

  /** Uploads one file to the existing comment; true when it landed. */
  async function uploadOne(cid: string, item: UploadItem): Promise<boolean> {
    setUpload(item.id, { status: 'uploading', progress: 0 })
    try {
      const shrunk = await shrinkImageForUpload(item.file)
      await tasksApi.uploadCommentAttachment(orgId, taskId, cid, shrunk)
      setUpload(item.id, { status: 'done', progress: 100 })
      return true
    } catch {
      setUpload(item.id, { status: 'failed' })
      return false
    }
  }

  async function send() {
    if (sending || commentId) return
    const text = body.trim()
    if (!text || text.length > COMMENT_MAX) return
    setSending(true)
    let cid: string
    try {
      const comment = await tasksApi.addComment(orgId, taskId, text)
      cid = comment.id
      setCommentId(cid)
    } catch {
      addToast('Could not post the comment. Try again.', 'error')
      setSending(false)
      return
    }
    let failed = 0
    for (const item of uploads) {
      if (!(await uploadOne(cid, item))) failed += 1
    }
    setSending(false)
    if (failed === 0) {
      onPosted()
    } else {
      addToast(`Comment posted, but ${failed} file${failed === 1 ? '' : 's'} failed to upload. Tap Retry on each.`, 'error')
    }
  }

  async function retry(id: string) {
    const item = uploads.find((u) => u.id === id)
    if (!item || !commentId) return
    await uploadOne(commentId, item)
  }

  const failedCount = uploads.filter((u) => u.status === 'failed').length
  const anyUploading = uploads.some((u) => u.status === 'uploading')
  const tooLong = body.trim().length > COMMENT_MAX
  // After the comment exists, leaving always refreshes the list so it shows.
  const leave = commentId ? onPosted : onClose

  const footer = (
    <div className={cx('flex flex-col gap-[8px] border-t border-phone-border-light bg-phone-surface px-[12px] pt-[8px]', 'pb-[calc(8px+var(--safe-bottom))] pl-[max(12px,var(--safe-left))] pr-[max(12px,var(--safe-right))]')}>
      {tooLong ? <p className="text-phone-meta text-phone-danger">Comments can be at most {COMMENT_MAX} characters.</p> : null}
      {commentId ? (
        <div className="flex items-center gap-[8px]">
          <p className="min-w-0 flex-1 text-phone-label text-phone-text-primary">
            {failedCount > 0 ? `Comment posted. ${failedCount} file${failedCount === 1 ? '' : 's'} still to upload.` : 'Comment posted.'}
          </p>
          <PhoneButton type="button" variant="primary" disabled={anyUploading} onClick={onPosted}>
            Done
          </PhoneButton>
        </div>
      ) : (
        <div className="flex items-end gap-[8px]">
          <button
            type="button"
            aria-label="Attach photo or file"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending}
            className="inline-flex size-[44px] shrink-0 items-center justify-center rounded-full text-phone-text-secondary active:bg-phone-surface-control"
          >
            <Paperclip aria-hidden className="size-[20px]" />
          </button>
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a comment…"
            rows={1}
            autoFocus
            enterKeyHint="enter"
            aria-label="Comment"
            disabled={sending}
            className="min-h-[44px] min-w-0 flex-1 resize-none rounded-[8px] border border-phone-border-strong bg-phone-surface px-[12px] py-[10px] text-[16px] leading-[22px] text-phone-text-primary outline-none focus-visible:border-phone-primary"
          />
          <button
            type="button"
            aria-label="Send"
            onClick={() => void send()}
            disabled={!body.trim() || tooLong || sending}
            className="inline-flex size-[44px] shrink-0 items-center justify-center rounded-full bg-phone-primary text-phone-primary-foreground active:bg-phone-primary-pressed disabled:bg-phone-surface-control-pressed disabled:text-phone-text-secondary"
          >
            <Send aria-hidden className="size-[18px]" />
          </button>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files ? Array.from(e.target.files) : []
          if (picked.length) setUploads((prev) => [...prev, ...picked.map(newUpload)])
          e.target.value = ''
        }}
      />
    </div>
  )

  return (
    <FullScreenOverlay title="Add comment" onClose={leave} footer={footer}>
      <div className="flex flex-col gap-[12px]">
        {commentId ? (
          <p className="whitespace-pre-wrap rounded-[8px] border border-phone-border-light bg-phone-surface px-[12px] py-[10px] text-phone-body text-phone-text-primary">{body.trim()}</p>
        ) : null}
        <UploadRows
          items={uploads}
          onRetry={(id) => void retry(id)}
          onRemove={commentId ? undefined : (id) => setUploads((prev) => prev.filter((u) => u.id !== id))}
        />
        {uploads.length === 0 && !commentId ? (
          <p className="text-phone-meta text-phone-text-secondary">Attach photos or files with the paperclip. @mentions aren&apos;t supported on the phone yet.</p>
        ) : null}
      </div>
    </FullScreenOverlay>
  )
}

/**
 * Opens a non-image file (kit §41.16 rule 18). In the installed app on iPhone
 * a new tab cannot open, so the file goes through the share sheet (Save to
 * Files, Quick Look, another app). Everywhere else - and if sharing is
 * unavailable or fails - it opens in the phone's own viewer.
 */
async function openNonImageFile(orgId: string, taskId: string, a: TaskAttachment): Promise<void> {
  const type = a.mime_type || 'application/octet-stream'
  const canShareFiles =
    isInstalledApp() &&
    detectPlatform() === 'ios' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [new File([''], a.file_name, { type })] })

  if (canShareFiles) {
    try {
      const { url, file_name } = await tasksApi.getAttachmentDownloadUrl(orgId, taskId, a.id)
      const res = await fetch(url)
      if (!res.ok) throw new Error(`download failed: ${res.status}`)
      const blob = await res.blob()
      const file = new File([blob], file_name || a.file_name, { type: blob.type || type })
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: file.name })
        return
      }
    } catch (err) {
      // The person closed the share sheet: that is a choice, not a failure.
      if (err instanceof DOMException && err.name === 'AbortError') return
    }
  }
  await tasksApi.downloadAttachment(orgId, taskId, a.id)
}

/** "Files & proof" full screen - kit §41.6/41.16, respecting proof_visibility. */
function FilesProofOverlay({ orgId, task, onClose, onTaskUpdate }: { orgId: string; task: Task; onClose: () => void; onTaskUpdate: (t: Task) => void }) {
  const { addToast } = useToast()
  const [items, setItems] = React.useState<TaskAttachment[] | null>(null)
  const [viewer, setViewer] = React.useState<TaskAttachment | null>(null)
  const [uploads, setUploads] = React.useState<UploadItem[]>([])
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const cameraInputRef = React.useRef<HTMLInputElement>(null)

  const load = React.useCallback(() => {
    tasksApi
      .listAllAttachments(orgId, task.id)
      .then(setItems)
      .catch(() => addToast('Files could not be loaded.', 'error'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, task.id])
  React.useEffect(load, [load])

  const setUpload = (id: string, patch: Partial<UploadItem>) =>
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)))

  /** One file: its own progress; a failure marks only that row and never stops the others. */
  async function uploadOne(item: UploadItem) {
    setUpload(item.id, { status: 'uploading', progress: 0 })
    try {
      const shrunk = await shrinkImageForUpload(item.file)
      await tasksApi.uploadTaskAttachment(orgId, task.id, shrunk, (pct) => setUpload(item.id, { progress: pct }))
      setUpload(item.id, { status: 'done', progress: 100 })
      // Refresh the list and the task (its file count) as each file lands.
      load()
      tasksApi.getTask(orgId, task.id).then(onTaskUpdate).catch(() => {})
    } catch {
      setUpload(item.id, { status: 'failed' })
    }
  }

  async function addFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    const added = Array.from(fileList).map(newUpload)
    setUploads((prev) => [...prev, ...added])
    for (const item of added) await uploadOne(item)
  }

  function retry(id: string) {
    const item = uploads.find((u) => u.id === id)
    if (item) void uploadOne(item)
  }

  function openFile(a: TaskAttachment) {
    if (a.mime_type?.startsWith('image/')) {
      setViewer(a)
      return
    }
    openNonImageFile(orgId, task.id, a).catch(() => addToast('This file could not be opened. Try again.', 'error'))
  }

  return (
    <FullScreenOverlay title="Files & proof" onClose={onClose}>
      <div className="flex flex-col gap-[16px]">
        <div className="flex gap-[8px]">
          <PhoneButton type="button" variant="secondary" fullWidth onClick={() => cameraInputRef.current?.click()}>
            <Camera aria-hidden className="size-[18px]" />
            Take photo
          </PhoneButton>
          <PhoneButton type="button" variant="secondary" fullWidth onClick={() => fileInputRef.current?.click()}>
            <FileUp aria-hidden className="size-[18px]" />
            Choose file
          </PhoneButton>
        </div>
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            void addFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            void addFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <UploadRows items={uploads} onRetry={retry} />

        {items === null ? (
          <p className="text-phone-body text-phone-text-secondary">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-phone-body text-phone-text-secondary">No files or proof yet.</p>
        ) : (
          <ul className={ROW_BLOCK}>
            {items.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => openFile(a)} className={ROW}>
                  <Paperclip aria-hidden className="size-[18px] shrink-0 text-phone-text-secondary" />
                  <span className="min-w-0 flex-1 truncate">{a.file_name}</span>
                  {a.is_proof ? (
                    <span className="shrink-0 rounded-full bg-phone-success-bg px-[8px] py-[2px] text-phone-meta font-semibold text-phone-success">Proof</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {viewer ? <ImageViewer attachment={viewer} orgId={orgId} taskId={task.id} onClose={() => setViewer(null)} /> : null}
    </FullScreenOverlay>
  )
}

/** Full-screen image viewer with pinch-zoom (kit §41.16). */
function ImageViewer({ attachment, orgId, taskId, onClose }: { attachment: TaskAttachment; orgId: string; taskId: string; onClose: () => void }) {
  const [url, setUrl] = React.useState<string | null>(null)
  React.useEffect(() => {
    let cancelled = false
    tasksApi
      .getAttachmentDownloadUrl(orgId, taskId, attachment.id)
      .then(({ url: resolved }) => {
        if (!cancelled) setUrl(resolved)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [orgId, taskId, attachment.id])

  return createPortal(
    <div className="fixed inset-0 z-[90] flex flex-col bg-black">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute right-[16px] top-[max(16px,var(--safe-top))] z-10 flex size-[44px] items-center justify-center rounded-full bg-black/40 text-white">
        <X aria-hidden />
      </button>
      <div className="flex flex-1 items-center justify-center overflow-auto touch-pinch-zoom">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={attachment.file_name} className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-phone-body text-white">Loading…</span>
        )}
      </div>
    </div>,
    document.body,
  )
}
