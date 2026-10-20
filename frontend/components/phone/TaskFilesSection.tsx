'use client'

import React from 'react'
import { createPortal } from 'react-dom'
import { Plus, X } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { useToast } from '@/components/ui/Toast'
import { tasksApi } from '@/lib/api/tasks'
import { ACCEPT_ATTR, formatBytes } from '@/lib/attachments'
import { shrinkImageForUpload } from '@/lib/image-resize'
import { detectPlatform, isInstalledApp } from '@/lib/install'
import type { Task, TaskAttachment } from '@/lib/types/tasks'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { FILE_ROW, FileGlyph, RemoveFileButton, StagedFileRow, newStagedFile, type StagedFile } from './FileRows'

/*
 * "Files & proof" on the task screen, in place - kit section 29 and the
 * phone's own picker (section 1 rule 5, section 41). "Add file" opens the
 * phone's picker straight away (Camera, Photos, Files - whatever the phone offers, in one
 * list); nothing opens a screen of its own.
 *
 * Each file is ONE row, always. A picked file shows its progress where it
 * will land; when the upload finishes the saved file takes its place in the
 * same update, so it is never shown twice. A failed upload stays with Retry
 * and can be removed. A saved file can be removed by the person who uploaded
 * it, after a confirmation (section 15), as on the computer.
 */

export function TaskFilesSection({
  orgId,
  task,
  onTaskUpdate,
}: {
  orgId: string
  task: Task
  onTaskUpdate: (t: Task) => void
}) {
  const { user } = useAuth()
  const { addToast } = useToast()
  const [items, setItems] = React.useState<TaskAttachment[] | null>(null)
  const [staged, setStaged] = React.useState<StagedFile[]>([])
  const [viewer, setViewer] = React.useState<TaskAttachment | null>(null)
  const [toRemove, setToRemove] = React.useState<TaskAttachment | null>(null)
  const [removing, setRemoving] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    let cancelled = false
    tasksApi
      .listAllAttachments(orgId, task.id)
      .then((list) => {
        if (!cancelled) setItems(list)
      })
      .catch(() => {
        if (!cancelled) {
          setItems([])
          addToast('Files could not be loaded.', 'error')
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, task.id])

  const refreshTask = () => {
    tasksApi.getTask(orgId, task.id).then(onTaskUpdate).catch(() => {})
  }

  const patch = (id: string, change: Partial<StagedFile>) =>
    setStaged((prev) => prev.map((s) => (s.id === id ? { ...s, ...change } : s)))

  /** One file: its own progress; a failure marks only that row. */
  async function uploadOne(item: StagedFile) {
    patch(item.id, { status: 'uploading', progress: 0 })
    try {
      const shrunk = await shrinkImageForUpload(item.file)
      const saved = await tasksApi.uploadTaskAttachment(orgId, task.id, shrunk, (pct) => patch(item.id, { progress: pct }))
      // The saved file replaces the pending row in one batch: never both.
      setItems((prev) => (prev && prev.some((a) => a.id === saved.id) ? prev : [...(prev ?? []), saved]))
      setStaged((prev) => prev.filter((s) => s.id !== item.id))
      refreshTask()
    } catch {
      patch(item.id, { status: 'failed' })
    }
  }

  function onPicked(list: FileList | null) {
    const picked = list ? Array.from(list) : []
    if (picked.length === 0) return
    const added = picked.map(newStagedFile)
    setStaged((prev) => [...prev, ...added])
    // One at a time keeps the phone's connection for the file in hand.
    void (async () => {
      for (const item of added) await uploadOne(item)
    })()
  }

  function retry(id: string) {
    const item = staged.find((s) => s.id === id)
    if (item) void uploadOne(item)
  }

  function openFile(a: TaskAttachment) {
    if (a.mime_type?.startsWith('image/')) {
      setViewer(a)
      return
    }
    openNonImageFile(orgId, task.id, a).catch(() => addToast('This file could not be opened. Try again.', 'error'))
  }

  async function removeSaved(a: TaskAttachment) {
    setRemoving(true)
    try {
      await tasksApi.deleteAttachment(orgId, task.id, a.id)
      setItems((prev) => (prev ? prev.filter((x) => x.id !== a.id) : prev))
      refreshTask()
    } catch {
      addToast('The file could not be removed. Try again.', 'error')
    } finally {
      setRemoving(false)
      setToRemove(null)
    }
  }

  const empty = items !== null && items.length === 0 && staged.length === 0

  return (
    <section className="flex flex-col gap-[8px]">
      <div className="flex items-center justify-between">
        <h2 className="text-label font-medium text-text-secondary">Files &amp; proof</h2>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-flex min-h-[44px] items-center gap-[4px] text-label font-medium text-primary-text"
        >
          <Plus aria-hidden className="size-[16px]" />
          Add file
        </button>
      </div>
      {/* The phone's own picker: Camera, Photos & videos and Files in one list. No `capture`. */}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        className="hidden"
        onChange={(e) => {
          onPicked(e.target.files)
          e.target.value = ''
        }}
      />

      {items === null ? (
        <p className="text-body text-text-secondary">Loading…</p>
      ) : empty ? (
        <p className="text-body text-text-secondary">No files yet.</p>
      ) : (
        <ul className="flex flex-col gap-[8px]">
          {items.map((a) => {
            const mine = !!user?.id && a.uploaded_by_user_id === user.id
            return (
              <li key={a.id} className={FILE_ROW}>
                <button type="button" onClick={() => openFile(a)} className="flex min-w-0 flex-1 items-center gap-[12px] text-left">
                  <FileGlyph name={a.file_name} mime={a.mime_type} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-body text-text-primary">{a.file_name}</span>
                    <span className="truncate text-meta text-text-secondary">
                      {formatBytes(a.size_bytes)}
                      {a.is_proof ? ' · Proof' : ''}
                    </span>
                  </span>
                </button>
                {mine ? <RemoveFileButton name={a.file_name} onClick={() => setToRemove(a)} /> : <span className="w-[8px]" />}
              </li>
            )
          })}
          {staged.map((s) => (
            <StagedFileRow
              key={s.id}
              item={s}
              onRetry={retry}
              onRemove={(id) => setStaged((prev) => prev.filter((x) => x.id !== id))}
            />
          ))}
        </ul>
      )}

      <AlertDialog open={!!toRemove} onOpenChange={(next) => { if (!next && !removing) setToRemove(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this file?</AlertDialogTitle>
            <AlertDialogDescription>
              {toRemove ? `${toRemove.file_name} will be deleted from this task. This can’t be undone.` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="danger" disabled={removing} loading={removing} onClick={() => toRemove && void removeSaved(toRemove)}>
              Delete file
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {viewer ? <ImageViewer attachment={viewer} orgId={orgId} taskId={task.id} onClose={() => setViewer(null)} /> : null}
    </section>
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
    <div className="fixed inset-0 z-90 flex flex-col bg-black">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute right-[16px] top-[max(16px,var(--safe-top))] z-10 flex size-[44px] items-center justify-center rounded-full bg-black/40 text-white">
        <X aria-hidden />
      </button>
      <div className="flex flex-1 items-center justify-center overflow-auto touch-pinch-zoom">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={attachment.file_name} className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-body text-white">Loading…</span>
        )}
      </div>
    </div>,
    document.body,
  )
}
