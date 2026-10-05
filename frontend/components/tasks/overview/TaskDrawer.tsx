'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, Calendar, Send, CheckCircle2, ExternalLink, MessageSquare, Paperclip, User } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { tasksApi } from '@/lib/api/tasks'
import { getNow } from '@/lib/clock'
import type { Task, TaskStatus, TaskComment, TaskAttachment } from '@/lib/types/tasks'
import AssigneeAvatars, { type AvatarPerson } from '@/components/tasks/AssigneeAvatars'
import StyledSelect from '@/components/ui/StyledSelect'
import Tooltip from '@/components/ui/Tooltip'
import { useAuth } from '@/lib/auth/context'
import FileDropzone from '@/components/ui/FileDropzone'
import { AttachmentList, AttachmentChips, PendingFileList } from '@/components/ui/AttachmentList'
import InlineTaskTags from '@/components/tasks/InlineTaskTags'
import { useCanEditTask } from '@/lib/tasks/useCanEditTask'

const TERMINAL = new Set(['completed', 'partially_completed', 'incomplete'])

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex items-center rounded-[999px] px-2.5 py-0.5 text-[12px] font-medium"
      style={{ backgroundColor: color + '22', color, border: `1px solid ${color}44` }}
    >
      {label}
    </span>
  )
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
}

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

  // Lock body scroll + close on Escape.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [onClose])

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

  const body = (
    <div className="fixed inset-0 z-[60] flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-[#0F172A]/40 backdrop-blur-[1px]" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-[560px] h-full bg-white shadow-[0_0_40px_rgba(0,0,0,0.20)] flex flex-col animate-[slideIn_0.18s_ease-out]">
        <style>{`@keyframes slideIn{from{transform:translateX(24px);opacity:.6}to{transform:translateX(0);opacity:1}}`}</style>

        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-[#E2E8F0]">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#94A3B8]">Task</p>
            <h2 className="text-[18px] font-semibold text-[#0F172A] leading-snug mt-0.5 break-words">
              {loading ? 'Loading…' : task?.title}
            </h2>
          </div>
          <button onClick={onClose} className="shrink-0 w-8 h-8 rounded-[8px] flex items-center justify-center text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A] transition-colors">
            <X size={18} />
          </button>
        </div>

        {isFutureTask && task && (
          <div className="bg-[#FEF2F2] border-b border-[#FEE2E2] px-6 py-3 text-xs font-semibold text-[#991B1B]">
            ⌛ This task was created in a simulated future ({new Date(task.created_at).toLocaleDateString()}). To interact with it, please time-travel to this date or later.
          </div>
        )}

        {loading || !task ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-7 h-7 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
              {/* Chips */}
              <div className="flex items-center gap-2 flex-wrap">
                {status && <Chip label={status.label} color={status.color} />}
                {task.priority && <Chip label={task.priority.label} color={task.priority.color} />}
                {task.category && <Chip label={task.category.name} color={task.category.color} />}
              </div>

              {/* Meta grid */}
              <div className="grid grid-cols-2 gap-4 text-[13px]">
                <div>
                  <p className="text-[#94A3B8] mb-1">Assigned by</p>
                  <p className="text-[#0F172A] font-medium flex items-center gap-1.5">
                    <User size={13} className="text-[#94A3B8]" />
                    {task.created_by?.name ?? '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[#94A3B8] mb-1">Deadline</p>
                  <p className="text-[#0F172A] font-medium flex items-center gap-1.5">
                    <Calendar size={13} className="text-[#94A3B8]" />
                    {task.deadline ? formatWhen(task.deadline) : 'No deadline'}
                  </p>
                </div>
                <div className="col-span-2">
                  <p className="text-[#94A3B8] mb-1.5">Assignees</p>
                  {people.length > 0 ? <AssigneeAvatars people={people} max={8} /> : <p className="text-[#475569]">—</p>}
                </div>
                <div className="col-span-2">
                  <p className="text-[#94A3B8] mb-1.5">Tags</p>
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
                  <p className="text-[13px] text-[#94A3B8] mb-1">Description</p>
                  <p className="text-[14px] text-[#1E293B] whitespace-pre-wrap leading-relaxed">{task.description}</p>
                </div>
              )}

              {/* Attachments */}
              <div>
                <p className="text-[13px] font-semibold text-[#0F172A] mb-2 flex items-center gap-1.5">
                  <Paperclip size={14} className="text-[#475569]" />
                  Attachments
                  {attachments.length > 0 && (
                    <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-[#2563EB] text-white text-[10px] font-semibold">
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
                  <p className="text-[13px] text-[#94A3B8] mb-2">
                    Checklist · {task.checklist.filter((i) => i.is_completed).length}/{task.checklist.length}
                  </p>
                  <div className="space-y-1.5">
                    {task.checklist.map((item) => (
                      <div key={item.id} className="flex items-center gap-2 text-[14px]">
                        <span className={`w-4 h-4 rounded-[4px] border flex items-center justify-center shrink-0 ${item.is_completed ? 'bg-[#16A34A] border-[#16A34A]' : 'border-[#CBD5E1]'}`}>
                          {item.is_completed && <CheckCircle2 size={12} className="text-white" />}
                        </span>
                        <span className={item.is_completed ? 'text-[#94A3B8] line-through' : 'text-[#1E293B]'}>{item.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Comments */}
              <div>
                <p className="text-[13px] font-semibold text-[#0F172A] mb-3 flex items-center gap-1.5">
                  <MessageSquare size={14} className="text-[#475569]" />
                  Comments
                </p>
                {comments.length === 0 ? (
                  <p className="text-[13px] text-[#94A3B8]">No comments yet. Start the conversation below.</p>
                ) : (
                  <div className="space-y-3">
                    {comments.map((c) => (
                      <div key={c.id} className="flex gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-[#2563EB] text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                          {(c.user_name ?? '?').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px]">
                            <span className="font-semibold text-[#0F172A]">{c.user_name ?? 'Unknown'}</span>
                            <span className="text-[#94A3B8] ml-2 text-[11px]">{formatWhen(c.created_at)}</span>
                          </p>
                          <p className="text-[14px] text-[#1E293B] whitespace-pre-wrap break-words mt-0.5">{c.body}</p>
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
            </div>

            {/* Footer actions */}
            <div className="border-t border-[#E2E8F0] px-6 py-3 space-y-3">
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
                    className="shrink-0 flex items-center gap-1.5 px-3.5 py-2.5 rounded-[8px] bg-[#16A34A] text-white text-sm font-semibold hover:bg-[#15803D] disabled:opacity-60 transition-colors"
                  >
                    <CheckCircle2 size={15} /> Complete
                  </button>
                )}
                <Tooltip label="Open full task page">
                  <button
                    onClick={() => router.push(`/dashboard/tasks/${taskId}`)}
                    aria-label="Open full task page"
                    className="shrink-0 w-[42px] h-[42px] rounded-[8px] border border-[#E2E8F0] flex items-center justify-center text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A] transition-colors"
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
                  className="flex-1 resize-none rounded-[8px] border border-[#CBD5E1] bg-white px-3 py-2.5 text-[14px] text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] max-h-28"
                />
                <button
                  onClick={send}
                  disabled={!draft.trim() || sending || isFutureTask}
                  className="shrink-0 w-[42px] h-[42px] rounded-[8px] bg-[#2563EB] text-white flex items-center justify-center hover:bg-[#1D4ED8] disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] transition-colors"
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
            </div>
          </>
        )}
      </div>
    </div>
  )

  if (typeof document === 'undefined') return null
  return createPortal(body, document.body)
}
