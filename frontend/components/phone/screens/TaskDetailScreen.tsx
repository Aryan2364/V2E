'use client'

import React from 'react'
import { createPortal } from 'react-dom'
import { useParams } from 'next/navigation'
import { ChevronRight, MoreVertical, Paperclip, Send, X } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useToast } from '@/components/ui/Toast'
import { tasksApi } from '@/lib/api/tasks'
import type { Task, TaskAttachment, TaskComment, TaskChecklistItem } from '@/lib/types/tasks'
import { TERMINAL_STATUS_PHASES } from '@/lib/types/tasks'
import { PHONE_HOME, type PhoneRoute } from '@/lib/phone-routes'
import { shrinkImageForUpload } from '@/lib/image-resize'
import { canQuickComplete, finishBlockedReason, unfinishedChecklistItems } from '@/lib/tasks/finish-rules'
import { useTaskBadge } from '@/lib/task-badge'
import PhoneScreen from '../PhoneScreen'
import { PhoneEmptyState } from '../PhoneEmptyState'
import { PhoneButton, PhoneLinkButton, ROW, ROW_BLOCK, cx } from '../primitives'
import { APP_BAR_BUTTON } from '../PhoneAppBar'
import { PhoneSheet } from '../PhoneSheet'
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
    { label: 'Due', value: task.deadline ? new Date(task.deadline).toLocaleString() : 'No deadline' },
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

  async function callComplete(current: Task): Promise<Task> {
    if (current.completion_mode === 'all_must_complete') return tasksApi.completeAssignee(orgId, current.id, 'me')
    return tasksApi.completeTask(orgId, current.id)
  }
  async function callUndo(current: Task): Promise<void> {
    if (current.completion_mode === 'all_must_complete') await tasksApi.reopenAssigneePart(orgId, current.id, 'me')
    else await tasksApi.reopenTask(orgId, current.id)
  }

  function completeOptimistically() {
    if (!task) return
    const previous = task
    setCompleting(true)
    const apiCall = callComplete(previous)
    window.setTimeout(() => setCompleting(false), 300)

    apiCall
      .then((updated) => {
        setTask(updated)
        void refreshBadge()
        showUndo('Task completed · Undo', async () => {
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

  const checklistDisabledReason = !isAssignee ? 'Only an assignee can tick this checklist' : null

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
            <ul className={ROW_BLOCK}>
              {(task.checklist ?? []).map((item) => {
                const done =
                  task.completion_mode === 'all_must_complete' ? item.my_state === 'done' || item.my_state === 'skipped' : !!item.is_completed
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => void toggleChecklistItem(item)}
                      disabled={checking.has(item.id) || !isAssignee}
                      title={checklistDisabledReason ?? undefined}
                      className="flex min-h-[48px] w-full items-center gap-[12px] px-[16px] py-[10px] text-left active:bg-phone-surface-control disabled:opacity-100"
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
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ) : null}

        <section className="flex flex-col gap-[8px]">
          <h2 className="text-phone-label font-medium text-phone-text-secondary">Files &amp; proof</h2>
          <button type="button" onClick={() => setPanel('files')} className={cx(ROW, ROW_BLOCK)}>
            <Paperclip aria-hidden className="size-[18px] shrink-0 text-phone-text-secondary" />
            <span className="min-w-0 flex-1">{filesCount === 0 ? 'No files yet' : `${filesCount} file${filesCount === 1 ? '' : 's'}`}</span>
            <ChevronRight aria-hidden className="size-[18px] shrink-0 text-phone-text-secondary" />
          </button>
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
                        <span className="shrink-0 text-phone-meta text-phone-text-secondary">{new Date(c.created_at).toLocaleString()}</span>
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
          <Detail label="Created" value={new Date(task.created_at).toLocaleString()} />
          <Detail label="Last updated" value={new Date(task.updated_at).toLocaleString()} />
          {task.completed_at ? <Detail label="Completed" value={new Date(task.completed_at).toLocaleString()} /> : null}
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
          }}
        />
      ) : null}

      {panel === 'files' ? (
        <FilesProofOverlay orgId={orgId} task={task} onClose={() => setPanel(null)} onTaskUpdate={updateTask} />
      ) : null}
    </PhoneScreen>
  )
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

  // Android/back-gesture: one history entry while open, same pattern as PhoneSheet.
  React.useEffect(() => {
    window.history.pushState({ ...(window.history.state ?? {}), kitLayer: true }, '', window.location.href)
    const onPop = () => onClose()
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function close() {
    onClose()
    if ((window.history.state as { kitLayer?: boolean } | null)?.kitLayer) window.history.back()
  }

  if (!mounted) return null
  return createPortal(
    <div className="fixed inset-0 z-[75] flex flex-col bg-phone-surface-sunken">
      <header
        className={cx(
          'sticky top-0 z-10 flex h-[var(--h-topbar)] shrink-0 items-center gap-[8px] bg-phone-primary pl-[4px] pr-[16px] text-phone-on-brand',
          'pt-[var(--safe-top)] pl-[max(4px,var(--safe-left))] pr-[max(16px,var(--safe-right))]',
        )}
      >
        <button type="button" aria-label="Close" onClick={close} className={APP_BAR_BUTTON}>
          <X aria-hidden />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-phone-bar-title font-medium">{title}</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-[16px] pb-[16px] pt-[16px]">{children}</div>
      {footer}
    </div>,
    document.body,
  )
}

/** "Add comment" full screen - kit §41.6 rule 5, §41.7. */
function CommentComposeOverlay({ orgId, taskId, onClose, onPosted }: { orgId: string; taskId: string; onClose: () => void; onPosted: () => void }) {
  const { addToast } = useToast()
  const [body, setBody] = React.useState('')
  const [files, setFiles] = React.useState<File[]>([])
  const [sending, setSending] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  async function send() {
    if (!body.trim() || sending) return
    setSending(true)
    try {
      const comment = await tasksApi.addComment(orgId, taskId, body.trim())
      for (const file of files) {
        const shrunk = await shrinkImageForUpload(file)
        await tasksApi.uploadCommentAttachment(orgId, taskId, comment.id, shrunk)
      }
      onPosted()
    } catch {
      addToast('Could not post the comment. Try again.', 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <FullScreenOverlay title="Add comment" onClose={onClose}>
      <div className="flex flex-col gap-[12px]">
        <textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write a comment…"
          rows={3}
          autoFocus
          style={{ maxHeight: '8.5em' }}
          className="min-h-[88px] w-full resize-none overflow-y-auto rounded-[8px] border border-phone-border-strong bg-phone-surface px-[12px] py-[10px] text-[16px] leading-[1.4] text-phone-text-primary outline-none focus-visible:border-phone-primary"
        />
        <div className="flex items-center gap-[8px]">
          <PhoneButton type="button" variant="secondary" onClick={() => fileInputRef.current?.click()}>
            <Paperclip aria-hidden className="size-[16px]" />
            Attach
          </PhoneButton>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) setFiles((prev) => [...prev, ...Array.from(e.target.files!)])
              e.target.value = ''
            }}
          />
          {files.length > 0 ? <span className="text-phone-meta text-phone-text-secondary">{files.length} attached</span> : null}
        </div>
        {files.length > 0 ? (
          <ul className="flex flex-col gap-[6px]">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-[8px] rounded-[6px] border border-phone-border-light px-[10px] py-[6px]">
                <span className="min-w-0 flex-1 truncate text-phone-label text-phone-text-primary">{f.name}</span>
                <button type="button" aria-label="Remove" onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}>
                  <X aria-hidden className="size-[14px] text-phone-text-secondary" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-phone-meta text-phone-text-secondary">@mentions aren&apos;t supported yet.</p>
      </div>
      <div className={cx('sticky bottom-0 -mx-[16px] mt-[12px] flex gap-[8px] border-t border-phone-border-light bg-phone-surface px-[16px] pt-[12px]', 'pb-[calc(12px+var(--safe-bottom))]')}>
        <PhoneButton type="button" variant="primary" fullWidth disabled={!body.trim() || sending} onClick={() => void send()}>
          <Send aria-hidden className="size-[16px]" />
          {sending ? 'Sending…' : 'Send'}
        </PhoneButton>
      </div>
    </FullScreenOverlay>
  )
}

/** "Files & proof" full screen - kit §41.6/41.16, respecting proof_visibility. */
function FilesProofOverlay({ orgId, task, onClose, onTaskUpdate }: { orgId: string; task: Task; onClose: () => void; onTaskUpdate: (t: Task) => void }) {
  const { addToast } = useToast()
  const [items, setItems] = React.useState<TaskAttachment[] | null>(null)
  const [viewer, setViewer] = React.useState<TaskAttachment | null>(null)
  const [uploading, setUploading] = React.useState(false)
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

  async function addFiles(fileList: FileList | null) {
    if (!fileList) return
    setUploading(true)
    try {
      for (const f of Array.from(fileList)) {
        const shrunk = await shrinkImageForUpload(f)
        await tasksApi.uploadTaskAttachment(orgId, task.id, shrunk)
      }
      load()
      const refreshed = await tasksApi.getTask(orgId, task.id)
      onTaskUpdate(refreshed)
    } catch {
      addToast('Some files could not be uploaded. Try again.', 'error')
    } finally {
      setUploading(false)
    }
  }

  function openFile(a: TaskAttachment) {
    if (a.mime_type?.startsWith('image/')) {
      setViewer(a)
      return
    }
    // PDF/other: open in the phone viewer (new tab), or the share sheet handles it
    // on an installed iPhone (kit §41.16 rule 18) since the signed URL opens in Safari.
    void tasksApi.downloadAttachment(orgId, task.id, a.id)
  }

  return (
    <FullScreenOverlay title="Files & proof" onClose={onClose}>
      <div className="flex flex-col gap-[16px]">
        <div className="flex gap-[8px]">
          <PhoneButton type="button" variant="secondary" fullWidth disabled={uploading} onClick={() => cameraInputRef.current?.click()}>
            Take photo
          </PhoneButton>
          <PhoneButton type="button" variant="secondary" fullWidth disabled={uploading} onClick={() => fileInputRef.current?.click()}>
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
        {uploading ? <p className="text-phone-meta text-phone-text-secondary">Uploading…</p> : null}

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
