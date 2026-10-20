'use client'

import React from 'react'
import { Paperclip } from 'lucide-react'
import { tasksApi } from '@/lib/api/tasks'
import { useToast } from '@/components/ui/Toast'
import type { Task } from '@/lib/types/tasks'
import { shrinkImageForUpload } from '@/lib/image-resize'
import { unfinishedChecklistItems, hasSubmittedProof, finishBlockedReason } from '@/lib/tasks/finish-rules'
import { acceptFromExtensions } from '@/lib/attachments'
import { useUnsavedChanges } from '@/components/ui/unsaved-changes'
import { PhoneSheet } from './PhoneSheet'
import { PhoneButton } from './primitives'
import { StagedFileRow, newStagedFile, type StagedFile } from './FileRows'

/*
 * The Finish task sheet - plan-phone-2026-10-14.md §5.1,
 * KIT-PENDING-phone-task-tick.md item 3. Opens from a row's circle when the
 * task needs more before it can close: an unfinished checklist and/or proof.
 *
 *   - Lists only what's still needed (not the whole checklist).
 *   - Checklist items tick inline here, optimistically, via the SAME
 *     existing endpoint the desktop checklist card uses.
 *   - "Attach proof": one button that opens the phone's own picker
 *     (Camera, Photos, Files), constrained to proof_allowed_extensions.
 *     Picked files are held here, one row each, and can be removed until
 *     "Complete task": that tap sends them through the existing :id/proof
 *     endpoint (shrunk to 1600px, per-file progress, Retry on failure) and
 *     then completes. Closing the sheet discards them (after a warning).
 *   - Footer: one full-width "Complete task", disabled with a plain-language
 *     reason until everything clears. Tapping it hands off to the caller
 *     (`onComplete`), which runs the SAME optimistic Undo-toast flow as a
 *     direct row tap (item 4) - this sheet never completes the task itself.
 */

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
  const [staged, setStaged] = React.useState<StagedFile[]>([])
  const [submitting, setSubmitting] = React.useState(false)
  const [checking, setChecking] = React.useState<Set<string>>(new Set())
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const unfinished = unfinishedChecklistItems(task)
  const proofNeeded = task.proof_required && !hasSubmittedProof(task, userId)
  // Picked proof counts as attached; it is sent when "Complete task" is tapped.
  const blockedReason = proofNeeded && staged.length > 0
    ? (unfinished.length > 0 ? 'Finish the checklist to complete' : null)
    : finishBlockedReason(task, userId)
  const disabledReason = blockedReason

  const accept = acceptFromExtensions(task.proof_allowed_extensions)

  const unsaved = useUnsavedChanges({ changed: staged.length > 0, noun: 'form', mode: 'create' })
  const guardedOpenChange = unsaved.guard(onOpenChange, () => setStaged([]))

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

  const patch = (id: string, change: Partial<StagedFile>) =>
    setStaged((prev) => prev.map((u) => (u.id === id ? { ...u, ...change } : u)))

  /** Sends one proof file; true when it landed. A failure marks only its own row. */
  async function sendOne(item: StagedFile): Promise<boolean> {
    patch(item.id, { status: 'uploading', progress: 0 })
    try {
      const shrunk = await shrinkImageForUpload(item.file)
      await tasksApi.uploadProof(orgId, task.id, shrunk, 'private', (pct) => patch(item.id, { progress: pct }))
      setStaged((prev) => prev.filter((u) => u.id !== item.id))
      return true
    } catch {
      patch(item.id, { status: 'failed' })
      return false
    }
  }

  /** Complete task: send every picked file, then hand off to the caller's completion. */
  async function submit() {
    if (submitting) return
    setSubmitting(true)
    let allSent = true
    for (const item of staged) {
      if (!(await sendOne(item))) allSent = false
    }
    if (allSent && staged.length > 0) {
      try {
        onTaskUpdate(await tasksApi.getTask(orgId, task.id))
      } catch {
        /* the completion below re-reads the task */
      }
    }
    setSubmitting(false)
    if (allSent) onComplete()
    else addToast('Some files did not upload. Retry or remove them, then complete the task.', 'error')
  }

  function retry(id: string) {
    const item = staged.find((u) => u.id === id)
    if (item) void sendOne(item)
  }

  function onFilesPicked(files: FileList | null) {
    const picked = files ? Array.from(files) : []
    if (picked.length > 0) setStaged((prev) => [...prev, ...picked.map(newStagedFile)])
  }

  return (
    <PhoneSheet
      open={open}
      onOpenChange={guardedOpenChange}
      title="Finish task"
      footer={
        <div className="flex w-full flex-col gap-[8px]">
          {disabledReason ? <p className="text-label text-text-secondary">{disabledReason}</p> : null}
          <PhoneButton
            type="button"
            variant="primary"
            fullWidth
            loading={submitting}
            disabled={disabledReason !== null}
            onClick={() => void submit()}
          >
            Complete task
          </PhoneButton>
        </div>
      }
    >
      <div className="flex flex-col gap-[24px]">
        {unfinished.length > 0 ? (
          <section className="flex flex-col gap-[8px]">
            <h3 className="text-label font-medium text-text-secondary">Checklist</h3>
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
                    <span className="min-w-0 flex-1 truncate text-body text-text-primary">
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
            <h3 className="text-label font-medium text-text-secondary">Proof</h3>

            <PhoneButton
              type="button"
              variant="secondary"
              fullWidth
              disabled={submitting}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip aria-hidden className="size-[18px]" />
              Attach proof
            </PhoneButton>
            {/* The phone's own picker (Camera, Photos, Files). No `capture`. */}
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

            {staged.length > 0 ? (
              <ul className="flex flex-col gap-[8px]">
                {staged.map((u) => (
                  <StagedFileRow
                    key={u.id}
                    item={u}
                    onRetry={retry}
                    onRemove={(id) => setStaged((prev) => prev.filter((x) => x.id !== id))}
                  />
                ))}
              </ul>
            ) : null}
            {proofNeeded && staged.length === 0 ? (
              <p className="text-meta text-text-secondary">
                {task.proof_allowed_extensions && task.proof_allowed_extensions.length > 0
                  ? `Allowed types: ${task.proof_allowed_extensions.join(', ')}`
                  : 'Any file type is allowed.'}
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
      {unsaved.warning}
    </PhoneSheet>
  )
}
