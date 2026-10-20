'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  FileText, Link2, Video, BookOpen, Trash2, Eye, RefreshCw,
  Loader2, X, Download, Ban, GripVertical,
} from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import {
  updateItem, deleteItem, uploadItemFile, getAdminItemViewUrl, getAdminItemFile,
} from '@/lib/api/learning'
import { ACCEPT_ATTR, validateFile, formatBytes, fileKindLabel, extensionOf } from '@/lib/attachments'
import type { ContentType, LearningItem, MaterialViewData } from '@/lib/types/learning'
import MaterialViewer from './MaterialViewer'
import Tooltip from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'

const TYPE_META: Record<ContentType, { icon: any; label: string }> = {
  file: { icon: FileText, label: 'File' },
  url: { icon: Link2, label: 'Link' },
  video: { icon: Video, label: 'Video' },
  document: { icon: FileText, label: 'Document' },
  article: { icon: BookOpen, label: 'Article' },
}

/** File types that render in-app (native + client-rendered). Only these may be view-only. */
const PREVIEWABLE_EXT = new Set([
  'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'webm', 'mov', 'mp3',
  'docx', 'xlsx', 'xls', 'csv', 'txt',
])

/** A "convert to X so it can show in-app" nudge for the types we can't preview. */
function conversionHint(ext: string): string | null {
  if (ext === 'pptx' || ext === 'ppt') return 'PowerPoint can’t show inside the app — export it to PDF and upload that so learners can view it here.'
  if (ext === 'doc') return 'Old Word format can’t show inside the app — save it as .docx and upload that so learners can view it here.'
  return null
}

export default function MaterialRow({
  orgId, pathId, index, item, onChange, onRemove, onGripPointerDown,
}: {
  orgId: string
  pathId: string
  index: number
  item: LearningItem
  onChange: (item: LearningItem) => void
  onRemove: (id: string) => void
  /** Provided by the builder to start a drag-reorder; renders a grip handle when set. */
  onGripPointerDown?: (e: React.PointerEvent) => void
}) {
  const { user } = useAuth()
  const [title, setTitle] = useState(item.title)
  const [url, setUrl] = useState(item.content_url ?? '')
  const [body, setBody] = useState(item.content_body ?? '')
  const [saving, setSaving] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [preview, setPreview] = useState<MaterialViewData | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  // Re-seed local fields when the row changes identity OR is converted to another type.
  useEffect(() => { setTitle(item.title); setUrl(item.content_url ?? ''); setBody(item.content_body ?? '') },
    [item.id, item.content_type]) // eslint-disable-line react-hooks/exhaustive-deps

  const fileExt = extensionOf(item.file_name ?? '')
  const canPreview = PREVIEWABLE_EXT.has(fileExt)
  const convertHint = conversionHint(fileExt)

  // Guardrail: a file we can't preview must be downloadable — never let it be a
  // view-only material with no way to see or save it (a trapped learner). Auto-repair
  // any such material to download-allowed.
  useEffect(() => {
    if (item.content_type === 'file' && item.file_name && !canPreview && item.allow_download === false) {
      save({ allow_download: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, canPreview, item.allow_download, item.file_name])

  const Meta = TYPE_META[item.content_type] ?? TYPE_META.file
  const Icon = Meta.icon

  async function save(patch: Partial<LearningItem>) {
    setSaving(true)
    try {
      const updated = await updateItem(orgId, pathId, item.id, patch)
      onChange(updated)
    } finally {
      setSaving(false)
    }
  }

  async function handleReplace(file: File | undefined) {
    if (!file) return
    if (validateFile(file)) return
    setReplacing(true)
    try {
      const updated = await uploadItemFile(orgId, pathId, item.id, file, item.allow_download ?? true)
      onChange(updated)
    } finally {
      setReplacing(false)
    }
  }

  async function handleDelete() {
    await deleteItem(orgId, pathId, item.id)
    onRemove(item.id)
  }

  async function openPreview() {
    setPreviewLoading(true)
    try {
      const data = await getAdminItemViewUrl(orgId, pathId, item.id)
      setPreview(data)
    } finally {
      setPreviewLoading(false)
    }
  }

  const watermark = [user?.name, user?.email].filter(Boolean).join(' · ')

  return (
    <div className="rounded-card border border-border-light bg-surface">
      <div className="flex items-start gap-3 p-3.5">
        {onGripPointerDown && (
          <Tooltip label="Drag to reorder">
            <button
              type="button"
              onPointerDown={onGripPointerDown}
              aria-label="Drag to reorder"
              className="rounded-xs outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring shrink-0 mt-1.5 p-0.5 -ml-1 text-muted hover:text-text-muted cursor-grab active:cursor-grabbing touch-none"
            >
              <GripVertical size={16} />
            </button>
          </Tooltip>
        )}
        <span className="text-meta text-text-muted w-5 text-center shrink-0 mt-2">{index + 1}</span>
        <div className="w-8 h-8 rounded-control bg-primary-subtle flex items-center justify-center shrink-0 mt-0.5">
          <Icon size={15} className="text-primary-text" />
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title !== item.title && save({ title: title.trim() })}
            placeholder="Material title"
            className="w-full px-2.5 py-1.5 border border-border rounded-control text-label font-medium text-text-primary bg-surface focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
          />

          {/* Type-specific editor */}
          {(item.content_type === 'url' || item.content_type === 'video' || item.content_type === 'document') && (
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={() => {
                const t = url.trim()
                // Prepend https:// when the protocol is missing (backend requires http(s)).
                const normalized = t && !/^https?:\/\//i.test(t) ? `https://${t}` : t
                if (normalized !== (item.content_url ?? '')) {
                  if (normalized !== url) setUrl(normalized)
                  save({ content_url: normalized })
                }
              }}
              placeholder="https://… (paste a link, video, or doc)"
              className="w-full px-2.5 py-1.5 border border-border rounded-control text-label text-text-primary bg-surface focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
            />
          )}
          {item.content_type === 'url' && (
            <p className="text-meta text-text-muted">
              Shown inside the app if the page allows it, otherwise learners get an open button — decided automatically.
            </p>
          )}
          {item.content_type === 'article' && (
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onBlur={() => body !== (item.content_body ?? '') && save({ content_body: body })}
              rows={3}
              placeholder="Write the article content…"
              className="w-full px-2.5 py-1.5 border border-border rounded-control text-label text-text-primary bg-surface focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary resize-y"
            />
          )}

          {item.content_type === 'file' && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-meta text-text-secondary">
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-xs bg-surface-control font-medium text-text-secondary text-meta">
                  {fileKindLabel(item.file_name ?? '')}
                </span>
                <span className="truncate max-w-[220px]">{item.file_name ?? 'No file'}</span>
                {item.file_size_bytes ? <span className="text-text-muted">· {formatBytes(item.file_size_bytes)}</span> : null}
                {item.file_name && (canPreview
                  ? <span className="text-success">· plays in-app</span>
                  : <span className="text-warning">· download to open</span>)}
              </div>

              {/* Previewable → the creator chooses download vs view-only.
                  Not previewable → forced download-only (can't trap learners), with a convert nudge. */}
              {canPreview ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => save({ allow_download: !(item.allow_download ?? true) })}
                    aria-pressed={item.allow_download ?? true}
                    className={[
                      'outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-meta font-medium transition-colors',
                      item.allow_download ?? true
                        ? 'bg-success-bg text-success border border-success-border'
                        : 'bg-warning-bg text-warning border border-warning-border',
                    ].join(' ')}
                  >
                    {item.allow_download ?? true ? <Download size={12} /> : <Ban size={12} />}
                    {item.allow_download ?? true ? 'Download allowed' : 'View-only'}
                  </button>
                  <span className="text-meta text-text-muted">Tap to switch</span>
                </div>
              ) : item.file_name ? (
                <div className="flex flex-col gap-1">
                  <span className="inline-flex w-fit items-center gap-1.5 px-2.5 py-1 rounded-full text-meta font-medium bg-success-bg text-success border border-success-border">
                    <Download size={12} /> Download only
                  </span>
                  {convertHint && <span className="text-meta text-warning">{convertHint}</span>}
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {saving && <Loader2 size={13} className="animate-spin text-text-muted" />}
          {item.content_type === 'file' && item.file_name && (
            <>
              <Tooltip label="Preview">
                <Button variant="ghost" size="icon" onClick={openPreview} disabled={previewLoading} aria-label="Preview">
                  {previewLoading ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                </Button>
              </Tooltip>
              <Tooltip label="Replace file">
                <label
                  aria-label="Replace file"
                  className="p-1.5 text-text-muted hover:text-primary-text hover:bg-primary-subtle rounded-control transition-colors cursor-pointer"
                >
                  {replacing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  <input type="file" accept={ACCEPT_ATTR} className="hidden"
                    onChange={(e) => { handleReplace(e.target.files?.[0]); e.target.value = '' }} />
                </label>
              </Tooltip>
            </>
          )}
          <Tooltip label="Remove">
            <Button variant="ghost" size="icon" onClick={handleDelete} aria-label="Remove">
              <Trash2 size={14} />
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* Preview modal */}
      <Dialog open={!!preview} onOpenChange={(next) => { if (!next) setPreview(null) }}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{item.title}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="text-meta text-text-muted mb-3">Preview — exactly what learners see</p>
            {preview && (
              <MaterialViewer
                data={preview}
                viewOnly={!preview.allow_download}
                watermark={watermark}
                pdfLoader={() => getAdminItemFile(orgId, pathId, item.id)}
              />
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  )
}
