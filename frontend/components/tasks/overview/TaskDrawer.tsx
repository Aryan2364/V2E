'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { Calendar, Send, CheckCircle2, ExternalLink, MessageSquare, Paperclip, User } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetBody, SheetFooter } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useRouter } from 'next/navigation'
import { tasksApi } from '@/lib/api/tasks'
import { getNow } from '@/lib/clock'
import type { Task, TaskStatus, TaskComment, TaskAttachment } from '@/lib/types/tasks'
import AssigneeAvatars, { type AvatarPerson } from '@/components/tasks/AssigneeAvatars'
import StyledSelect from '@/components/ui/StyledSelect'
import Tooltip from '@/components/ui/tooltip'
import { useAuth } from '@/lib/auth/context'
import FileDropzone from '@/components/ui/FileDropzone'
import { AttachmentList, AttachmentChips, PendingFileList } from '@/components/ui/AttachmentList'
import InlineTaskTags from '@/components/tasks/InlineTaskTags'
import { taskWorkflow, workflowSourceText } from '@/components/tasks/WorkflowTaskBadge'
import { useCanEditTask } from '@/lib/tasks/useCanEditTask'
import { formatDate, formatDateTime } from '@/lib/format'

const TERMINAL = new Set(['completed', 'partially_completed', 'incomplete'])

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-meta font-medium"
      style={{ backgroundColor: color + '22', color, border: `1px solid ${color}44` }}
    >
      {label}
    </span>
  )
}

const formatWhen = formatDateTime

/**
 * Slide-in task drawer: full detail + inline comments, so a manager can read and respond
 * without leaving the dashboard. Status change / complete bubble up via onChanged so the
 * canvas refreshes its counts.
 */
export default function TaskDrawer({
  orgId,
  taskId,
  statuses,
  onClose,
  onChanged,
}: {
  orgId: string
  taskId: string
  statuses: TaskStatus[]
  onClose: () => void
  onChanged: () => void
}) {
  const router = useRouter()
  const { user } = useAuth()
  const [task, setTask] = useState<Task | null>(null)
  const [comments, setComments] = useState<TaskComment[]>([])
  const [attachments, setAttachments] = useState<TaskAttachment[]>([])
  const [uploadingAtt, setUploadingAtt] = useState(false)
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [draftFiles, setDraftFiles] = useState<File[]>([])
  const [sending, setSending] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [t, c, a] = await Promise.all([
        tasksApi.getTask(orgId, taskId),
        tasksApi.getComments(orgId, taskId).catch(() => []),
        tasksApi.listAttachments(orgId, taskId).catch(() => []),
      ])
      setTask(t)
      setComments(c)
      setAttachments(a)
    } finally {
      setLoading(false)
    }
  }, [orgId, taskId])

  useEffect(() => { load() }, [load])

  // Body-scroll lock, Escape and the backdrop are now the kit Sheet's own behaviour.

  async function send() {
    if (!draft.trim() || sending) return
    setSending(true)
    try {
      const c = await tasksApi.addComment(orgId, taskId, draft.trim())
      for (const file of draftFiles) {
        await tasksApi.uploadCommentAttachment(orgId, taskId, c.id, file)
      }
      setDraft('')
      setDraftFiles([])
      setComments(await tasksApi.getComments(orgId, taskId))
    } finally {
      setSending(false)
    }
  }

  async function uploadAttachments(files: File[]) {
    if (files.length === 0) return
    setUploadingAtt(true)
    try {
      for (const file of files) {
        const att = await tasksApi.uploadTaskAttachment(orgId, taskId, file)
        setAttachments((prev) => [att, ...prev])
      }
    } finally {
      setUploadingAtt(false)
    }
  }

  async function removeAttachment(a: TaskAttachment) {
    await tasksApi.deleteAttachment(orgId, taskId, a.id)
    setAttachments((prev) => prev.filter((x) => x.id !== a.id))
  }

  async function changeStatus(statusId: string) {
    if (!task || statusId === task.status_id || busy) return
    setBusy(true)
    try {
      await tasksApi.updateTask(orgId, taskId, { status_id: statusId })
      await load()
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function complete() {
    if (busy) return
    setBusy(true)
    try {
      await tasksApi.completeTask(orgId, taskId)
      await load()
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  // Same gate as the detail page: the server's updateTask rule, not a hard-coded role.
  const canEditTags = useCanEditTask(task)
  const handleTagsUpdated = useCallback(
    (updated: Task) => {
      // Patch in place (no reload, no flicker), then let the canvas pick up the change.
      setTask((prev) => (prev ? { ...prev, tags: updated.tags } : prev))
      onChanged()
    },
    [onChanged],
  )

  const status = task?.status ?? statuses.find((s) => s.id === task?.status_id)
  const isTerminal = status ? TERMINAL.has(status.type) : false
  const isFutureTask = task ? new Date(task.created_at) > getNow() : false
  const people: AvatarPerson[] = [...(task?.assignees ?? [])]
    .sort((a, b) => Number(a.is_cc) - Number(b.is_cc))
    .map((a) => ({ id: a.id, name: a.user?.name ?? a.user_name ?? '?', department: a.user?.department, role: a.user?.role_title, isCC: a.is_cc }))

  return (
    <Sheet open onOpenChange={(next) => { if (!next) onClose() }}>
      <SheetContent side="right" className="w-full sm:max-w-[560px] flex flex-col p-0">
        <SheetHeader>
          <div className="min-w-0">
            <p className="text-meta font-medium uppercase tracking-wide text-on-brand-muted">Task</p>
            <SheetTitle className="wrap-break-word">
              {loading ? 'Loading…' : task?.title}
            </SheetTitle>
          </div>
        </SheetHeader>

        {(loading || !task) && (
          <SheetBody className="p-0 flex-1 flex items-center justify-center">
            <div className="w-full max-w-sm space-y-3 p-6">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          </SheetBody>
        )}
        {!loading && task && (
            <SheetBody className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
              {isFutureTask && (
                <div className="-mx-6 -mt-4 mb-2 bg-danger-bg border-b border-danger-border px-6 py-3 text-meta font-medium text-danger">
                  This task was created in a simulated future ({formatDate(task.created_at)}). To interact with it, please time-travel to this date or later.
                </div>
              )}
              {/* Chips */}
              <div className="flex items-center gap-2 flex-wrap">
                {status && <Chip label={status.label} color={status.color} />}
                {task.priority && <Chip label={task.priority.label} color={task.priority.color} />}
                {task.category && <Chip label={task.category.name} color={task.category.color} />}
              </div>

              {/* Meta grid */}
              <div className="grid grid-cols-2 gap-4 text-body">
                <div>
                  <p className="text-text-muted mb-1">Assigned by</p>
                  {(() => {
                    const wf = taskWorkflow(task)
                    if (!wf) {
                      return (
                        <p className="text-text-primary font-medium flex items-center gap-1.5">
                          <User size={13} className="text-text-muted" />
                          {task.created_by?.name ?? '—'}
                        </p>
                      )
                    }
                    const setUpBy = wf.set_up_by_name ?? task.created_by?.name
                    return (
                      <>
                        <p className="text-text-primary font-medium wrap-break-word">{workflowSourceText(wf)}</p>
                        {setUpBy && <p className="text-meta text-text-secondary">set up by {setUpBy}</p>}
                      </>
                    )
                  })()}
                </div>
                <div>
                  <p className="text-text-muted mb-1">Deadline</p>
                  <p className="text-text-primary font-medium flex items-center gap-1.5">
                    <Calendar size={13} className="text-text-muted" />
                    {task.deadline ? formatWhen(task.deadline) : 'No deadline'}
                  </p>
                </div>
                <div className="col-span-2">
                  <p className="text-text-muted mb-1.5">Assignees</p>
                  {people.length > 0 ? <AssigneeAvatars people={people} max={8} /> : <p className="text-text-secondary">—</p>}
                </div>
                <div className="col-span-2">
                  <p className="text-text-muted mb-1.5">Tags</p>
                  <InlineTaskTags
                    orgId={orgId}
                    taskId={task.id}
                    tags={task.tags}
                    canEdit={canEditTags}
                    onUpdated={handleTagsUpdated}
                  />
                </div>
              </div>

              {/* Description */}
              {task.description && (
                <div>
                  <p className="text-body text-text-muted mb-1">Description</p>
                  <p className="text-body text-text-primary whitespace-pre-wrap leading-relaxed">{task.description}</p>
                </div>
              )}

              {/* Attachments */}
              <div>
                <p className="text-body font-medium text-text-primary mb-2 flex items-center gap-1.5">
                  <Paperclip size={14} className="text-text-secondary" />
                  Attachments
                  {attachments.length > 0 && (
                    <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-meta font-medium">
                      {attachments.length}
                    </span>
                  )}
                </p>
                {attachments.length > 0 && (
                  <div className="mb-2">
                    <AttachmentList
                      attachments={attachments}
                      onDownload={(a) => tasksApi.downloadAttachment(orgId, taskId, a.id)}
                      onRemove={removeAttachment}
                      canRemove={(a) => a.uploaded_by_user_id === user?.id && !isFutureTask}
                    />
                  </div>
                )}
                <FileDropzone onFiles={uploadAttachments} disabled={uploadingAtt || isFutureTask} compact />
              </div>

              {/* Checklist */}
              {task.checklist && task.checklist.length > 0 && (
                <div>
                  <p className="text-body text-text-muted mb-2">
                    Checklist · {task.checklist.filter((i) => i.is_completed).length}/{task.checklist.length}
                  </p>
                  <div className="space-y-1.5">
                    {task.checklist.map((item) => (
                      <div key={item.id} className="flex items-center gap-2 text-body">
                        <span className={`w-4 h-4 rounded-tick border flex items-center justify-center shrink-0 ${item.is_completed ? 'bg-success border-success' : 'border-border'}`}>
                          {item.is_completed && <CheckCircle2 size={12} className="text-primary-foreground" />}
                        </span>
                        <span className={item.is_completed ? 'text-text-muted line-through' : 'text-text-primary'}>{item.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Comments */}
              <div>
                <p className="text-body font-medium text-text-primary mb-3 flex items-center gap-1.5">
                  <MessageSquare size={14} className="text-text-secondary" />
                  Comments
                </p>
                {comments.length === 0 ? (
                  <p className="text-body text-text-muted">No comments yet. Start the conversation below.</p>
                ) : (
                  <div className="space-y-3">
                    {comments.map((c) => (
                      <div key={c.id} className="flex gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground text-meta font-medium flex items-center justify-center shrink-0">
                          {(c.user_name ?? '?').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-body">
                            <span className="font-medium text-text-primary">{c.user_name ?? 'Unknown'}</span>
                            <span className="text-text-muted ml-2 text-meta">{formatWhen(c.created_at)}</span>
                          </p>
                          <p className="text-body text-text-primary whitespace-pre-wrap wrap-break-word mt-0.5">{c.body}</p>
                          {c.attachments && c.attachments.length > 0 && (
                            <AttachmentChips
                              attachments={c.attachments}
                              onDownload={(a) => tasksApi.downloadAttachment(orgId, taskId, a.id)}
                            />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </SheetBody>
        )}
        {!loading && task && (
            <SheetFooter className="gap-3 px-6 py-3">
              {/* Status row */}
              <div className="flex items-center gap-2">
                <StyledSelect
                  value={task.status_id}
                  onChange={(v) => changeStatus(v)}
                  disabled={busy || isFutureTask}
                  wrapperClassName="flex-1"
                  options={statuses.map((s) => ({ value: s.id, label: s.label, color: s.color }))}
                />
                {!isTerminal && (
                  <button
                    onClick={complete}
                    disabled={busy || isFutureTask}
                    className="shrink-0 flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-success text-primary-foreground text-body font-medium hover:bg-success disabled:opacity-60 transition-colors"
                  >
                    <CheckCircle2 size={15} /> Complete
                  </button>
                )}
                <Tooltip label="Open full task page">
                  <button
                    onClick={() => router.push(`/dashboard/tasks/${taskId}`)}
                    aria-label="Open full task page"
                    className="shrink-0 w-[42px] h-[42px] rounded-lg border border-border-light flex items-center justify-center text-text-secondary hover:bg-surface-control hover:text-text-primary transition-colors"
                  >
                    <ExternalLink size={16} />
                  </button>
                </Tooltip>
              </div>
              {/* Comment box */}
              <div className="flex items-end gap-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                  rows={1}
                  disabled={isFutureTask}
                  placeholder={isFutureTask ? "Comments are locked on future tasks..." : "Write a comment…"}
                  className="flex-1 resize-none rounded-lg border border-border bg-surface px-3 py-2.5 text-body text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary max-h-28"
                />
                <button
                  onClick={send}
                  disabled={!draft.trim() || sending || isFutureTask}
                  className="shrink-0 w-[42px] h-[42px] rounded-lg bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary-hover disabled:bg-surface-control-pressed disabled:text-text-muted transition-colors"
                >
                  <Send size={16} />
                </button>
              </div>
              {/* Attach documents to the comment */}
              <FileDropzone onFiles={(fs) => setDraftFiles((prev) => [...prev, ...fs])} disabled={sending || isFutureTask} compact />
              <PendingFileList
                files={draftFiles}
                uploading={sending && draftFiles.length > 0}
                onRemove={(idx) => setDraftFiles((prev) => prev.filter((_, i) => i !== idx))}
              />
            </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  )
}
