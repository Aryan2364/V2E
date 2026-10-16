'use client'

import React, { useRef, useState } from 'react'
import { UploadCloud, AlertTriangle, X } from 'lucide-react'
import { ACCEPT_ATTR, validateFile } from '@/lib/attachments'

/**
 * Presentational drag-and-drop + click-to-pick zone. It validates each dropped/picked
 * file and hands the caller the valid ones plus any rejection messages — it never
 * uploads. Styled per DESIGN_RULES (soft fill, blue focus/active).
 */
export default function FileDropzone({
  onFiles,
  onReject,
  disabled = false,
  compact = false,
}: {
  onFiles: (files: File[]) => void
  /** When provided, rejection messages are handed to the parent instead of
   *  being shown inside the dropzone — lets the caller place the error box in
   *  its own scroll region (render <AttachmentErrorBox/> where you want it). */
  onReject?: (messages: string[]) => void
  disabled?: boolean
  compact?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  function handle(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    const valid: File[] = []
    const errs: string[] = []
    for (const f of Array.from(fileList)) {
      const err = validateFile(f)
      if (err) errs.push(err)
      else valid.push(f)
    }
    if (onReject) onReject(errs)
    else setErrors(errs)
    if (valid.length) onFiles(valid)
  }

  return (
    <div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (!disabled) handle(e.dataTransfer.files)
        }}
        className={[
          'w-full flex items-center justify-center gap-2 rounded-[10px] border border-dashed transition-colors',
          compact ? 'px-3 py-2.5' : 'px-4 py-5',
          dragging ? 'border-[#2563EB] bg-[#EFF6FF]' : 'border-[#CBD5E1] bg-[#F8FAFC] hover:border-[#94A3B8]',
          disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
        ].join(' ')}
      >
        <UploadCloud size={compact ? 15 : 18} className="text-[#2563EB] shrink-0" />
        <span className={`${compact ? 'text-xs' : 'text-sm'} text-[#475569]`}>
          <span className="font-medium text-[#2563EB]">Click to upload</span>
          {!compact && ' or drag & drop'}
        </span>
      </button>
      {!compact && (
        <p className="text-[11px] text-[#475569] mt-1">PDF, Office, images, video/audio, zip · up to 25 MB each</p>
      )}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        className="hidden"
        onChange={(e) => { handle(e.target.files); e.target.value = '' }}
      />
      {!onReject && errors.length > 0 && (
        <div className="mt-2">
          <AttachmentErrorBox errors={errors} onDismiss={() => setErrors([])} />
        </div>
      )}
    </div>
  )
}

/**
 * The rejected-files box. Exported so callers using `onReject` can render it
 * inside their own scroll region (e.g. together with the pending-file list) so
 * it scrolls with the content instead of staying pinned above it.
 */
export function AttachmentErrorBox({ errors, onDismiss }: { errors: string[]; onDismiss: () => void }) {
  if (errors.length === 0) return null
  return (
    <div className="rounded-[10px] border border-[#FECACA] bg-[#FEF2F2] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-[#FEE2E2] border-b border-[#FECACA]">
        <AlertTriangle size={15} className="text-[#DC2626] shrink-0" />
        <p className="flex-1 text-[12px] font-semibold text-[#991B1B]">
          {errors.length} file{errors.length !== 1 ? 's' : ''} couldn’t be added
        </p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 w-6 h-6 rounded-[6px] flex items-center justify-center text-[#B91C1C] hover:bg-[#FECACA] transition-colors"
        >
          <X size={13} />
        </button>
      </div>
      <ul className="px-3 py-2 space-y-1">
        {errors.map((er, i) => (
          <li key={i} className="flex items-start gap-1.5 text-[12px] text-[#B91C1C]">
            <span className="mt-[6px] w-1 h-1 rounded-full bg-[#DC2626] shrink-0" />
            <span className="min-w-0 wrap-break-word">{er}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
