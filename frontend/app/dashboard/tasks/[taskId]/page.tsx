'use client'

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { useToast } from '@/components/ui/Toast'
import { tasksApi } from '@/lib/api/tasks'
import { getNow } from '@/lib/clock'
import type { Task, TaskComment, TaskAttachment, TaskActivityLog, TaskCategory, TaskPriority, TaskStatus, TaskMasterConfig } from '@/lib/types/tasks'
import { TERMINAL_STATUS_PHASES } from '@/lib/types/tasks'
// import QuadrantBadge from '@/components/tasks/QuadrantBadge'
import AssigneeSelector from '@/components/tasks/AssigneeSelector'
import EditTaskModal from '@/components/tasks/EditTaskModal'
import TaskChecklistCard from '@/components/tasks/TaskChecklistCard'
import ProofOfCompletionCard from '@/components/tasks/ProofOfCompletionCard'
import StyledSelect from '@/components/ui/StyledSelect'
import Tooltip from '@/components/ui/Tooltip'
import { AttachmentChips } from '@/components/ui/AttachmentList'
import { formatBytes } from '@/lib/attachments'
import {
  ArrowLeft,
  CheckCircle2,
  RotateCcw,
  Trash2,
  Send,
  ShieldCheck,
  Paperclip,
  Calendar,
  User,
  Clock,
  Flag,
  Plus,
  Download,
  CheckSquare,
  Eye,
  Pencil,
  FileText,
  X,
  History,
  MoreVertical,
  XCircle,
} from 'lucide-react'

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Sentinel values for the Status dropdown's terminal "close" actions. They are never
// real status ids — picking one opens the required-reason box instead of setting a status.
const MARK_TASK = '__mark_task_incomplete__'
const MARK_MY_PART = '__mark_my_part_incomplete__'

function getInitials(name: string): string {
  if (!name) return ''
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
}

const avatarColors = [
  'bg-[#2563EB]', 'bg-[#7C3AED]', 'bg-[#059669]',
  'bg-[#D97706]', 'bg-[#DC2626]', 'bg-[#0891B2]',
]
function avatarColor(name: string): string {
  if (!name) return avatarColors[0]
  let h = 0; for (let i = 0; i < name.length; i++) h += name.charCodeAt(i)
  return avatarColors[h % avatarColors.length]
}

function formatDate(str: string): string {
  return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * Inline hover chip: shows a dark tooltip listing `items` above the trigger text.
 * Matches the software's tooltip convention (see components/projects/GanttBar) —
 * #0F172A card, white text, soft shadow, pointer-events-none. Renders nothing on
 * hover when the list is empty. Uses spans only (lives inside <p>, phrasing content).
 */
function HoverList({ trigger, heading, items, className = '' }: {
  trigger: React.ReactNode
  heading: string
  items: string[]
  className?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <span
      className={`relative inline-block ${className}`}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span className="underline decoration-dotted decoration-current/40 underline-offset-2">{trigger}</span>
      {show && items.length > 0 && (
        <span className="absolute bottom-full left-0 mb-1.5 z-40 w-max max-w-[240px] rounded-[8px] bg-[#0F172A] px-3 py-2 text-left shadow-[0_8px_24px_rgba(0,0,0,0.2)] pointer-events-none">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8] mb-1">{heading}</span>
          {items.map((it, i) => (
            <span key={i} className="block text-[11px] leading-snug text-white whitespace-pre-wrap">{it}</span>
          ))}
        </span>
      )}
    </span>
  )
}

function formatCountdown(secs: number): string {
  if (secs <= 0) return ''
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function deadlineColor(deadline?: string): string {
  if (!deadline) return 'text-[#475569]'
  const d = new Date(deadline)
  const now = getNow()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dl = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  if (dl < today) return 'text-[#DC2626] font-semibold'
  if (dl.getTime() === today.getTime()) return 'text-[#D97706] font-semibold'
  return 'text-[#475569]'
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={`bg-[#F1F5F9] rounded animate-pulse ${className ?? ''}`}
    />
  )
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-2/3" />
      <div className="flex gap-6">
        <div className="flex-1 space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        <div className="w-72 space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    </div>
  )
}

// ─── Comment component ────────────────────────────────────────────────────────

function CommentItem({
  comment,
  orgId,
  taskId,
  currentUserId,
  onDeleted,
  canSubmitProof = false,
  proofAllowedExtensions = [],
  onMarkProof,
  markingProofId,
}: {
  comment: TaskComment
  orgId: string
  taskId: string
  currentUserId: string
  onDeleted: () => void
  /** Current user may promote their own comment files to proof (proof required, they're a non-CC assignee, task open). */
  canSubmitProof?: boolean
  proofAllowedExtensions?: string[]
  onMarkProof?: (attachmentId: string) => void
  markingProofId?: string | null
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Long comments are collapsed by default; toggle to read the whole thing.
  const [expanded, setExpanded] = useState(false)
  const isLong = comment.body.length > 280

  async function confirmDelete() {
    setDeleting(true)
    try {
      await tasksApi.deleteComment(orgId, taskId, comment.id)
      onDeleted()
    } finally {
      setDeleting(false)
      setConfirmOpen(false)
    }
  }

  return (
    <div className="flex gap-3">
      <div
        className={[
          'w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5',
          comment.user_name
            ? `${avatarColor(comment.user_name)} text-white text-[10px] font-bold`
            : 'bg-[#E2E8F0]',
        ].join(' ')}
      >
        {comment.user_name ? getInitials(comment.user_name) : <User size={14} className="text-[#64748B]" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-[#0F172A]">{comment.user_name}</span>
          <span className="text-xs text-[#64748B]">{formatDate(comment.created_at)}</span>
        </div>
        <p className={`mt-1 text-sm text-[#1E293B] leading-relaxed whitespace-pre-wrap ${isLong && !expanded ? 'line-clamp-4' : ''}`}>
          {comment.body}
        </p>
        {isLong && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-0.5 text-xs font-semibold text-[#2563EB] hover:text-[#1D4ED8] transition-colors"
          >
            {expanded ? 'Show less' : 'Read more'}
          </button>
        )}
        {comment.attachments && comment.attachments.length > 0 && (
          <AttachmentChips
            attachments={comment.attachments}
            onDownload={(a) => tasksApi.downloadAttachment(orgId, taskId, a.id)}
          />
        )}
        {/* Promote my own comment files to proof (when the task asks for proof). */}
        {canSubmitProof && onMarkProof && (comment.attachments ?? []).map((a) => {
          const mine = (a.uploaded_by_user_id ?? comment.user_id) === currentUserId
          const extOk = proofAllowedExtensions.length === 0 ||
            proofAllowedExtensions.includes((a.file_name.split('.').pop() ?? '').toLowerCase())
          if (!mine || a.is_proof || !extOk) return null
          return (
            <Tooltip key={`mp-${a.id}`} label={`Use "${a.file_name}" as your proof of completion`}>
              <button
                onClick={() => onMarkProof(a.id)}
                disabled={markingProofId === a.id}
                className="mt-1 mr-2 inline-flex items-center gap-1 text-[11px] font-semibold text-[#2563EB] hover:text-[#1D4ED8] disabled:opacity-60 transition-colors"
              >
                <ShieldCheck size={12} /> Mark “{a.file_name}” as proof
              </button>
            </Tooltip>
          )
        })}
        {canSubmitProof && (comment.attachments ?? []).some((a) => a.is_proof) && (
          <p className="mt-1 text-[11px] text-[#16A34A] inline-flex items-center gap-1"><ShieldCheck size={12} /> Marked as proof</p>
        )}
      </div>
      {comment.user_id === currentUserId && (
        <Tooltip label="Delete comment">
          <button
            onClick={() => setConfirmOpen(true)}
            aria-label="Delete comment"
            className="text-[#64748B] hover:text-[#DC2626] transition-colors shrink-0"
          >
            <Trash2 size={13} />
          </button>
        </Tooltip>
      )}

      {/* Our own confirmation dialog (no browser confirm) */}
      {confirmOpen && createPortal(
        <div
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget && !deleting) setConfirmOpen(false) }}
          role="dialog"
          aria-modal="true"
        >
          <div className="relative w-full max-w-sm bg-white rounded-t-[16px] sm:rounded-[12px] shadow-[0_8px_32px_rgba(0,0,0,0.16)] border border-[#E2E8F0] p-6">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-[#FEE2E2] flex items-center justify-center shrink-0">
                <Trash2 size={18} className="text-[#DC2626]" />
              </div>
              <div className="min-w-0">
                <h3 className="text-[16px] font-semibold text-[#0F172A]">Delete this comment?</h3>
                <p className="text-sm text-[#475569] mt-1">This can’t be undone. The comment will be removed for everyone.</p>
              </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={deleting}
                className="w-full sm:w-auto px-4 py-[9px] text-sm font-semibold text-[#475569] bg-white border border-[#CBD5E1] rounded-[8px] hover:bg-[#F8FAFC] disabled:opacity-60 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleting}
                className="w-full sm:w-auto px-4 py-[9px] text-sm font-semibold text-white bg-[#DC2626] rounded-[8px] hover:bg-[#B91C1C] disabled:opacity-60 transition-colors"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

// ─── Activity log item ────────────────────────────────────────────────────────

function ActivityItem({ log }: { log: TaskActivityLog }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-7 h-7 rounded-full bg-[#EFF6FF] flex items-center justify-center shrink-0 mt-0.5">
        <Clock size={13} className="text-[#2563EB]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[#1E293B]">
          <span className="font-semibold">{log.performed_by?.name ?? 'Someone'}</span>{' '}
          <span className="text-[#475569]">{log.action.replace(/_/g, ' ')}</span>
        </p>
        {!!log.metadata?.reason && (
          <p className="text-xs text-[#475569] mt-0.5 italic">"{String(log.metadata.reason)}"</p>
        )}
        <p className="text-xs text-[#64748B] mt-0.5">{formatDate(log.created_at)}</p>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TaskDetailPage() {
  const { user } = useAuth()
  const { addToast } = useToast()
  const params = useParams()
  const router = useRouter()
  const orgId = user?.organizationId ?? ''
  const taskId = params.taskId as string

  const [task, setTask] = useState<Task | null>(null)
  const [categories, setCategories] = useState<TaskCategory[]>([])
  const [priorities, setPriorities] = useState<TaskPriority[]>([])
  const [statuses, setStatuses] = useState<TaskStatus[]>([])
  const [comments, setComments] = useState<TaskComment[]>([])
  // Every attachment on the task — creation-time/task-level files AND files shared in
  // comments — shown together in the sidebar Attachments card.
  const [allAttachments, setAllAttachments] = useState<TaskAttachment[]>([])
  const [uploadingAttachment, setUploadingAttachment] = useState(false)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  // Attachment pending deletion — drives the confirm dialog.
  const [attachmentToDelete, setAttachmentToDelete] = useState<TaskAttachment | null>(null)
  const [deletingAttachment, setDeletingAttachment] = useState(false)
  const attachInputRef = useRef<HTMLInputElement>(null)
  const [activityLogs, setActivityLogs] = useState<TaskActivityLog[]>([])
  const [loading, setLoading] = useState(true)
  const [config, setConfig] = useState<TaskMasterConfig | null>(null)
  const [showActivity, setShowActivity] = useState(false)
  // Overflow (kebab) menu that holds the destructive Delete action.
  const [showActionsMenu, setShowActionsMenu] = useState(false)
  const actionsMenuRef = useRef<HTMLDivElement>(null)
  const [commentText, setCommentText] = useState('')
  const [commentFiles, setCommentFiles] = useState<File[]>([])
  const [sendingComment, setSendingComment] = useState(false)
  const [commentError, setCommentError] = useState<string | null>(null)
  const commentFileInputRef = useRef<HTMLInputElement>(null)
  const commentTextareaRef = useRef<HTMLTextAreaElement>(null)
  // Bumped to force the proof card to re-list files (e.g. after "mark as proof" on a comment).
  const [proofReloadToken, setProofReloadToken] = useState(0)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [selectedStatusId, setSelectedStatusId] = useState('')
  const [deleteReason, setDeleteReason] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [editingAssignees, setEditingAssignees] = useState(false)
  const [editAssigneesList, setEditAssigneesList] = useState<import('@/lib/types/tasks').SelectedAssignee[]>([])
  const [savingAssignees, setSavingAssignees] = useState(false)
  const [assigneeError, setAssigneeError] = useState<string | null>(null)
  const [editingCompletionMode, setEditingCompletionMode] = useState(false)
  const [completionModeDraft, setCompletionModeDraft] = useState<'any_can_complete' | 'all_must_complete'>('any_can_complete')
  const [savingCompletionMode, setSavingCompletionMode] = useState(false)
  const [reopenSecondsLeft, setReopenSecondsLeft] = useState(0)
  const [showReopenModal, setShowReopenModal] = useState(false)
  const [reopenReason, setReopenReason] = useState('')
  const [showEditModal, setShowEditModal] = useState(false)
  // Marking incomplete: which outcome we're capturing a reason for — the whole task
  // ('task') or only my own part ('my_part', all_must_complete). Null = box closed.
  const [incompleteTarget, setIncompleteTarget] = useState<null | 'task' | 'my_part'>(null)
  const [incompleteReason, setIncompleteReason] = useState('')
  // Reopening ONE assignee's finished part (all_must_complete): whose, + an optional note.
  const [reopenPartTarget, setReopenPartTarget] = useState<string | null>(null)
  const [reopenPartReason, setReopenPartReason] = useState('')
  // Owner override: closing the whole all_must task as Complete while some parts are
  // still pending — shows a heads-up first.
  const [confirmCompleteAll, setConfirmCompleteAll] = useState(false)

  useEffect(() => {
    if (!task?.reopen_expires_at) { setReopenSecondsLeft(0); return }
    const tick = () => {
      const secs = Math.max(0, Math.round((new Date(task.reopen_expires_at!).getTime() - getNow().getTime()) / 1000))
      setReopenSecondsLeft(secs)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [task?.reopen_expires_at])

  const loadTask = useCallback(async () => {
    if (!orgId || !taskId) return
    try {
      const [t, cats, pris, sts, cmts, logs, atts, cfg] = await Promise.all([
        tasksApi.getTask(orgId, taskId).catch(() => null),
        tasksApi.getCategories(orgId).catch(() => []),
        tasksApi.getPriorities(orgId).catch(() => []),
        tasksApi.getStatuses(orgId).catch(() => []),
        tasksApi.getComments(orgId, taskId).catch(() => []),
        tasksApi.getLogs(orgId, taskId).catch(() => []),
        tasksApi.listAllAttachments(orgId, taskId).catch(() => []),
        tasksApi.getConfig(orgId).catch(() => null),
      ])
      setTask(t)
      setCategories(cats)
      setPriorities(pris)
      setStatuses(sts)
      setComments(cmts)
      setActivityLogs(logs)
      setAllAttachments(atts)
      setConfig(cfg)
      if (t) setSelectedStatusId(t.status_id)
    } finally {
      setLoading(false)
    }
  }, [orgId, taskId])

  useEffect(() => { loadTask() }, [loadTask])

  // WhatsApp-style auto-grow comment box: shrinks to a single line when empty,
  // grows with the text up to a cap, then scrolls internally. Runs on every
  // change (typing, and reset to empty after send).
  useEffect(() => {
    const el = commentTextareaRef.current
    if (!el) return
    el.style.height = 'auto' // reset so it can shrink back to the default
    el.style.height = `${Math.min(el.scrollHeight, 120)}px` // cap ≈ 4 lines, then scroll
  }, [commentText])

  // Close the kebab menu on outside click / Escape. The menu is absolutely anchored
  // to its button (not a fixed portal), so it never drifts.
  useEffect(() => {
    if (!showActionsMenu) return
    function onDoc(e: MouseEvent) {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target as Node)) setShowActionsMenu(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setShowActionsMenu(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [showActionsMenu])

  // Shared status (any_can_complete) — one status for everyone; any assignee can move it.
  async function handleSharedStatusChange(newStatusId: string) {
    if (!task) return
    setSelectedStatusId(newStatusId)
    try {
      const updated = await tasksApi.setSharedStatus(orgId, taskId, newStatusId)
      setTask(updated)
      setSelectedStatusId(updated.status_id)
    } catch {
      setSelectedStatusId(task.status_id)
    }
  }

  // My own status track (all_must_complete) — moves only my part.
  async function handleMyTrackChange(newStatusId: string) {
    if (!task) return
    try {
      const updated = await tasksApi.setAssigneeStatus(orgId, taskId, newStatusId)
      setTask(updated)
      setSelectedStatusId(updated.status_id)
    } catch {
      // ignore — the select reverts to the task's value on next render
    }
  }

  // Creator/admin moving a specific person's track (all_must_complete).
  async function handleAssigneeRowStatus(userId: string, newStatusId: string) {
    if (!task) return
    try {
      const updated = await tasksApi.setAssigneeStatus(orgId, taskId, newStatusId, userId)
      setTask(updated)
      setSelectedStatusId(updated.status_id)
    } catch {
      // ignore
    }
  }

  // Surface a backend reason (e.g. the proof / checklist gate) via the app's own toast —
  // never a native browser dialog.
  function showActionError(e: any) {
    const msg = e?.response?.data?.message ?? e?.message ?? 'Something went wrong.'
    addToast(Array.isArray(msg) ? msg.join('\n') : msg, 'warning')
  }

  async function handleCompleteAssignee(userId: string) {
    setActionLoading(`complete-${userId}`)
    try {
      const updated = await tasksApi.completeAssignee(orgId, taskId, userId)
      setTask(updated)
      setSelectedStatusId(updated.status_id)
    } catch (e) {
      showActionError(e)
    } finally {
      setActionLoading(null)
    }
  }

  // Assigner reopens ONE person's finished part for rework (all_must_complete). Others untouched.
  async function handleReopenAssigneePart(userId: string) {
    setActionLoading(`reopen-part-${userId}`)
    try {
      const updated = await tasksApi.reopenAssigneePart(orgId, taskId, userId, reopenPartReason.trim() || undefined)
      setTask(updated)
      setSelectedStatusId(updated.status_id)
      setReopenPartTarget(null)
      setReopenPartReason('')
    } catch (e) {
      showActionError(e)
    } finally {
      setActionLoading(null)
    }
  }

  async function handleComplete() {
    setActionLoading('complete')
    try {
      const updated = await tasksApi.completeTask(orgId, taskId)
      setTask(updated)
      setSelectedStatusId(updated.status_id)
      await loadTask()
    } catch (e) {
      showActionError(e)
    } finally {
      setActionLoading(null)
    }
  }

  // Owner override — force-complete the whole all_must task for everyone.
  async function handleCompleteWholeTask() {
    setActionLoading('complete')
    try {
      const updated = await tasksApi.completeTask(orgId, taskId, true)
      setTask(updated)
      setSelectedStatusId(updated.status_id)
      setConfirmCompleteAll(false)
      await loadTask()
    } catch (e) {
      setConfirmCompleteAll(false)
      showActionError(e)
    } finally {
      setActionLoading(null)
    }
  }

  async function handleReopen(reason?: string) {
    setActionLoading('reopen')
    try {
      const updated = await tasksApi.reopenTask(orgId, taskId, reason)
      setTask(updated)
      setSelectedStatusId(updated.status_id)
      setShowReopenModal(false)
      setReopenReason('')
      await loadTask()
    } catch (e) {
      showActionError(e)
    } finally {
      setActionLoading(null)
    }
  }

  // Close the whole task as Incomplete (reason required). Used by any assignee in
  // any_can_complete mode, and by the creator/admin in all_must_complete mode.
  async function handleMarkIncomplete() {
    if (!incompleteReason.trim()) return
    setActionLoading('incomplete')
    try {
      const updated = await tasksApi.markIncomplete(orgId, taskId, incompleteReason.trim())
      setTask(updated)
      setSelectedStatusId(updated.status_id)
      setIncompleteTarget(null)
      setIncompleteReason('')
      await loadTask()
    } catch (e) {
      showActionError(e)
    } finally {
      setActionLoading(null)
    }
  }

  // all_must_complete: flag only my own part as can't-complete (reason required).
  async function handleFlagMyPart() {
    if (!incompleteReason.trim()) return
    setActionLoading('flag')
    try {
      const updated = await tasksApi.flagCannotComplete(orgId, taskId, incompleteReason.trim())
      setTask(updated)
      setSelectedStatusId(updated.status_id)
      setIncompleteTarget(null)
      setIncompleteReason('')
    } catch (e) {
      showActionError(e)
    } finally {
      setActionLoading(null)
    }
  }

  async function handleDelete() {
    // The backend requires a non-blank reason — catch it here so the field's
    // "(optional)" label never lies and a blank submit doesn't silently no-op.
    if (!deleteReason.trim()) {
      addToast('A reason is required to delete this task.', 'warning')
      return
    }
    setActionLoading('delete')
    try {
      await tasksApi.deleteTask(orgId, taskId, deleteReason.trim())
      router.push('/dashboard/tasks')
    } catch (e) {
      showActionError(e)
      setActionLoading(null)
    }
  }

  async function handleSendComment() {
    // A comment may be text-only, file-only, or both — but never entirely empty.
    if (!commentText.trim() && commentFiles.length === 0) return
    setSendingComment(true)
    setCommentError(null)
    const hadText = !!commentText.trim()
    let created: TaskComment | null = null
    try {
      created = await tasksApi.addComment(orgId, taskId, commentText.trim())
      if (commentFiles.length > 0) {
        try {
          for (const file of commentFiles) {
            await tasksApi.uploadCommentAttachment(orgId, taskId, created.id, file)
          }
        } catch {
          // The comment posted but a file upload failed (e.g. storage error).
          if (!hadText) {
            // Nothing worth keeping — roll back the empty, attachment-less comment.
            await tasksApi.deleteComment(orgId, taskId, created.id).catch(() => {})
            setCommentError('Couldn’t upload the file. Nothing was posted — please try again.')
          } else {
            // Keep the text; just report the failed attachment and refresh state.
            setComments(await tasksApi.getComments(orgId, taskId).catch(() => comments))
            await refreshAllAttachments()
            setCommentText('')
            setCommentError('Your comment was posted, but the file failed to upload. Try attaching it again.')
          }
          return
        }
        // Reload so the comment shows its now-persisted attachments.
        setComments(await tasksApi.getComments(orgId, taskId).catch(() => [...comments, created!]))
        // Comment files also belong in the sidebar Attachments card.
        await refreshAllAttachments()
      } else {
        setComments((prev) => [...prev, created!])
      }
      setCommentText('')
      setCommentFiles([])
    } catch (err) {
      // The request errored, but the comment may still have been created server-side
      // (a flaky/slow response after the DB write — the recipient can even get the
      // notification). Reconcile: if our comment is now on the server, treat it as
      // posted rather than showing a false failure.
      console.error('addComment failed:', err)
      const sent = commentText.trim()
      const fresh = await tasksApi.getComments(orgId, taskId).catch(() => null)
      const posted =
        !!fresh &&
        fresh.some((c) => c.user_id === user?.id && c.body === sent && !comments.some((old) => old.id === c.id))
      if (fresh && posted) {
        setComments(fresh)
        await refreshAllAttachments()
        setCommentText('')
        setCommentFiles([])
      } else {
        setCommentError('Couldn’t post your comment. Please try again.')
      }
    } finally {
      setSendingComment(false)
    }
  }

  async function refreshAllAttachments() {
    setAllAttachments(await tasksApi.listAllAttachments(orgId, taskId).catch(() => []))
  }

  async function handleUploadTaskAttachment(files: File[]) {
    if (files.length === 0) return
    setUploadingAttachment(true)
    setAttachmentError(null)
    try {
      for (const file of files) {
        await tasksApi.uploadTaskAttachment(orgId, taskId, file)
      }
      await refreshAllAttachments()
    } catch {
      // Reflect whatever did upload, then surface a friendly message.
      await refreshAllAttachments()
      setAttachmentError('Couldn’t upload the file. Please try again.')
    } finally {
      setUploadingAttachment(false)
    }
  }

  // Only the uploader can remove — the card only surfaces the button in that case,
  // and the backend enforces it regardless. Confirmed via a dialog first.
  async function handleRemoveAttachment(a: TaskAttachment) {
    setAttachmentError(null)
    setDeletingAttachment(true)
    const prev = allAttachments
    setAllAttachments((list) => list.filter((x) => x.id !== a.id)) // optimistic
    try {
      await tasksApi.deleteAttachment(orgId, taskId, a.id)
    } catch {
      setAllAttachments(prev) // revert
      setAttachmentError('Couldn’t remove the attachment. Please try again.')
    } finally {
      setDeletingAttachment(false)
      setAttachmentToDelete(null)
    }
  }

  // Promote a file the current user shared in a comment to be their proof of completion.
  async function handleMarkCommentAsProof(attachmentId: string) {
    setActionLoading(`mark-proof-${attachmentId}`)
    try {
      await tasksApi.markCommentAttachmentAsProof(orgId, taskId, attachmentId)
      await loadTask()
      setProofReloadToken((t) => t + 1)
      setComments(await tasksApi.getComments(orgId, taskId).catch(() => comments))
    } catch {
      // ignore
    } finally {
      setActionLoading(null)
    }
  }

  async function handleSaveAssignees() {
    if (!task) return
    // A task must have someone to actually do the work — at least one primary
    // (non-CC) assignee. A CC-only assignment is not allowed.
    if (editAssigneesList.filter((a) => !a.is_cc).length === 0) {
      setAssigneeError('At least one assignee is required — CC-only is not allowed. Someone must be responsible for the work.')
      return
    }
    setAssigneeError(null)
    setSavingAssignees(true)
    try {
      // ONE atomic call, replacing the old client-side diff against the add/remove
      // endpoints. That approach had three real faults:
      //   - a CC↔assignee flip was done as remove-then-re-add, which destroyed that
      //     person's status and completion progress and sent them a contradictory
      //     "removed you" + "assigned you" pair for a single click;
      //   - every call was wrapped in `.catch(() => null)`, so a rejected change (no
      //     permission, ineligible assignee) looked like a success;
      //   - a partial failure left the roster half-applied.
      // The backend reconciles the whole roster in one transaction instead, flipping
      // roles in place and soft-removing so history survives.
      //
      // Send only what this user may change: a participant without assigner rights
      // gets to manage CC, and omitting `assignee_user_ids` leaves the working
      // roster untouched rather than silently clearing it.
      await tasksApi.updateTask(orgId, taskId, {
        ...(canEditRoster
          ? { assignee_user_ids: editAssigneesList.filter((a) => !a.is_cc).map((a) => a.user_id) }
          : {}),
        cc_user_ids: editAssigneesList.filter((a) => a.is_cc).map((a) => a.user_id),
      } as any)
      await loadTask()
      setEditingAssignees(false)
    } catch (e) {
      // Surface the server's real reason (outside your assignable set, not eligible
      // to hold a task, task is closed) instead of failing silently.
      const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message
      setAssigneeError(
        (Array.isArray(m) ? m[0] : m) || 'Could not save those changes. Please try again.',
      )
    } finally {
      setSavingAssignees(false)
    }
  }

  async function handleSaveCompletionMode() {
    if (!task) return
    if (completionModeDraft === task.completion_mode) { setEditingCompletionMode(false); return }
    setSavingCompletionMode(true)
    try {
      await tasksApi.updateTask(orgId, taskId, { completion_mode: completionModeDraft })
      await loadTask()
      setEditingCompletionMode(false)
    } finally {
      setSavingCompletionMode(false)
    }
  }

  // Mirror the backend rule (checkTaskPermission → 'task_delete_roles'): delete is
  // allowed only for platform admins, or when the org opens it to all members
  // ('employee' in task_delete_roles). Being the creator does NOT grant delete — so
  // don't show the button to creators who'd just get a 403.
  const canDelete = !!user?.is_admin || (config?.task_delete_roles ?? []).includes('employee')

  if (!orgId) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="font-semibold text-[#0F172A]">No organization found</p>
      </div>
    )
  }

  if (loading) {
    return <DetailSkeleton />
  }

  if (!task) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="font-semibold text-[#0F172A]">Task not found</p>
        <button
          onClick={() => router.back()}
          className="mt-3 text-sm text-[#2563EB] hover:underline"
        >
          Back to Tasks
        </button>
      </div>
    )
  }

  const category = categories.find((c) => c.id === task.category_id) ?? task.category
  const priority = priorities.find((p) => p.id === task.priority_id) ?? task.priority
  // The Status control only moves a task between OPEN states; terminal states
  // (Complete / Incomplete) are reached via the actions and shown read-only here.
  const openStatuses = statuses.filter((s) => !TERMINAL_STATUS_PHASES.includes(s.type))
  const assignees = task.assignees?.filter((a) => !a.is_cc) ?? []
  const ccUsers = task.assignees?.filter((a) => a.is_cc) ?? []
  const currentUserIsCC = task.assignees?.some((a) => a.user_id === user?.id && a.is_cc) ?? false
  const isCreator = task.created_by_user_id === user?.id
  const isFutureTask = task ? new Date(task.created_at) > getNow() : false
  const canEdit = (isCreator || user?.is_admin) && !isFutureTask

  // Completion model drives how status + completion behave (see the two modes below).
  const isAllMustComplete = task.completion_mode === 'all_must_complete'
  const myAssignee = assignees.find((a) => a.user_id === user?.id)
  const isAssignee = !!myAssignee && !isFutureTask
  const completedCount = assignees.filter((a) => a.is_completed).length
  const totalAssignees = assignees.length
  // Parts flagged "can't complete" that aren't done — these block the task from
  // auto-completing (all_must_complete), so the owner must resolve or close it.
  const blockedCount = assignees.filter((a) => a.cannot_complete && !a.is_completed).length
  const pendingCount = totalAssignees - completedCount - blockedCount
  const notStartedId = openStatuses.find((s) => s.type === 'not_started')?.id ?? openStatuses[0]?.id ?? ''
  // The task's real overall status (roll-up), independent of the top control's local value.
  const isTaskTerminal = !!task.status && TERMINAL_STATUS_PHASES.includes(task.status.type)
  const isIncompleteStatus = task.status?.type === 'incomplete'
  const isPartiallyCompletedStatus = task.status?.type === 'partially_completed'
  // Split rights (matches the backend's updateTask): reassigning the work is an
  // assigner-level act, but looping a colleague in as CC changes nobody's workload
  // and is trivially undone — so anyone actually on the task may manage CC. A closed
  // task's people are a frozen record, so nobody edits them there.
  const canManageCc = (!!canEdit || isAssignee || currentUserIsCC) && !isFutureTask && !isTaskTerminal
  const canEditRoster = !!canEdit && !isTaskTerminal
  const myTrackId = myAssignee?.status_id ?? notStartedId
  const canMoveSharedStatus = (isAssignee || !!canEdit) && !isFutureTask
  // Names of assignees who haven't finished — used in the owner's heads-up before a
  // force-complete/close of the whole task.
  const pendingNames = assignees.filter((a) => !a.is_completed).map((a) => a.user?.name ?? a.user_name ?? 'Someone')

  return (
    // On lg+, fill the fixed-height <main> so the two detail columns can scroll
    // independently instead of the whole page. On mobile it's a normal flowing page.
    <div className="space-y-6 max-w-7xl lg:h-full lg:flex lg:flex-col lg:overflow-hidden">
      {isFutureTask && (
        <div className="bg-[#FEF2F2] border border-[#FEE2E2] rounded-[10px] px-6 py-4 text-sm font-semibold text-[#991B1B] shrink-0">
          ⌛ This task was created in a simulated future ({new Date(task.created_at).toLocaleDateString()}). To interact with it, please time-travel to this date or later.
        </div>
      )}
      {/* Header — a small, unobtrusive back arrow, then the title; actions on the right */}
      <div className="flex items-start justify-between gap-4 flex-wrap shrink-0">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <Tooltip label="Back">
            <button
              onClick={() => router.back()}
              aria-label="Back"
              className="mt-1.5 w-6 h-6 rounded-[6px] flex items-center justify-center text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition-colors shrink-0"
            >
              <ArrowLeft size={16} />
            </button>
          </Tooltip>
          <h1 className="text-[28px] font-bold text-[#0F172A] leading-tight min-w-0">{task.title}</h1>
          {/* Edit — a pencil right beside the title */}
          {canEdit && (
            <Tooltip label="Edit task">
              <button
                onClick={() => setShowEditModal(true)}
                aria-label="Edit task"
                className="mt-1.5 w-7 h-7 rounded-[6px] flex items-center justify-center text-[#64748B] hover:text-[#2563EB] hover:bg-[#EFF6FF] transition-colors shrink-0"
              >
                <Pencil size={16} />
              </button>
            </Tooltip>
          )}
        </div>
        <div className="flex items-start gap-2 shrink-0">
          <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2">
          {!isTaskTerminal && !currentUserIsCC ? (
            isAllMustComplete ? (
              // Everyone must finish their own part — personal action(s) + a live counter.
              // (Incomplete / Can't-complete now live inside the Status dropdown.)
              <div className="flex items-center gap-2.5">
                {isAssignee && (
                  myAssignee?.is_completed ? (
                    <span className="flex items-center gap-2 px-3.5 py-[8px] text-sm font-semibold text-[#16A34A] bg-[#F0FDF4] border border-[#BBF7D0] rounded-[8px] select-none">
                      <CheckCircle2 size={15} />
                      You&apos;re done
                    </span>
                  ) : (
                    <button
                      onClick={handleComplete}
                      disabled={actionLoading === 'complete'}
                      className="flex items-center gap-2 px-4 py-[8px] text-sm font-semibold text-white bg-[#16A34A] rounded-[8px] hover:bg-[#15803D] disabled:opacity-60 transition-colors"
                    >
                      <CheckCircle2 size={15} />
                      {actionLoading === 'complete' ? 'Completing...' : 'Complete my part'}
                    </button>
                  )
                )}
                {/* Owner override — close the whole task for everyone (heads-up if pending). */}
                {canEdit && (
                  <Tooltip label="Complete the whole task for everyone">
                    <button
                      onClick={() => (pendingNames.length > 0 ? setConfirmCompleteAll(true) : handleCompleteWholeTask())}
                      disabled={actionLoading === 'complete'}
                      className="flex items-center gap-2 px-4 py-[8px] text-sm font-semibold text-[#16A34A] border border-[#BBF7D0] bg-white rounded-[8px] hover:bg-[#F0FDF4] disabled:opacity-60 transition-colors"
                    >
                      <CheckCircle2 size={15} />
                      Complete task
                    </button>
                  </Tooltip>
                )}
              </div>
            ) : (
              // Any one assignee can close the whole task via Complete. (Incomplete lives
              // in the Status dropdown.)
              (isAssignee || canEdit) ? (
                <button
                  onClick={handleComplete}
                  disabled={actionLoading === 'complete'}
                  className="flex items-center gap-2 px-4 py-[8px] text-sm font-semibold text-white bg-[#16A34A] rounded-[8px] hover:bg-[#15803D] disabled:opacity-60 transition-colors"
                >
                  <CheckCircle2 size={15} />
                  {actionLoading === 'complete' ? 'Completing...' : 'Complete'}
                </button>
              ) : null
            )
          ) : !currentUserIsCC && (
            reopenSecondsLeft > 0 ? (
              // Undo window open — a frictionless, reason-free revert for any participant,
              // so an accidental Complete/Incomplete can be taken back. Locks when it ends.
              <Tooltip label="Undo — revert this task to open (no reason needed while the window is open)">
                <button
                  onClick={() => handleReopen()}
                  disabled={actionLoading === 'reopen'}
                  className="flex items-center gap-2 px-4 py-[8px] text-sm font-semibold text-[#D97706] border border-[#FDE68A] bg-[#FEF9C3] rounded-[8px] hover:bg-[#FDE68A] disabled:opacity-60 transition-colors"
                >
                  <RotateCcw size={15} />
                  {actionLoading === 'reopen' ? 'Undoing…' : `Undo (${formatCountdown(reopenSecondsLeft)})`}
                </button>
              </Tooltip>
            ) : isCreator ? (
              // After the window it's locked — only the creator can reopen, with a reason.
              <button
                onClick={() => setShowReopenModal(true)}
                disabled={actionLoading === 'reopen'}
                className="flex items-center gap-2 px-4 py-[8px] text-sm font-semibold text-[#D97706] border border-[#FDE68A] bg-[#FEF9C3] rounded-[8px] hover:bg-[#FDE68A] disabled:opacity-60 transition-colors"
              >
                <RotateCcw size={15} />
                Reopen
              </button>
            ) : (
              // Locked outcome (read-only) for everyone else.
              <span
                className="flex items-center gap-2 px-4 py-[8px] text-sm font-semibold rounded-[8px] cursor-default select-none"
                style={{
                  backgroundColor: (task.status?.color ?? '#64748B') + '1A',
                  color: task.status?.color ?? '#64748B',
                  border: `1px solid ${(task.status?.color ?? '#64748B')}44`,
                }}
              >
                {task.status?.type === 'completed' ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                {task.status?.label ?? (isIncompleteStatus ? 'Incomplete' : 'Completed')}
              </span>
            )
          )}
          </div>
          {/* Per-person completion counter — plain text, right-aligned directly under the button. */}
          {!isTaskTerminal && !currentUserIsCC && isAllMustComplete && totalAssignees > 0 && (
            <span className="text-xs font-semibold text-[#475569] select-none">
              {completedCount}/{totalAssignees} completed
            </span>
          )}
          </div>
          {/* Overflow menu — holds the Activity log and the (destructive) Delete
              action, so neither gets a prominent primary button. */}
          <div ref={actionsMenuRef} className="relative">
            <Tooltip label="More">
              <button
                onClick={() => setShowActionsMenu((v) => !v)}
                aria-label="More actions"
                aria-haspopup="menu"
                aria-expanded={showActionsMenu}
                className="w-9 h-9 rounded-[8px] flex items-center justify-center text-[#475569] border border-[#CBD5E1] bg-white hover:bg-[#F8FAFC] hover:text-[#0F172A] transition-colors"
              >
                <MoreVertical size={16} />
              </button>
            </Tooltip>
            {showActionsMenu && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-1 z-50 w-44 rounded-[10px] border border-[#E2E8F0] bg-white shadow-[0_8px_24px_rgba(0,0,0,0.12)] py-1"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setShowActionsMenu(false); setShowActivity(true) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-[#0F172A] hover:bg-[#F8FAFC] transition-colors"
                >
                  <History size={14} className="text-[#475569]" />
                  Activity log
                </button>
                {canDelete && !showDeleteConfirm && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setShowActionsMenu(false); setShowDeleteConfirm(true) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-[#DC2626] hover:bg-[#FEF2F2] transition-colors"
                  >
                    <Trash2 size={14} />
                    Delete task
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* CC banner */}
      {currentUserIsCC && (
        <div className="flex items-center gap-2 text-[13px] text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded-[8px] px-3 py-2">
          <Eye size={14} className="shrink-0 text-[#D97706]" />
          You&apos;re CC&apos;d on this task — you can view and comment but cannot mark it complete.
        </div>
      )}

      {showEditModal && (
        <EditTaskModal
          task={task}
          categories={categories}
          priorities={priorities}
          statuses={statuses}
          onClose={() => setShowEditModal(false)}
          onSaved={(updated) => { setTask(updated); setSelectedStatusId(updated.status_id); setShowEditModal(false) }}
        />
      )}

      {/* Reopen reason modal (creator only) */}
      {showReopenModal && (
        <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-[12px] p-4 flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <div className="flex-1">
            <p className="text-sm font-semibold text-[#D97706]">Reopen this task?</p>
            <p className="text-xs text-[#92400E] mt-0.5">As the task creator, a reason is required.</p>
            <textarea
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              placeholder="Reason for reopening (required)"
              rows={2}
              className="mt-2 w-full border border-[#FDE68A] rounded-[8px] px-3 py-2 text-sm text-[#0F172A] placeholder:text-[#64748B] focus:outline-none bg-white focus:border-[#D97706] resize-none"
            />
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => handleReopen(reopenReason)}
              disabled={actionLoading === 'reopen' || !reopenReason.trim()}
              className="px-4 py-2 text-sm font-semibold text-white bg-[#D97706] rounded-[8px] hover:bg-[#B45309] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {actionLoading === 'reopen' ? 'Reopening...' : 'Confirm Reopen'}
            </button>
            <button
              onClick={() => { setShowReopenModal(false); setReopenReason('') }}
              className="px-4 py-2 text-sm font-semibold text-[#475569] bg-white border border-[#E2E8F0] rounded-[8px] hover:bg-[#F1F5F9] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Owner heads-up before force-completing the whole all_must task while some
          parts are still pending. */}
      {confirmCompleteAll && (
        <div className="bg-[#F0FDF4] border border-[#BBF7D0] rounded-[12px] p-4 flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <div className="flex-1">
            <p className="text-sm font-semibold text-[#15803D]">Complete the whole task?</p>
            <p className="text-xs text-[#166534] mt-0.5">
              Heads up — {pendingNames.slice(0, 3).join(', ')}
              {pendingNames.length > 3 ? ` +${pendingNames.length - 3} more` : ''}{' '}
              {pendingNames.length === 1 ? "hasn't" : "haven't"} completed their part. As the task owner,
              completing now closes it for everyone.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={handleCompleteWholeTask}
              disabled={actionLoading === 'complete'}
              className="px-4 py-2 text-sm font-semibold text-white bg-[#16A34A] rounded-[8px] hover:bg-[#15803D] disabled:opacity-60 transition-colors"
            >
              {actionLoading === 'complete' ? 'Completing...' : 'Complete for everyone'}
            </button>
            <button
              onClick={() => setConfirmCompleteAll(false)}
              className="px-4 py-2 text-sm font-semibold text-[#475569] bg-white border border-[#E2E8F0] rounded-[8px] hover:bg-[#F1F5F9] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Mark-incomplete reason box — required remark for closing the task (or my part)
          as not-done. Shown for both any_can_complete (whole task) and all_must_complete
          (my_part, or the creator closing the whole task). */}
      {incompleteTarget && (
        <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-[12px] p-4 flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <div className="flex-1">
            <p className="text-sm font-semibold text-[#DC2626]">
              {incompleteTarget === 'my_part' ? "Can't complete your part?" : 'Mark this task incomplete?'}
            </p>
            <p className="text-xs text-[#B91C1C] mt-0.5">
              {incompleteTarget === 'my_part'
                ? 'Your part will be flagged as not-done. A reason is required — the task creator will decide how to close the task.'
                : isAllMustComplete && pendingNames.length > 0
                  ? `Heads up — ${pendingNames.slice(0, 3).join(', ')}${pendingNames.length > 3 ? ` +${pendingNames.length - 3} more` : ''} ${pendingNames.length === 1 ? "hasn't" : "haven't"} finished. As the task owner, this closes it as not-done for everyone. A reason is required.`
                  : 'The task will be closed as not-done. A reason is required.'}
            </p>
            <textarea
              value={incompleteReason}
              onChange={(e) => setIncompleteReason(e.target.value)}
              placeholder="Reason (required)"
              rows={2}
              autoFocus
              className="mt-2 w-full border border-[#FECACA] rounded-[8px] px-3 py-2 text-sm text-[#0F172A] placeholder:text-[#64748B] focus:outline-none bg-white focus:border-[#DC2626] resize-none"
            />
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={incompleteTarget === 'my_part' ? handleFlagMyPart : handleMarkIncomplete}
              disabled={!incompleteReason.trim() || actionLoading === 'incomplete' || actionLoading === 'flag'}
              className="px-4 py-2 text-sm font-semibold text-white bg-[#DC2626] rounded-[8px] hover:bg-[#B91C1C] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {actionLoading === 'incomplete' || actionLoading === 'flag'
                ? 'Saving...'
                : incompleteTarget === 'my_part' ? "Flag my part" : 'Confirm Incomplete'}
            </button>
            <button
              onClick={() => { setIncompleteTarget(null); setIncompleteReason('') }}
              className="px-4 py-2 text-sm font-semibold text-[#475569] bg-white border border-[#E2E8F0] rounded-[8px] hover:bg-[#F1F5F9] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="bg-[#FEE2E2] border border-[#FECACA] rounded-[12px] p-4 flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <div className="flex-1">
            <p className="text-sm font-semibold text-[#DC2626]">Delete this task?</p>
            <input
              type="text"
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              placeholder="Reason for deletion (required)"
              autoFocus
              className="mt-2 w-full border border-[#FECACA] rounded-[8px] px-3 py-2 text-sm text-[#0F172A] placeholder:text-[#64748B] focus:outline-none bg-white focus:border-[#DC2626]"
            />
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={handleDelete}
              disabled={actionLoading === 'delete' || !deleteReason.trim()}
              className="px-4 py-2 text-sm font-semibold text-white bg-[#DC2626] rounded-[8px] hover:bg-[#B91C1C] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {actionLoading === 'delete' ? 'Deleting...' : 'Confirm Delete'}
            </button>
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="px-4 py-2 text-sm font-semibold text-[#475569] bg-white border border-[#E2E8F0] rounded-[8px] hover:bg-[#F1F5F9] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Description — right under the title, no box around it. */}
      {task.description && (
        <p className="text-sm text-[#1E293B] leading-relaxed whitespace-pre-wrap shrink-0 pl-8">{task.description}</p>
      )}

      {(
        <div className="flex flex-col lg:flex-row gap-6 lg:flex-1 lg:min-h-0">
          {/* Left panel — 60%; scrolls on its own within the viewport on lg+ */}
          <div className="flex-1 min-w-0 space-y-6 lg:min-h-0 lg:overflow-y-auto lg:pr-3">
            {/* Checklist — per-person in all_must_complete, shared otherwise */}
            {task.checklist && task.checklist.length > 0 && (
              <TaskChecklistCard
                task={task}
                orgId={orgId}
                taskId={taskId}
                currentUserId={user?.id ?? ''}
                canEdit={!!canEdit}
                onChanged={(updated) => setTask(updated)}
              />
            )}

            {/* Proof of completion — file-based, mode-aware (see ProofOfCompletionCard) */}
            {task.proof_required && (
              <ProofOfCompletionCard
                task={task}
                assignees={assignees}
                reloadToken={proofReloadToken}
                locked={isTaskTerminal}
                onChanged={() => { loadTask(); setProofReloadToken((t) => t + 1) }}
              />
            )}

            {/* Comments */}
            <div className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-6">
              <h3 className="flex items-center gap-2 text-[15px] font-semibold text-[#0F172A] mb-4">
                Comments
                {comments.length > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[#2563EB] text-white text-[11px] font-semibold">
                    {comments.length}
                  </span>
                )}
              </h3>
              <div className="space-y-4 mb-6">
                {comments.length === 0 ? (
                  <p className="text-sm text-[#475569]">No comments yet. Be the first to comment.</p>
                ) : (
                  comments.map((c) => (
                    <CommentItem
                      key={c.id}
                      comment={c}
                      orgId={orgId}
                      taskId={taskId}
                      currentUserId={user?.id ?? ''}
                      onDeleted={async () => {
                        setComments((prev) => prev.filter((x) => x.id !== c.id))
                        // A deleted comment takes its files with it — refresh the attachments
                        // list, and (if a file was a proof) the proof card + scoreboard, so
                        // nothing stale keeps counting.
                        await refreshAllAttachments()
                        if (task.proof_required) {
                          const fresh = await tasksApi.getTask(orgId, taskId).catch(() => null)
                          if (fresh) setTask(fresh)
                          setProofReloadToken((t) => t + 1)
                        }
                      }}
                      canSubmitProof={!!task.proof_required && isAssignee && !isTaskTerminal}
                      proofAllowedExtensions={task.proof_allowed_extensions ?? []}
                      onMarkProof={handleMarkCommentAsProof}
                      markingProofId={actionLoading?.startsWith('mark-proof-') ? actionLoading.replace('mark-proof-', '') : null}
                    />
                  ))
                )}
              </div>
              {/* Comment composer — WhatsApp-style: a single write box that holds
                  the attach (pin) button, the text field, and — once files are
                  picked — their chips, so attachments feel part of the comment. */}
              <div className="rounded-[12px] border border-[#CBD5E1] bg-white focus-within:border-2 focus-within:border-[#2563EB] transition-colors">
                {/* Selected-file chips — live inside the write box */}
                {commentFiles.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 px-3 pt-3">
                    {commentFiles.map((f, i) => (
                      <span
                        key={`${f.name}-${i}`}
                        className="inline-flex items-center gap-1.5 max-w-[220px] bg-[#EFF6FF] border border-[#BFDBFE] text-[#2563EB] text-xs font-medium pl-2 pr-1 py-1 rounded-[6px]"
                      >
                        <FileText size={12} className="shrink-0" />
                        <span className="truncate">{f.name}</span>
                        <span className="text-[#64748B] shrink-0">{formatBytes(f.size)}</span>
                        <Tooltip label="Remove file">
                          <button
                            type="button"
                            onClick={() => setCommentFiles((prev) => prev.filter((_, idx) => idx !== i))}
                            disabled={sendingComment}
                            className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[#2563EB] hover:bg-[#BFDBFE] hover:text-[#1D4ED8] disabled:opacity-50 transition-colors"
                            aria-label={`Remove ${f.name}`}
                          >
                            <X size={11} />
                          </button>
                        </Tooltip>
                      </span>
                    ))}
                  </div>
                )}
                {/* Input row: textarea • attach • send */}
                <div className="flex items-end gap-2 p-2">
                  <input
                    ref={commentFileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const picked = Array.from(e.target.files ?? [])
                      if (picked.length > 0) setCommentFiles((prev) => [...prev, ...picked])
                      e.target.value = '' // reset so the same file can be re-picked
                    }}
                  />
                  <textarea
                    ref={commentTextareaRef}
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value.slice(0, 1000))}
                    maxLength={1000}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleSendComment()
                      }
                    }}
                    disabled={sendingComment || isFutureTask}
                    placeholder={isFutureTask ? "Comments are locked on future tasks..." : "Add a comment... (Enter to send, Shift+Enter for new line)"}
                    rows={1}
                    className="flex-1 min-w-0 border-0 bg-transparent px-1 py-[6px] text-sm text-[#0F172A] placeholder:text-[#64748B] focus:outline-none resize-none max-h-[120px] overflow-y-auto"
                  />
                  {/* Attach files — sits right before Send */}
                  <Tooltip label="Attach files">
                    <button
                      type="button"
                      onClick={() => commentFileInputRef.current?.click()}
                      disabled={sendingComment || isFutureTask}
                      className="shrink-0 w-8 h-8 rounded-[8px] flex items-center justify-center text-[#475569] hover:bg-[#F1F5F9] hover:text-[#2563EB] disabled:text-[#CBD5E1] disabled:cursor-not-allowed transition-colors"
                      aria-label="Attach files"
                    >
                      <Paperclip size={16} className="-rotate-45" />
                    </button>
                  </Tooltip>
                  <Tooltip label="Send">
                    <button
                      onClick={handleSendComment}
                      disabled={sendingComment || isFutureTask || (!commentText.trim() && commentFiles.length === 0)}
                      aria-label="Send"
                      className="shrink-0 w-8 h-8 rounded-[8px] flex items-center justify-center text-white bg-[#2563EB] hover:bg-[#1D4ED8] disabled:bg-[#E2E8F0] disabled:text-[#64748B] disabled:cursor-not-allowed transition-colors"
                    >
                      <Send size={15} />
                    </button>
                  </Tooltip>
                </div>
              </div>
              {commentError && (
                <p className="mt-2 text-xs text-[#DC2626] bg-[#FEE2E2] border border-[#FECACA] rounded-[8px] px-3 py-2">
                  {commentError}
                </p>
              )}
            </div>
          </div>

          {/* Right panel — 40%; scrolls on its own within the viewport on lg+ */}
          <div className="w-full lg:w-80 shrink-0 space-y-4 lg:min-h-0 lg:overflow-y-auto lg:pr-3">

            {/* Status — overflow-visible so the status dropdown can extend past the card */}
            <div className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] overflow-visible">
              <div className="flex items-center gap-2 px-4 py-2.5 bg-[#EFF6FF] border-b border-[#BFDBFE] rounded-t-[12px]">
                <span className="w-2 h-2 rounded-full bg-[#2563EB]" />
                <p className="text-[11px] font-bold text-[#2563EB] uppercase tracking-widest">Status</p>
              </div>
              <div className="p-4">
                {isTaskTerminal && task.status ? (
                  // Task is closed overall — read-only, with who completed it.
                  <div>
                    <span
                      className="inline-flex items-center rounded-[999px] px-3 py-1 text-sm font-medium"
                      style={{ backgroundColor: task.status.color + '22', color: task.status.color, border: `1px solid ${task.status.color}44` }}
                    >
                      {task.status.label}
                    </span>

                    {isIncompleteStatus ? (
                      // Incomplete is one deliberate call by the owner — single attribution is correct.
                      <>
                        {task.completed_by && (
                          <p className="mt-2 text-[12px] text-[#475569]">
                            Marked incomplete by <span className="font-semibold text-[#0F172A]">{task.completed_by.name}</span>
                            {task.completed_at && <span className="text-[#64748B]"> · {formatDate(task.completed_at)}</span>}
                          </p>
                        )}
                        {task.incomplete_reason && (
                          <p className="mt-2 text-[12px] text-[#B45309] bg-[#FFFBEB] border border-[#FDE68A] rounded-[8px] px-3 py-2 whitespace-pre-wrap">
                            <span className="font-semibold">Reason:</span> {task.incomplete_reason}
                          </p>
                        )}
                      </>
                    ) : isPartiallyCompletedStatus ? (
                      // Partially completed — show BOTH who finished and who couldn't (+ their reasons).
                      (() => {
                        const done = assignees.filter((a) => a.is_completed)
                        const couldnt = assignees.filter((a) => a.cannot_complete)
                        return (
                          <>
                            <p className="mt-2 text-[12px] text-[#475569]">
                              <span className="font-semibold text-[#0F172A]">{done.length} of {assignees.length}</span> completed
                              {task.completed_at && <span className="text-[#64748B]"> · {formatDate(task.completed_at)}</span>}
                            </p>
                            <ul className="mt-2 space-y-1.5">
                              {done.map((a) => (
                                <li key={a.id} className="flex items-start gap-1.5 text-[12px]">
                                  <CheckCircle2 size={13} className="text-[#16A34A] shrink-0 mt-[1px]" />
                                  <span className="font-medium text-[#0F172A] min-w-0">{a.user?.name ?? a.user_name ?? 'Unknown'}</span>
                                </li>
                              ))}
                              {couldnt.map((a) => (
                                <li key={a.id} className="flex items-start gap-1.5 text-[12px]">
                                  <XCircle size={13} className="text-[#EA580C] shrink-0 mt-[1px]" />
                                  <span className="min-w-0">
                                    <span className="font-medium text-[#0F172A]">{a.user?.name ?? a.user_name ?? 'Unknown'}</span>
                                    {a.cannot_complete_reason && <span className="text-[#B45309]"> — {a.cannot_complete_reason}</span>}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </>
                        )
                      })()
                    ) : isAllMustComplete ? (
                      // Collective completion — EVERY part counts, not just whoever finished last.
                      (() => {
                        const doneParts = [...assignees]
                          .filter((a) => a.is_completed)
                          .sort((a, b) => new Date(a.completed_at ?? 0).getTime() - new Date(b.completed_at ?? 0).getTime())
                        return (
                          <>
                            <p className="mt-2 text-[12px] text-[#475569]">
                              Completed by{' '}
                              <span className="font-semibold text-[#0F172A]">
                                all {doneParts.length} assignee{doneParts.length !== 1 ? 's' : ''}
                              </span>
                            </p>
                            <ul className="mt-2 space-y-1.5">
                              {doneParts.map((a) => {
                                const nm = a.user?.name ?? a.user_name ?? 'Unknown'
                                return (
                                  <li key={a.id} className="flex items-start gap-1.5 text-[12px]">
                                    <CheckCircle2 size={13} className="text-[#16A34A] shrink-0 mt-[1px]" />
                                    <span className="min-w-0">
                                      <span className="font-medium text-[#0F172A]">{nm}</span>
                                      {a.completed_at && <span className="text-[#64748B]"> · {formatDate(a.completed_at)}</span>}
                                    </span>
                                  </li>
                                )
                              })}
                            </ul>
                          </>
                        )
                      })()
                    ) : (
                      // any_can_complete — one person closes it for everyone; single name is right.
                      task.completed_by && (
                        <p className="mt-2 text-[12px] text-[#475569]">
                          Completed by <span className="font-semibold text-[#0F172A]">{task.completed_by.name}</span>
                          {task.completed_at && <span className="text-[#64748B]"> · {formatDate(task.completed_at)}</span>}
                        </p>
                      )
                    )}

                    <p className="mt-1 text-[11px] text-[#64748B]">
                      {reopenSecondsLeft > 0
                        ? `You can undo this for the next ${formatCountdown(reopenSecondsLeft)}. After that it locks.`
                        : isCreator
                          ? 'Reopen the task to change its status.'
                          : 'This task is locked. Only the task creator can reopen it.'}
                    </p>
                  </div>
                ) : isAllMustComplete ? (
                  <>
                  {isAssignee ? (
                    // My own status track — moves only my part. Once MY part is done, the
                    // track control no longer applies to me (there's no open state left to
                    // pick) — show a read-only "done" chip instead of a select that looks
                    // unset and silently no-ops on change.
                    myAssignee?.is_completed ? (
                      <>
                        <span className="inline-flex items-center gap-1.5 rounded-[999px] px-3 py-1 text-sm font-medium text-[#16A34A] bg-[#F0FDF4] border border-[#BBF7D0]">
                          <CheckCircle2 size={14} /> Your part is done
                        </span>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => { setIncompleteReason(''); setIncompleteTarget('task') }}
                            className="mt-2 flex items-center gap-1.5 text-[12px] font-semibold text-[#DC2626] hover:text-[#B91C1C] transition-colors"
                          >
                            <XCircle size={13} />
                            Mark whole task incomplete
                          </button>
                        )}
                        <p className="mt-2 text-[11px] text-[#64748B]">Everyone&apos;s progress is shown in Assignees below.</p>
                      </>
                    ) : (
                      <>
                        <StyledSelect
                          value={myTrackId}
                          onChange={(v) => {
                            if (v === MARK_MY_PART) { setIncompleteReason(''); setIncompleteTarget('my_part') }
                            else if (v === MARK_TASK) { setIncompleteReason(''); setIncompleteTarget('task') }
                            else handleMyTrackChange(v)
                          }}
                          options={[
                            ...openStatuses.map((s) => ({ value: s.id, label: s.label, color: s.color })),
                            { value: MARK_MY_PART, label: "Can't complete (my part)", variant: 'danger' as const, divider: true, action: true },
                            ...(canEdit ? [{ value: MARK_TASK, label: 'Mark whole task incomplete', variant: 'danger' as const, divider: true, action: true }] : []),
                          ]}
                        />
                        <p className="mt-2 text-[11px] text-[#64748B]">This is <span className="font-semibold text-[#64748B]">your</span> status. Everyone&apos;s progress is shown in Assignees below.</p>
                      </>
                    )
                  ) : (
                    // Creator/admin without a personal part — read-only overall roll-up, plus
                    // the owner's "Mark task incomplete" action (kept inside the Status card).
                    <>
                      {task.status && (
                        <span
                          className="inline-flex items-center rounded-[999px] px-3 py-1 text-sm font-medium"
                          style={{ backgroundColor: task.status.color + '22', color: task.status.color, border: `1px solid ${task.status.color}44` }}
                        >
                          {task.status.label}
                        </span>
                      )}
                      <p className="mt-2 text-[12px] text-[#475569]">
                        <HoverList
                          heading="Completed"
                          className="font-semibold text-[#0F172A]"
                          trigger={<>{completedCount} of {totalAssignees}</>}
                          items={completedCount > 0
                            ? assignees.filter((a) => a.is_completed).map((a) => a.user?.name ?? a.user_name ?? 'Unknown')
                            : ['No parts completed yet']}
                        /> parts done
                        {blockedCount > 0 && (
                          <> · <span className="text-[#DC2626]">{blockedCount} incomplete</span></>
                        )}
                        {pendingCount > 0 && (
                          <> · <HoverList
                            heading="Pending"
                            className="text-[#64748B]"
                            trigger={<>{pendingCount} pending</>}
                            items={assignees.filter((a) => !a.is_completed && !a.cannot_complete).map((a) => a.user?.name ?? a.user_name ?? 'Unknown')}
                          /></>
                        )}
                      </p>
                      {blockedCount > 0 && canEdit && (
                        <p className="mt-1 text-[11px] text-[#DC2626]">A part was closed incomplete — reassign it, or close the whole task incomplete.</p>
                      )}
                      <p className="mt-1 text-[11px] text-[#64748B]">Set each person&apos;s status in Assignees below.</p>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => { setIncompleteReason(''); setIncompleteTarget('task') }}
                          className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#DC2626] hover:text-[#B91C1C] transition-colors"
                        >
                          <XCircle size={13} />
                          Mark task incomplete
                        </button>
                      )}
                    </>
                  )}

                  {/* Why the task is stalled — one quiet, shared note (everyone sees it here,
                      so no one has to hunt in Assignees or hover). Subordinate to the status
                      pill: a left accent, not a filled alert box. Read-only — the person's
                      choice to close their part is final. */}
                  {blockedCount > 0 && (
                    <div className="mt-3 border-l-2 border-[#FECACA] pl-2.5 space-y-1.5">
                      {assignees.filter((a) => a.cannot_complete && !a.is_completed).map((a) => (
                        <p key={a.id} className="text-[11px] leading-snug">
                          <span className="font-semibold text-[#DC2626]">{a.user?.name ?? a.user_name ?? 'Unknown'}</span>
                          <span className="text-[#B91C1C]"> marked it incomplete</span>
                          {a.cannot_complete_reason && (
                            <span className="block italic text-[#B91C1C] whitespace-pre-wrap">“{a.cannot_complete_reason}”</span>
                          )}
                        </p>
                      ))}
                    </div>
                  )}
                  </>
                ) : (
                  // Shared status (any_can_complete) — anyone on the task can move it; the
                  // "Incomplete" close sits at the bottom of the same dropdown.
                  <>
                    {canMoveSharedStatus ? (
                      <StyledSelect
                        value={selectedStatusId}
                        onChange={(v) => {
                          if (v === MARK_TASK) { setIncompleteReason(''); setIncompleteTarget('task') }
                          else handleSharedStatusChange(v)
                        }}
                        options={[
                          ...openStatuses.map((s) => ({ value: s.id, label: s.label, color: s.color })),
                          { value: MARK_TASK, label: 'Incomplete', variant: 'danger' as const, divider: true, action: true },
                        ]}
                      />
                    ) : (
                      task.status && (
                        <span
                          className="inline-flex items-center rounded-[999px] px-3 py-1 text-sm font-medium"
                          style={{ backgroundColor: task.status.color + '22', color: task.status.color, border: `1px solid ${task.status.color}44` }}
                        >
                          {task.status.label}
                        </span>
                      )
                    )}
                    {task.status_actor && (
                      <p className="mt-2 text-[11px] text-[#64748B]">
                        Changed by <span className="font-semibold text-[#334155]">{task.status_actor.name}</span>
                        {task.status && (
                          <> to <span className="font-semibold text-[#334155]">{task.status.label}</span></>
                        )}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Details */}
            <div className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 bg-[#F5F3FF] border-b border-[#DDD6FE]">
                <span className="w-2 h-2 rounded-full bg-[#7C3AED]" />
                <p className="text-[11px] font-bold text-[#7C3AED] uppercase tracking-widest">Details</p>
              </div>
              <div className="p-4 space-y-4">
                {/* Status lives in its own card above — not repeated here. */}
                {category && (
                  <div className="flex flex-wrap gap-2">
                    <span
                      className="inline-flex items-center rounded-[8px] px-3 py-1.5 text-sm font-medium"
                      style={{ backgroundColor: category.color + '22', color: category.color, border: `1px solid ${category.color}44` }}
                    >
                      {category.name}
                    </span>
                  </div>
                )}

                {priority && (
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-7 h-7 rounded-[6px] flex items-center justify-center shrink-0"
                      style={{ backgroundColor: priority.color + '22' }}
                    >
                      <Flag size={13} style={{ color: priority.color }} />
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wide">Priority</p>
                      <p className="text-sm font-medium" style={{ color: priority.color }}>{priority.label}</p>
                    </div>
                  </div>
                )}

                {task.deadline && (
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-[6px] bg-[#FEF9C3] flex items-center justify-center shrink-0">
                      <Calendar size={13} className="text-[#D97706]" />
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wide">Deadline</p>
                      <p className={`text-sm ${deadlineColor(task.deadline)}`}>{formatDate(task.deadline)}</p>
                      {/* A revised deadline says so, with the date compliance actually
                          grades against — the live date can move, the baseline can't. */}
                      {(task.deadline_revision_count ?? 0) > 0 && task.original_deadline && (
                        <p className="text-[11px] text-[#475569]">
                          Revised {task.deadline_revision_count}
                          {task.deadline_revision_count === 1 ? ' time' : ' times'} · graded against{' '}
                          {formatDate(task.original_deadline)}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-[6px] bg-[#F1F5F9] flex items-center justify-center shrink-0">
                    <Clock size={13} className="text-[#475569]" />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wide">Created</p>
                    <p className="text-sm text-[#475569]">{formatDate(task.created_at)}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Attachments — every file on the task: creation-time uploads + files
                shared in comments. Only the uploader may remove their own file. */}
            <div className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-[#F0F9FF] border-b border-[#BAE6FD]">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#0EA5E9]" />
                  <p className="text-[11px] font-bold text-[#0EA5E9] uppercase tracking-widest">Attachments</p>
                  {allAttachments.length > 0 && (
                    <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-[#2563EB] text-white text-[10px] font-semibold">
                      {allAttachments.length}
                    </span>
                  )}
                </div>
                {/* Only the assigner / admin may add files here — solid blue + button. */}
                {canEdit && (
                  <Tooltip label="Add attachment">
                    <button
                      type="button"
                      onClick={() => attachInputRef.current?.click()}
                      disabled={uploadingAttachment}
                      aria-label="Add attachment"
                      className="flex items-center gap-1 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-[6px] pl-1.5 pr-2 py-1 disabled:opacity-60 transition-colors"
                    >
                      <Plus size={14} />
                      Add
                    </button>
                  </Tooltip>
                )}
              </div>
              <div className="p-4">
                {allAttachments.length === 0 ? (
                  <p className="text-sm text-[#64748B]">No attachments</p>
                ) : (
                  <div className="space-y-3 max-h-[280px] overflow-y-auto pr-1">
                    {allAttachments.map((a) => (
                      <div key={a.id} className="flex items-start gap-2.5">
                        {/* Download */}
                        <Tooltip label="Download">
                          <button
                            type="button"
                            onClick={() => tasksApi.downloadAttachment(orgId, taskId, a.id)}
                            aria-label="Download"
                            className="w-7 h-7 rounded-[6px] bg-[#EFF6FF] flex items-center justify-center shrink-0 hover:bg-[#DBEAFE] transition-colors"
                          >
                            <Download size={13} className="text-[#2563EB]" />
                          </button>
                        </Tooltip>
                        <div className="min-w-0 flex-1">
                          <Tooltip label={a.file_name}>
                            <button
                              type="button"
                              onClick={() => tasksApi.downloadAttachment(orgId, taskId, a.id)}
                              className="block max-w-full text-left text-sm font-medium text-[#0F172A] hover:text-[#2563EB] truncate transition-colors"
                            >
                              {a.file_name}
                            </button>
                          </Tooltip>
                          {/* Who shared it + where + when */}
                          <p className="text-[11px] text-[#64748B] truncate">
                            {a.uploaded_by_name ?? 'Unknown'}
                            {a.comment_id ? ' · in a comment' : ''} · {formatDate(a.created_at)}
                          </p>
                        </div>
                        {/* Remove — uploader only */}
                        {a.uploaded_by_user_id === user?.id && !isFutureTask && (
                          <Tooltip label="Remove">
                            <button
                              type="button"
                              onClick={() => setAttachmentToDelete(a)}
                              aria-label="Remove"
                              className="text-[#64748B] hover:text-[#DC2626] shrink-0 transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          </Tooltip>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {uploadingAttachment && (
                  <p className="text-xs text-[#64748B] mt-3">Uploading…</p>
                )}
                {attachmentError && (
                  <p className="mt-3 text-xs text-[#DC2626] bg-[#FEE2E2] border border-[#FECACA] rounded-[8px] px-3 py-2">
                    {attachmentError}
                  </p>
                )}
              </div>
              <input
                ref={attachInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? [])
                  if (files.length) handleUploadTaskAttachment(files)
                  e.target.value = '' // allow re-selecting the same file
                }}
              />
            </div>

            {/* Assignees */}
            <div className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-[#F0FDF4] border-b border-[#BBF7D0]">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#16A34A]" />
                  <p className="text-[11px] font-bold text-[#16A34A] uppercase tracking-widest">Assignees</p>
                </div>
                {/* The creator / admin may change who the work is assigned to; anyone
                    on the task may manage CC (see canManageCc). */}
                {canManageCc && (!editingAssignees ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEditAssigneesList((task.assignees ?? []).map((a) => ({
                        user_id: a.user_id,
                        name: a.user?.name ?? a.user_name ?? 'Unknown',
                        is_cc: a.is_cc,
                      })))
                      setAssigneeError(null)
                      setEditingAssignees(true)
                    }}
                    className="text-xs font-semibold text-[#16A34A] hover:text-[#15803D] transition-colors"
                  >
                    Edit
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSaveAssignees}
                      disabled={savingAssignees}
                      className="text-xs font-semibold text-white bg-[#16A34A] px-2.5 py-1 rounded-[6px] hover:bg-[#15803D] disabled:opacity-60 transition-colors"
                    >
                      {savingAssignees ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setEditingAssignees(false); setAssigneeError(null) }}
                      className="text-xs font-medium text-[#475569] hover:text-[#0F172A]"
                    >
                      Cancel
                    </button>
                  </div>
                ))}
              </div>
              <div className="p-4">
                {editingAssignees ? (
                  <div className="space-y-2">
                    {canEditRoster ? (
                      <>
                        <AssigneeSelector
                          orgId={orgId}
                          value={editAssigneesList}
                          onChange={(v) => { setEditAssigneesList(v); if (assigneeError) setAssigneeError(null) }}
                          currentUser={user ? { user_id: user.id, name: user.name } : undefined}
                        />
                        <p className="text-[11px] text-[#475569]">
                          Click someone&apos;s badge to switch them between Assignee and CC — they keep their progress.
                        </p>
                      </>
                    ) : (
                      /* CC-only: this person may loop others in but not reassign the
                         work, so the working assignees stay read-only. They're kept in
                         the list that gets saved, so nothing is dropped. */
                      <>
                        <div className="flex flex-wrap gap-1.5">
                          {editAssigneesList.filter((a) => !a.is_cc).map((a) => (
                            <span
                              key={a.user_id}
                              className="inline-flex items-center rounded-full border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 py-1 text-[13px] text-[#1E293B]"
                            >
                              {a.name}
                            </span>
                          ))}
                        </div>
                        <AssigneeSelector
                          orgId={orgId}
                          value={editAssigneesList.filter((a) => a.is_cc)}
                          onChange={(v) => {
                            setEditAssigneesList([
                              ...editAssigneesList.filter((a) => !a.is_cc),
                              ...v.map((x) => ({ ...x, is_cc: true })),
                            ])
                            if (assigneeError) setAssigneeError(null)
                          }}
                          currentUser={user ? { user_id: user.id, name: user.name } : undefined}
                        />
                        <p className="text-[11px] text-[#475569]">
                          You can CC people in. Changing who the task is assigned to is up to{' '}
                          {task.created_by?.name ?? 'whoever assigned it'}.
                        </p>
                      </>
                    )}
                    {assigneeError && (
                      <p className="text-xs text-[#DC2626] bg-[#FEE2E2] border border-[#FECACA] rounded-[6px] px-2.5 py-2">
                        {assigneeError}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {assignees.map((a) => {
                      const name = a.user?.name ?? a.user_name ?? 'Unknown'
                      const email = a.user?.email ?? a.user_email ?? ''
                      const overdue = !!a.is_overdue
                      // Creator/admin can drive any person's track — but only in per-person mode,
                      // and not once the person has closed their part as incomplete (final).
                      const editable = !!canEdit && isAllMustComplete && !a.is_completed && !a.cannot_complete
                      const trackColor = a.status?.color ?? '#64748B'
                      const trackLabel = a.status?.label ?? 'Not Started'
                      return (
                        <div key={a.id} className="space-y-2">
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-full ${avatarColor(name)} flex items-center justify-center text-white text-[10px] font-bold shrink-0`}>
                              {getInitials(name)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-[#0F172A] truncate">{name}</p>
                              <p className="text-xs text-[#475569] truncate">{email}</p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {overdue && (
                                <span className="text-[10px] font-bold uppercase tracking-wide bg-[#FEE2E2] text-[#DC2626] border border-[#FECACA] rounded px-1.5 py-0.5">
                                  Overdue
                                </span>
                              )}
                              {/* Only the narrow, glanceable chips sit beside the name so it
                                  keeps full width. The editable select + Done drop to their
                                  own row below. */}
                              {isAllMustComplete && (
                                a.is_completed ? (
                                  // Chip + a Reopen link stacked beneath it (right-aligned) so the
                                  // cluster stays narrow and never clips the name.
                                  <div className="flex flex-col items-end gap-1">
                                    <span className="flex items-center gap-1 text-[11px] font-semibold text-[#16A34A] bg-[#F0FDF4] border border-[#BBF7D0] rounded-full px-2 py-0.5">
                                      <CheckCircle2 size={12} /> Completed
                                    </span>
                                    {canEdit && reopenPartTarget !== a.user_id && (
                                      <Tooltip label={`Reopen ${name}'s part for rework`}>
                                        <button
                                          onClick={() => { setReopenPartReason(''); setReopenPartTarget(a.user_id) }}
                                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2563EB] hover:text-[#1D4ED8] transition-colors"
                                        >
                                          <RotateCcw size={11} /> Reopen
                                        </button>
                                      </Tooltip>
                                    )}
                                  </div>
                                ) : a.cannot_complete ? (
                                  // Person closed their part as incomplete. Chip + a Challenge link
                                  // stacked beneath (assigner disputes it and sends the work back).
                                  <div className="flex flex-col items-end gap-1">
                                    <span className="flex items-center gap-1 text-[11px] font-semibold text-[#DC2626] bg-[#FEE2E2] border border-[#FECACA] rounded-full px-2 py-0.5">
                                      <XCircle size={12} /> Incomplete
                                    </span>
                                    {canEdit && reopenPartTarget !== a.user_id && (
                                      <Tooltip label={`Reopen ${name}'s part`}>
                                        <button
                                          onClick={() => { setReopenPartReason(''); setReopenPartTarget(a.user_id) }}
                                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2563EB] hover:text-[#1D4ED8] transition-colors"
                                        >
                                          <RotateCcw size={11} /> Reopen
                                        </button>
                                      </Tooltip>
                                    )}
                                  </div>
                                ) : !editable ? (
                                  <span
                                    className="text-[11px] font-semibold rounded-full px-2 py-0.5"
                                    style={{ backgroundColor: trackColor + '1A', color: trackColor, border: `1px solid ${trackColor}40` }}
                                  >
                                    {trackLabel}
                                  </span>
                                ) : null
                              )}
                            </div>
                          </div>

                          {/* Inline controls for the creator/admin to move or finish this person's part. */}
                          {editable && (
                            <div className="flex items-center gap-2">
                              <StyledSelect
                                size="sm"
                                value={a.status_id ?? notStartedId}
                                onChange={(v) => handleAssigneeRowStatus(a.user_id, v)}
                                options={openStatuses.map((s) => ({ value: s.id, label: s.label, color: s.color }))}
                                wrapperClassName="flex-1 min-w-0"
                              />
                              <Tooltip label={`Mark ${name}'s part complete`}>
                                <button
                                  onClick={() => handleCompleteAssignee(a.user_id)}
                                  disabled={actionLoading === `complete-${a.user_id}`}
                                  className="shrink-0 flex items-center gap-1 text-[11px] font-semibold text-[#16A34A] bg-[#F0FDF4] border border-[#BBF7D0] rounded-full px-2.5 py-1 hover:bg-[#DCFCE7] disabled:opacity-60 transition-colors"
                                >
                                  <CheckCircle2 size={12} /> Done
                                </button>
                              </Tooltip>
                            </div>
                          )}

                          {/* Reopen / challenge reason box — optional feedback for the person. */}
                          {reopenPartTarget === a.user_id && (
                            <div className="rounded-[10px] border border-[#BFDBFE] bg-[#EFF6FF] p-2.5">
                              <p className="text-[11px] font-semibold text-[#1D4ED8] mb-1.5">Reopen {name}&apos;s part — add a note (optional)</p>
                              <textarea
                                value={reopenPartReason}
                                onChange={(e) => setReopenPartReason(e.target.value.slice(0, 500))}
                                rows={2}
                                autoFocus
                                placeholder="What would you like them to do?"
                                className="w-full rounded-[8px] border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-[13px] text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:outline-none resize-none"
                              />
                              <div className="mt-2 flex items-center gap-2">
                                <button
                                  onClick={() => handleReopenAssigneePart(a.user_id)}
                                  disabled={actionLoading === `reopen-part-${a.user_id}`}
                                  className="inline-flex items-center gap-1 text-[12px] font-semibold text-white bg-[#2563EB] rounded-[8px] px-3 py-1.5 hover:bg-[#1D4ED8] disabled:opacity-60 transition-colors"
                                >
                                  <RotateCcw size={12} /> {actionLoading === `reopen-part-${a.user_id}` ? 'Reopening…' : 'Reopen part'}
                                </button>
                                <button
                                  onClick={() => setReopenPartTarget(null)}
                                  className="text-[12px] font-medium text-[#475569] hover:text-[#0F172A] transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                    {ccUsers.length > 0 && (
                      <>
                        <p className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wide pt-1">CC</p>
                        {ccUsers.map((a) => {
                          const name = a.user?.name ?? a.user_name ?? 'Unknown'
                          const email = a.user?.email ?? a.user_email ?? ''
                          return (
                            <div key={a.id} className="flex items-center gap-3">
                              <div className={`w-8 h-8 rounded-full ${avatarColor(name)} flex items-center justify-center text-white text-[10px] font-bold shrink-0`}>
                                {getInitials(name)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-[#0F172A] truncate">{name}</p>
                                {email && <p className="text-xs text-[#475569] truncate">{email}</p>}
                              </div>
                              <span className="text-[10px] font-semibold bg-[#FEF9C3] text-[#D97706] border border-[#FDE68A] rounded px-1.5 py-0.5">CC</span>
                            </div>
                          )
                        })}
                      </>
                    )}
                    {/* People taken off the task. Removal is soft on purpose: the
                        record that someone held this task has to survive, or a person
                        who was already late could be quietly removed into a clean
                        scorecard. They're excluded from every count and gate above. */}
                    {(task.removed_assignees?.length ?? 0) > 0 && (
                      <>
                        <p className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wide pt-1">
                          Previously on this task
                        </p>
                        {task.removed_assignees!.map((a) => {
                          const name = a.user?.name ?? a.user_name ?? 'Unknown'
                          return (
                            <div key={a.id} className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-[#E2E8F0] flex items-center justify-center text-[#475569] text-[10px] font-bold shrink-0">
                                {getInitials(name)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-[#475569] truncate">{name}</p>
                                <p className="text-xs text-[#475569] truncate">
                                  {a.is_cc ? 'CC · ' : ''}
                                  {a.removed_at ? `Removed ${formatDate(a.removed_at)}` : 'Removed'}
                                  {a.removed_by?.name ? ` by ${a.removed_by.name}` : ''}
                                </p>
                              </div>
                              {a.is_completed && (
                                <span className="text-[10px] font-semibold bg-[#DCFCE7] text-[#16A34A] border border-[#BBF7D0] rounded px-1.5 py-0.5">
                                  Had finished
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </>
                    )}
                    {assignees.length === 0 && ccUsers.length === 0 && (
                      <p className="text-sm text-[#475569]">No assignees yet.</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Completion Mode */}
            <div className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-[#FFFBEB] border-b border-[#FDE68A]">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#D97706]" />
                  <p className="text-[11px] font-bold text-[#D97706] uppercase tracking-widest">Completion Mode</p>
                </div>
                {/* Editable only when it matters — 2+ assignees — and the viewer can edit. */}
                {canEdit && assignees.length > 1 && (!editingCompletionMode ? (
                  <button
                    type="button"
                    onClick={() => {
                      setCompletionModeDraft(task.completion_mode === 'all_must_complete' ? 'all_must_complete' : 'any_can_complete')
                      setEditingCompletionMode(true)
                    }}
                    className="text-xs font-semibold text-[#D97706] hover:text-[#B45309] transition-colors"
                  >
                    Edit
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSaveCompletionMode}
                      disabled={savingCompletionMode}
                      className="text-xs font-semibold text-white bg-[#D97706] px-2.5 py-1 rounded-[6px] hover:bg-[#B45309] disabled:opacity-60 transition-colors"
                    >
                      {savingCompletionMode ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingCompletionMode(false)}
                      className="text-xs font-medium text-[#475569] hover:text-[#0F172A]"
                    >
                      Cancel
                    </button>
                  </div>
                ))}
              </div>
              <div className="p-4">
                {editingCompletionMode ? (
                  <div className="space-y-2">
                    {([
                      { value: 'any_can_complete', label: 'Any assignee can complete' },
                      { value: 'all_must_complete', label: 'All assignees must complete' },
                    ] as const).map((opt) => {
                      const active = completionModeDraft === opt.value
                      return (
                        <label
                          key={opt.value}
                          className={[
                            'flex items-center gap-2.5 rounded-[8px] border px-3 py-2.5 cursor-pointer transition-colors',
                            active ? 'border-[#2563EB] bg-[#EFF6FF]' : 'border-[#E2E8F0] bg-white hover:border-[#CBD5E1]',
                          ].join(' ')}
                        >
                          <input
                            type="radio"
                            name="completion_mode"
                            value={opt.value}
                            checked={active}
                            onChange={() => setCompletionModeDraft(opt.value)}
                            className="accent-[#2563EB]"
                          />
                          <span className={`text-sm font-medium ${active ? 'text-[#2563EB]' : 'text-[#0F172A]'}`}>{opt.label}</span>
                        </label>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-sm font-medium text-[#0F172A]">
                    {task.completion_mode === 'all_must_complete'
                      ? 'All assignees must complete'
                      : 'Any assignee can complete'}
                  </p>
                )}
              </div>
            </div>

            {task.proof_required && (() => {
              const ps = task.proof_summary
              const required = ps?.required_user_ids?.length ?? 0
              const submitted = ps?.submitted_user_ids?.length ?? 0
              const done = isAllMustComplete ? (required > 0 && submitted >= required) : !!ps?.task_has_any_proof
              const label = isAllMustComplete
                ? (done ? 'All submitted' : `${submitted}/${required} submitted`)
                : (done ? 'Submitted' : 'Pending submission')
              return (
                <div className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] overflow-hidden">
                  <div className={`flex items-center gap-2 px-4 py-2.5 border-b ${done ? 'bg-[#F0FDF4] border-[#BBF7D0]' : 'bg-[#FEF2F2] border-[#FECACA]'}`}>
                    <span className={`w-2 h-2 rounded-full ${done ? 'bg-[#16A34A]' : 'bg-[#DC2626]'}`} />
                    <p className={`text-[11px] font-bold uppercase tracking-widest ${done ? 'text-[#16A34A]' : 'text-[#DC2626]'}`}>
                      Proof Required
                    </p>
                  </div>
                  <div className="p-4">
                    <p className={`text-sm font-medium ${done ? 'text-[#16A34A]' : 'text-[#D97706]'}`}>{label}</p>
                  </div>
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {/* Attachment delete confirmation */}
      {attachmentToDelete && createPortal(
        <div
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget && !deletingAttachment) setAttachmentToDelete(null) }}
          role="dialog"
          aria-modal="true"
        >
          <div className="relative w-full max-w-sm bg-white rounded-t-[16px] sm:rounded-[12px] shadow-[0_8px_32px_rgba(0,0,0,0.16)] border border-[#E2E8F0] p-6">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-[#FEE2E2] flex items-center justify-center shrink-0">
                <Trash2 size={18} className="text-[#DC2626]" />
              </div>
              <div className="min-w-0">
                <h3 className="text-[16px] font-semibold text-[#0F172A]">Delete this attachment?</h3>
                <p className="text-sm text-[#475569] mt-1">
                  <span className="font-medium text-[#0F172A] break-all">{attachmentToDelete.file_name}</span> will be permanently removed. This can’t be undone.
                </p>
              </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setAttachmentToDelete(null)}
                disabled={deletingAttachment}
                className="w-full sm:w-auto px-4 py-[9px] text-sm font-semibold text-[#475569] bg-white border border-[#CBD5E1] rounded-[8px] hover:bg-[#F8FAFC] disabled:opacity-60 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleRemoveAttachment(attachmentToDelete)}
                disabled={deletingAttachment}
                className="w-full sm:w-auto px-4 py-[9px] text-sm font-semibold text-white bg-[#DC2626] rounded-[8px] hover:bg-[#B91C1C] disabled:opacity-60 transition-colors"
              >
                {deletingAttachment ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Activity Log — popup opened from the top-right history icon. Portaled to
          <body> (like the delete dialogs) so no overflow/containing-block ancestor
          on the task page can clip it or cut it off from the top. */}
      {showActivity && createPortal(
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setShowActivity(false) }}
          role="dialog"
          aria-modal="true"
        >
          <div className="relative w-full max-w-lg bg-white rounded-t-[16px] sm:rounded-[12px] shadow-[0_8px_32px_rgba(0,0,0,0.16)] border border-[#E2E8F0] max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-[#E2E8F0] shrink-0">
              <h3 className="text-[16px] font-semibold text-[#0F172A] flex items-center gap-2">
                <History size={16} className="text-[#2563EB]" />
                Activity Log
              </h3>
              <button
                onClick={() => setShowActivity(false)}
                aria-label="Close"
                className="w-8 h-8 rounded-[6px] flex items-center justify-center text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-4">
              {activityLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <User size={24} className="text-[#64748B] mb-3" />
                  <p className="text-sm text-[#475569]">No activity recorded yet.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {activityLogs.map((log) => (
                    <ActivityItem key={log.id} log={log} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
