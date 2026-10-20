'use client'

import React from 'react'
import { FileText, Film, Image as ImageIcon, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatBytes } from '@/lib/attachments'
import { cx } from './primitives'

/*
 * One file, one row - kit section 29, on the phone. Used wherever a person
 * picks files with the phone's own picker (a hidden <input type="file">):
 * the task's Files section and the Finish task sheet.
 *
 * A picked file is a StagedFile: it keeps its identity (`id`) from the moment
 * it is picked until it is gone, so a row is updated in place and never
 * deleted and recreated. Its row shows a thumbnail (image or video) or a
 * file-type icon, the name (truncated), the size, its own progress, a Retry
 * when the upload failed, and a remove button.
 */

export type StagedFile = {
  id: string
  file: File
  /** staged = picked, not sent yet. */
  status: 'staged' | 'uploading' | 'failed'
  progress: number
}

export function newStagedFile(file: File): StagedFile {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    file,
    status: 'staged',
    progress: 0,
  }
}

/** True for a file the phone can show a thumbnail of. */
function previewKind(name: string, mime: string | undefined): 'image' | 'video' | null {
  const type = (mime ?? '').toLowerCase()
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif'].includes(ext)) return 'image'
  if (['mp4', 'webm', 'mov'].includes(ext)) return 'video'
  return null
}

const THUMB = 'flex size-[40px] shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-surface-control text-text-secondary'

/** The file-type icon used when there is nothing to preview. */
export function FileGlyph({ name, mime }: { name: string; mime?: string }) {
  const kind = previewKind(name, mime)
  return (
    <span aria-hidden className={THUMB}>
      {kind === 'image' ? (
        <ImageIcon className="size-[18px]" />
      ) : kind === 'video' ? (
        <Film className="size-[18px]" />
      ) : (
        <FileText className="size-[18px]" />
      )}
    </span>
  )
}

/** A local preview of a picked file; the object URL is revoked on unmount. */
function StagedThumb({ file }: { file: File }) {
  const kind = previewKind(file.name, file.type)
  const [url, setUrl] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!kind) return
    const made = URL.createObjectURL(file)
    setUrl(made)
    return () => URL.revokeObjectURL(made)
  }, [file, kind])

  if (!kind || !url) return <FileGlyph name={file.name} mime={file.type} />
  return (
    <span aria-hidden className={THUMB}>
      {kind === 'image' ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="size-full object-cover" />
      ) : (
        <video src={url} muted playsInline preload="metadata" className="size-full object-cover" />
      )}
    </span>
  )
}

export const FILE_ROW =
  'flex min-h-[56px] items-center gap-[12px] rounded-[8px] border border-border-light bg-surface py-[8px] pl-[12px] pr-[4px]'

/** The remove (x) button of a row: a quiet kit icon button with a 44px tap area. */
export function RemoveFileButton({ name, onClick, disabled }: { name: string; onClick: () => void; disabled?: boolean }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={`Remove ${name}`}
      disabled={disabled}
      onClick={onClick}
      className="size-[44px] shrink-0"
    >
      <X aria-hidden className="size-[18px]" />
    </Button>
  )
}

export function StagedFileRow({
  item,
  onRemove,
  onRetry,
}: {
  item: StagedFile
  onRemove: (id: string) => void
  onRetry: (id: string) => void
}) {
  const failed = item.status === 'failed'
  const uploading = item.status === 'uploading'
  return (
    <li className={cx(FILE_ROW, failed && 'border-danger')}>
      <StagedThumb file={item.file} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body text-text-primary">{item.file.name}</span>
        {uploading ? (
          <span className="flex items-center gap-[8px]">
            <span className="h-[4px] min-w-0 flex-1 overflow-hidden rounded-full bg-surface-control">
              <span className="block h-full rounded-full bg-primary" style={{ width: `${item.progress}%` }} />
            </span>
            <span className="shrink-0 text-meta text-text-secondary">{item.progress}%</span>
          </span>
        ) : failed ? (
          <span className="truncate text-meta text-danger">Upload failed</span>
        ) : (
          <span className="truncate text-meta text-text-secondary">{formatBytes(item.file.size)}</span>
        )}
      </span>
      {failed ? (
        <Button type="button" variant="secondary" size="sm" onClick={() => onRetry(item.id)}>
          <RotateCcw aria-hidden className="size-4" />
          Retry
        </Button>
      ) : null}
      <RemoveFileButton name={item.file.name} onClick={() => onRemove(item.id)} disabled={uploading} />
    </li>
  )
}
