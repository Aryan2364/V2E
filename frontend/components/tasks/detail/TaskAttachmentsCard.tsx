'use client'

import { useState, useRef } from 'react'
import { tasksApi } from '@/lib/api/tasks'
import { Button } from '@/components/ui/button'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Trash2, Plus, Download } from 'lucide-react'
import { formatDateTime as formatDate } from '@/lib/format'
import Tooltip from '@/components/ui/tooltip'
import type { TaskAttachment } from '@/lib/types/tasks'
import type { TaskDetailCtx } from './types'

export function TaskAttachmentsCard({ ctx }: { ctx: TaskDetailCtx }) {
  const { d, orgId, taskId, user, flags } = ctx
  const { canEdit, isFutureTask } = flags
  const attachInputRef = useRef<HTMLInputElement>(null)
  // Attachment pending deletion - drives the confirm dialog.
  const [attachmentToDelete, setAttachmentToDelete] = useState<TaskAttachment | null>(null)

  async function removeAttachment(a: TaskAttachment) {
    await d.removeAttachment(a)
    setAttachmentToDelete(null)
  }

  return (
    <>
        <div className="bg-surface border border-border-light rounded-card shadow-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 bg-primary-subtle border-b border-border-light">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-text-secondary" />
              <p className="text-meta font-medium text-text-secondary uppercase tracking-widest">Attachments</p>
              {d.allAttachments.length > 0 && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-primary text-primary-foreground text-meta font-medium">
                  {d.allAttachments.length}
                </span>
              )}
            </div>
            {/* Only the assigner / admin may add files here — solid blue + button. */}
            {canEdit && (
              <Tooltip label="Add attachment">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => attachInputRef.current?.click()}
                  disabled={d.uploadingAttachment}
                  aria-label="Add attachment"
                >
                  <Plus size={14} />
                  Add
                </Button>
              </Tooltip>
            )}
          </div>
          <div className="p-4">
            {d.allAttachments.length === 0 ? (
              <p className="text-body text-text-muted">No attachments</p>
            ) : (
              <div className="space-y-3 max-h-[280px] overflow-y-auto pr-1">
                {d.allAttachments.map((a) => (
                  <div key={a.id} className="flex items-start gap-2.5">
                    {/* Download */}
                    <Tooltip label="Download">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => tasksApi.downloadAttachment(orgId, taskId, a.id)}
                        aria-label="Download"
                        className="shrink-0 bg-primary-subtle text-primary-text hover:bg-primary-subtle"
                      >
                        <Download size={13} />
                      </Button>
                    </Tooltip>
                    <div className="min-w-0 flex-1">
                      <Tooltip label={a.file_name}>
                        <button
                          type="button"
                          onClick={() => tasksApi.downloadAttachment(orgId, taskId, a.id)}
                          className="block max-w-full text-left text-body font-medium text-text-primary hover:text-primary-text truncate outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring transition-colors"
                        >
                          {a.file_name}
                        </button>
                      </Tooltip>
                      {/* Who shared it + where + when */}
                      <p className="text-meta text-text-muted truncate">
                        {a.uploaded_by_name ?? 'Unknown'}
                        {a.comment_id ? ' · in a comment' : ''} · {formatDate(a.created_at)}
                      </p>
                    </div>
                    {/* Remove — uploader only */}
                    {a.uploaded_by_user_id === user?.id && !isFutureTask && (
                      <Tooltip label="Remove">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setAttachmentToDelete(a)}
                          aria-label="Remove"
                          className="shrink-0"
                        >
                          <Trash2 size={14} />
                        </Button>
                      </Tooltip>
                    )}
                  </div>
                ))}
              </div>
            )}
            {d.uploadingAttachment && (
              <p className="text-meta text-text-muted mt-3">Uploading…</p>
            )}
            {d.attachmentError && (
              <p className="mt-3 text-meta text-danger bg-danger-bg border border-danger-border rounded-control px-3 py-2">
                {d.attachmentError}
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
              if (files.length) d.uploadTaskFiles(files)
              e.target.value = '' // allow re-selecting the same file
            }}
          />
        </div>

  <AlertDialog open={!!attachmentToDelete} onOpenChange={(open) => { if (!open && !d.deletingAttachment) setAttachmentToDelete(null) }}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete this attachment?</AlertDialogTitle>
        <AlertDialogDescription>
          <span className="font-medium text-text-primary break-all">{attachmentToDelete?.file_name}</span> will be permanently removed. This can&apos;t be undone.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={d.deletingAttachment}>Cancel</AlertDialogCancel>
        <AlertDialogAction
          onClick={() => attachmentToDelete && removeAttachment(attachmentToDelete)}
          disabled={d.deletingAttachment}
        >
          {d.deletingAttachment ? 'Deleting…' : 'Delete'}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
    </>
  )
}
