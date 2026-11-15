'use client'

import { useState, useRef } from 'react'
import { tasksApi } from '@/lib/api/tasks'
import { Button } from '@/components/ui/button'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { CommentBox } from '@/components/ui/comment-box'
import { CommentThread } from '@/components/ui/comment-thread'
import { formatBytes } from '@/lib/attachments'
import { AttachmentChips } from '@/components/ui/AttachmentList'
import { REASONS, gate, useWorkflowsWritable } from '@/components/workflows/shared'
import { Trash2, ShieldCheck, Paperclip, FileText, X } from 'lucide-react'
import Tooltip from '@/components/ui/tooltip'
import InstanceDiscussion from '@/components/workflows/InstanceDiscussion'
import type { ThreadItem } from '@/components/ui/comment-thread'
import type { TaskComment } from '@/lib/types/tasks'
import type { WorkflowStepContext } from '@/lib/types/workflows'
import type { TaskDetailCtx } from './types'

/** A comment's files and, when the task asks for proof, the controls to use one of them as proof. */
function TaskCommentAttachments({
  comment,
  orgId,
  taskId,
  currentUserId,
  canSubmitProof = false,
  proofAllowedExtensions = [],
  onMarkProof,
  markingProofId,
}: {
  comment: TaskComment
  orgId: string
  taskId: string
  currentUserId: string
  /** Current user may promote their own comment files to proof (proof required, they're a non-CC assignee, task open). */
  canSubmitProof?: boolean
  proofAllowedExtensions?: string[]
  onMarkProof?: (attachmentId: string) => void
  markingProofId?: string | null
}) {
  return (
    <>
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
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => onMarkProof(a.id)}
              disabled={markingProofId === a.id}
            >
              <ShieldCheck size={12} /> Mark “{a.file_name}” as proof
            </Button>
          </Tooltip>
        )
      })}
      {canSubmitProof && (comment.attachments ?? []).some((a) => a.is_proof) && (
        <p className="text-meta text-success inline-flex items-center gap-1"><ShieldCheck size={12} /> Marked as proof</p>
      )}
    </>
  )
}

/** Delete control for the current user's own comment, with our own confirmation dialog (no browser confirm). */
function TaskCommentDelete({ onDelete }: { onDelete: () => Promise<void> }) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function confirmDelete() {
    setDeleting(true)
    try {
      await onDelete()
    } finally {
      setDeleting(false)
      setConfirmOpen(false)
    }
  }

  return (
    <>
      <Tooltip label="Delete comment">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Delete comment"
          onClick={() => setConfirmOpen(true)}
          className="shrink-0 text-text-muted hover:text-danger"
        >
          <Trash2 size={13} />
        </Button>
      </Tooltip>
      <AlertDialog open={confirmOpen} onOpenChange={(open) => { if (!open && !deleting) setConfirmOpen(false) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this comment?</AlertDialogTitle>
            <AlertDialogDescription>This can&apos;t be undone. The comment will be removed for everyone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** Comments - a workflow step task shows its instance's ONE discussion (every step + the instance page) when the viewer can see the instance; otherwise the task's own. */
export function TaskComments({ ctx, stepCtx }: { ctx: TaskDetailCtx; stepCtx: WorkflowStepContext | null | undefined }) {
  const { d, task, orgId, taskId, user, flags } = ctx
  const { isFutureTask, isAssignee, isTaskTerminal } = flags
  const { comments, actionLoading } = d
  const workflowsWritable = useWorkflowsWritable()
  // Everyone who can see the instance may write in its discussion (not on a simulated-future task).
  const discussionGate = isFutureTask
    ? { allowed: false as boolean | undefined, reason: 'Comments are locked on tasks created in a simulated future.' }
    : gate(true, workflowsWritable, REASONS.message)
  const [commentText, setCommentText] = useState('')
  const [commentFiles, setCommentFiles] = useState<File[]>([])
  const [sendingComment, setSendingComment] = useState(false)
  const [commentError, setCommentError] = useState<string | null>(null)
  const commentFileInputRef = useRef<HTMLInputElement>(null)
  const commentTextareaRef = useRef<HTMLTextAreaElement>(null)

  async function handleSendComment() {
    // A comment may be text-only, file-only, or both - but never entirely empty.
    if (!commentText.trim() && commentFiles.length === 0) return
    setSendingComment(true)
    setCommentError(null)
    try {
      const result = await d.sendComment(commentText, commentFiles)
      if (result.clearText) setCommentText('')
      if (result.clearFiles) setCommentFiles([])
      setCommentError(result.error)
    } finally {
      setSendingComment(false)
    }
  }

  // Promote a file the current user shared in a comment to be their proof of completion.
  async function handleMarkCommentAsProof(attachmentId: string) {
    try {
      await d.markCommentFileAsProof(attachmentId)
    } catch {
      // ignore
    }
  }

  return (
    task.workflow_instance_step_id && stepCtx === undefined ? (
              <div className="bg-surface border border-border-light rounded-card shadow-card p-6 flex flex-col gap-3" aria-busy>
                <div className="h-5 w-32 rounded-xs bg-surface-control animate-pulse" />
                <div className="h-14 rounded-xs bg-surface-control animate-pulse" />
              </div>
            ) : task.workflow_instance_step_id && stepCtx?.can_view_discussion ? (
              <InstanceDiscussion
                orgId={orgId}
                templateId={stepCtx.template_id}
                instanceId={stepCtx.instance_id}
                taskId={taskId}
                title="Comments"
                sectionId="task-discussion"
                compact
                canWrite={discussionGate.allowed}
                writeReason={discussionGate.reason}
                proof={{
                  canSubmit: !!task.proof_required && isAssignee && !isTaskTerminal,
                  allowedExtensions: task.proof_allowed_extensions ?? [],
                  onMark: (attachmentId) => d.markDiscussionFileAsProof(attachmentId),
                }}
                onChanged={async () => {
                  // A message's files show in the Attachments card (and a removed one takes its files).
                  await d.refreshAllAttachments()
                  if (task.proof_required) d.bumpProof()
                }}
              />
            ) : (
              <div className="bg-surface border border-border-light rounded-card shadow-card p-6">
                <h3 className="flex items-center gap-2 text-body font-medium text-text-primary mb-4">
                  Comments
                  {comments.length > 0 && (
                    <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-meta font-medium">
                      {comments.length}
                    </span>
                  )}
                </h3>
                <CommentThread
                  ownScroll={false}
                  followLatest={false}
                  className="mb-4"
                  onWrite={() => commentTextareaRef.current?.focus()}
                  items={comments.map((c): ThreadItem => ({
                    id: c.id,
                    who: c.user_name ?? 'Someone',
                    when: c.created_at,
                    text: c.body,
                    attachments: (
                      <TaskCommentAttachments
                        comment={c}
                        orgId={orgId}
                        taskId={taskId}
                        currentUserId={user?.id ?? ''}
                        canSubmitProof={!!task.proof_required && isAssignee && !isTaskTerminal}
                        proofAllowedExtensions={task.proof_allowed_extensions ?? []}
                        onMarkProof={handleMarkCommentAsProof}
                        markingProofId={actionLoading?.startsWith('mark-proof-') ? actionLoading.replace('mark-proof-', '') : null}
                      />
                    ),
                    trailing:
                      c.user_id === user?.id ? (
                        <TaskCommentDelete
                          onDelete={async () => {
                            await d.removeComment(c.id)
                            // A deleted comment takes its files with it - refresh what listed them (and a proof, if one went).
                            void d.syncAfterCommentRemoved()
                          }}
                        />
                      ) : undefined,
                  }))}
                />
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
                <CommentBox
                  value={commentText}
                  onChange={(text) => setCommentText(text.slice(0, 1000))}
                  maxLength={1000}
                  textareaRef={commentTextareaRef}
                  onSend={handleSendComment}
                  disabled={sendingComment || isFutureTask}
                  hasContent={commentFiles.length > 0}
                  error={commentError}
                  placeholder={isFutureTask ? 'Comments are locked on future tasks...' : 'Add a comment...'}
                  attachments={commentFiles.map((f, i) => (
                    <span
                      key={`${f.name}-${i}`}
                      className="inline-flex items-center gap-1.5 max-w-[220px] bg-primary-subtle border border-primary-border text-primary-text text-meta font-medium pl-2 pr-1 py-1 rounded-control"
                    >
                      <FileText size={12} className="shrink-0" />
                      <span className="truncate">{f.name}</span>
                      <span className="text-text-muted shrink-0">{formatBytes(f.size)}</span>
                      {/* 16px chip dismiss - smaller than the kit's icon-sm (32px); no kit token fits this size. */}
                      <Tooltip label="Remove file">
                        <button
                          type="button"
                          onClick={() => setCommentFiles((prev) => prev.filter((_, idx) => idx !== i))}
                          disabled={sendingComment}
                          className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-primary-text hover:bg-primary-subtle hover:text-primary-text disabled:opacity-50 outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring transition-colors"
                          aria-label={`Remove ${f.name}`}
                        >
                          <X size={11} />
                        </button>
                      </Tooltip>
                    </span>
                  ))}
                  tools={
                    <Tooltip label="Attach files">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => commentFileInputRef.current?.click()}
                        disabled={sendingComment || isFutureTask}
                        aria-label="Attach files"
                      >
                        <Paperclip size={16} className="-rotate-45" />
                      </Button>
                    </Tooltip>
                  }
                />
              </div>
                )
  )
}

