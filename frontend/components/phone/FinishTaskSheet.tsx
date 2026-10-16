'use client'

import React from 'react'
import { Camera, FileUp, Paperclip, RotateCcw, X } from 'lucide-react'
import { tasksApi } from '@/lib/api/tasks'
import { useToast } from '@/components/ui/Toast'
import type { Task } from '@/lib/types/tasks'
import { shrinkImageForUpload } from '@/lib/image-resize'
import { unfinishedChecklistItems, hasSubmittedProof, finishBlockedReason } from '@/lib/tasks/finish-rules'
import { PhoneSheet } from './PhoneSheet'
import { PhoneButton, cx } from './primitives'

/*
 * The Finish task sheet - plan-phone-2026-10-14.md §5.1,
 * KIT-PENDING-phone-task-tick.md item 3. Opens from a row's circle when the
 * task needs more before it can close: an unfinished checklist and/or proof.
 *
 *   - Lists only what's still needed (not the whole checklist).
 *   - Checklist items tick inline here, optimistically, via the SAME
 *     existing endpoint the desktop checklist card uses.
 *   - "Attach proof": Take photo / Choose file, constrained to
 *     proof_allowed_extensions, client-side shrunk to 1600px long side,
 *     per-file progress, Retry on failure. Uses the existing :id/proof
 *     endpoint.
 *   - Footer: one full-width "Complete task", disabled with a plain-language
 *     reason until everything clears. Tapping it hands off to the caller
 *     (`onComplete`), which runs the SAME optimistic Undo-toast flow as a
 *     direct row tap (item 4) - this sheet never completes the task itself.
 */

type UploadState = {
  id: string
  file: File
  progress: number
  status: 'uploading' | 'done' | 'error'
  error?: string
}

export function FinishTaskSheet({
  open,
  onOpenChange,
  orgId,
  userId,
  task,
  onTaskUpdate,
  onComplete,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: string
  userId: string | undefined
  task: Task
  /** Called after a checklist/proof mutation succeeds, so the row list stays in sync. */
  onTaskUpdate: (updated: Task) => void
  /** Called when "Complete task" is tapped and everything required is done. */
  onComplete: () => void
}) {
  const { addToast } = useToast()
  const [uploads, setUploads] = React.useState<UploadState[]>([])
  const [checking, setChecking] = React.useState<Set<string>>(new Set())
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const cameraInputRef = React.useRef<HTMLInputElement>(null)

  const unfinished = unfinishedChecklistItems(task)
  const proofNeeded = task.proof_required && !hasSubmittedProof(task, userId)
  const stillUploading = uploads.some((u) => u.status === 'uploading')
  const blockedReason = finishBlockedReason(task, userId)
  const disabledReason = stillUploading ? 'Finishing upload…' : blockedReason

  const accept =
    task.proof_allowed_extensions && task.proof_allowed_extensions.length > 0
      ? task.proof_allowed_extensions.map((ext) => `.${ext.replace(/^\./, '')}`).join(',')
      : undefined

  async function toggleChecklistItem(itemId: string) {
    if (checking.has(itemId)) return
    setChecking((prev) => new Set(prev).add(itemId))
    try {
      const updated = await tasksApi.checkChecklistItem(orgId, task.id, itemId)
      onTaskUpdate(updated)
    } catch {
      addToast('Could not update the checklist. Try again.', 'error')
    } finally {
      setChecking((prev) => {
        const next = new Set(prev)
        next.delete(itemId)
        return next
      })
    }
  }

  async function uploadOne(file: File) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    setUploads((prev) => [...prev, { id, file, progress: 0, status: 'uploading' }])
    try {
      const shrunk = await shrinkImageForUpload(file)
      await tasksApi.uploadProof(orgId, task.id, shrunk, 'private', (pct) =>
        setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, progress: pct } : u))),
      )
      setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, status: 'done', progress: 100 } : u)))
      const refreshed = await tasksApi.getTask(orgId, task.id)
      onTaskUpdate(refreshed)
    } catch {
      setUploads((prev) =>
        prev.map((u) => (u.id === id ? { ...u, status: 'error', error: 'Upload failed' } : u)),
      )
    }
  }

  function retry(uploadId: string) {
    const upload = uploads.find((u) => u.id === uploadId)
    if (!upload) return
    setUploads((prev) => prev.filter((u) => u.id !== uploadId))
    void uploadOne(upload.file)
  }

  function onFilesPicked(files: FileList | null) {
    if (!files) return
    Array.from(files).forEach((f) => void uploadOne(f))
  }

  return (
    <PhoneSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Finish task"
      footer={
        <PhoneButton
          type="button"
          variant="primary"
          fullWidth
          disabled={disabledReason !== null}
          title={disabledReason ?? undefined}
          onClick={onComplete}
        >
          {disabledReason ?? 'Complete task'}
        </PhoneButton>
      }
    >
      <div className="flex flex-col gap-[24px]">
        {unfinished.length > 0 ? (
          <section className="flex flex-col gap-[8px]">
            <h3 className="text-phone-label font-medium text-text-secondary">Checklist</h3>
            <ul className="mx-[-16px] divide-y divide-border-light border-y border-border-light bg-surface">
              {unfinished.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => void toggleChecklistItem(item.id)}
                    disabled={checking.has(item.id)}
                    className="flex min-h-[48px] w-full items-center gap-[12px] px-[16px] py-[10px] text-left active:bg-surface-control"
                  >
                    <span
                      aria-hidden
                      className="flex size-[22px] shrink-0 items-center justify-center rounded-full border-2 border-border-strong"
                    />
                    <span className="min-w-0 flex-1 truncate text-phone-body text-text-primary">
                      {item.title}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {task.proof_required ? (
          <section className="flex flex-col gap-[8px]">
            <h3 className="text-phone-label font-medium text-text-secondary">Attach proof</h3>

            <div className="flex gap-[8px]">
              <PhoneButton
                type="button"
                variant="secondary"
                fullWidth
                onClick={() => cameraInputRef.current?.click()}
              >
                <Camera aria-hidden className="size-[18px]" />
                Take photo
              </PhoneButton>
              <PhoneButton
                type="button"
                variant="secondary"
                fullWidth
                onClick={() => fileInputRef.current?.click()}
              >
                <FileUp aria-hidden className="size-[18px]" />
                Choose file
              </PhoneButton>
            </div>
            <input
              ref={cameraInputRef}
              type="file"
              accept={accept ?? 'image/*'}
              capture="environment"
              className="hidden"
              onChange={(e) => {
                onFilesPicked(e.target.files)
                e.target.value = ''
              }}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept={accept}
              multiple
              className="hidden"
              onChange={(e) => {
                onFilesPicked(e.target.files)
                e.target.value = ''
              }}
            />

            {uploads.length > 0 ? (
              <ul className="flex flex-col gap-[8px]">
                {uploads.map((u) => (
                  <li
                    key={u.id}
                    className="flex items-center gap-[8px] rounded-[8px] border border-border-light bg-surface px-[12px] py-[8px]"
                  >
                    <Paperclip aria-hidden className="size-[16px] shrink-0 text-text-secondary" />
                    <span className="min-w-0 flex-1 truncate text-phone-label text-text-primary">
                      {u.file.name}
                    </span>
                    {u.status === 'uploading' ? (
                      <span className="text-phone-meta text-text-secondary">{u.progress}%</span>
                    ) : u.status === 'error' ? (
                      <button
                        type="button"
                        onClick={() => retry(u.id)}
                        className={cx(
                          'inline-flex items-center gap-[4px] rounded-[6px] px-[8px] py-[4px]',
                          'text-phone-label font-semibold text-danger active:bg-danger-bg',
                        )}
                      >
                        <RotateCcw aria-hidden className="size-[14px]" />
                        Retry
                      </button>
                    ) : (
                      <span className="text-phone-label font-medium text-success">Done</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
            {proofNeeded && uploads.length === 0 ? (
              <p className="text-phone-meta text-text-secondary">
                {accept ? `Allowed types: ${accept}` : 'Any file type is allowed.'}
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
    </PhoneSheet>
  )
}
