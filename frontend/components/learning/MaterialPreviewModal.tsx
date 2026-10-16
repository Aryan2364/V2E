'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X, Maximize2, Minimize2, Download, ExternalLink,
  Play, FileText, Link2, BookOpen, File as FileIcon, Loader2,
} from 'lucide-react'
import {
  getAdminItemViewUrl, getAdminItemFile, downloadAdminItem,
} from '@/lib/api/learning'
import { useAuth } from '@/lib/auth/context'
import type { LearningItem, ContentType, MaterialViewData } from '@/lib/types/learning'
import MaterialViewer from './MaterialViewer'
import ItemTypeBadge from './ItemTypeBadge'
import { toEmbeddableVideoUrl } from '@/lib/learning/video-embed'
import Tooltip from '@/components/ui/tooltip'

const TYPE_ICONS: Record<ContentType, any> = {
  video: Play,
  file: FileIcon,
  document: FileText,
  url: Link2,
  article: BookOpen,
}

/**
 * Click-to-open preview popup for a course material. Opens as a centered window
 * (Windows-style) with a maximize/restore toggle and a close X. File materials
 * render inline via MaterialViewer; article/video/url/document show their body
 * or an open-in-new-tab affordance. Portals to <body> and closes on Esc.
 */
export default function MaterialPreviewModal({
  orgId,
  pathId,
  item,
  onClose,
}: {
  orgId: string
  pathId: string
  item: LearningItem
  onClose: () => void
}) {
  const { user } = useAuth()
  const [maximized, setMaximized] = useState(false)
  const [fileView, setFileView] = useState<MaterialViewData | null>(null)
  const [fileLoading, setFileLoading] = useState(item.content_type === 'file')

  // File materials: fetch a signed inline-preview URL (creator/admin — no view tracking).
  useEffect(() => {
    if (item.content_type !== 'file') return
    let cancelled = false
    setFileLoading(true)
    getAdminItemViewUrl(orgId, pathId, item.id)
      .then((v) => { if (!cancelled) setFileView(v) })
      .finally(() => { if (!cancelled) setFileLoading(false) })
    return () => { cancelled = true }
  }, [orgId, pathId, item.id, item.content_type])

  // Esc closes the popup.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (typeof document === 'undefined') return null

  const TypeIcon = TYPE_ICONS[item.content_type] ?? BookOpen
  const canDownload = item.content_type === 'file' && !!fileView?.allow_download
  const watermark = [user?.name, user?.email, new Date().toISOString().slice(0, 10)]
    .filter(Boolean)
    .join(' · ')

  return createPortal(
    <div
      className="fixed inset-0 z-60 flex bg-black/50"
      style={maximized ? undefined : { padding: '3vh 4vw' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className={[
          'bg-surface flex flex-col overflow-hidden shadow-2xl mx-auto w-full',
          maximized ? 'rounded-none max-w-none' : 'rounded-card max-w-5xl',
        ].join(' ')}
      >
        {/* Title bar */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border-light shrink-0 bg-surface">
          <div className="min-w-0 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-control bg-surface-control flex items-center justify-center shrink-0">
              <TypeIcon size={15} className="text-primary-text" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-label font-medium text-text-primary truncate">{item.title}</h3>
                <ItemTypeBadge type={item.content_type} />
              </div>
              {item.file_name && (
                <p className="text-meta text-text-muted truncate">{item.file_name}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {canDownload && (
              <button
                onClick={() => downloadAdminItem(orgId, pathId, item.id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 mr-1 text-label font-medium text-primary-foreground bg-primary hover:bg-primary-hover rounded-control transition-colors"
              >
                <Download size={14} /> Download
              </button>
            )}
            <Tooltip label={maximized ? 'Restore' : 'Maximize'}>
              <button
                onClick={() => setMaximized((m) => !m)}
                aria-label={maximized ? 'Restore' : 'Maximize'}
                className="p-2 text-text-secondary hover:text-primary-text hover:bg-primary-subtle rounded-control transition-colors"
              >
                {maximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
            </Tooltip>
            <Tooltip label="Close (Esc)">
              <button
                onClick={onClose}
                aria-label="Close (Esc)"
                className="p-2 text-text-secondary hover:text-danger hover:bg-danger-bg rounded-control transition-colors"
              >
                <X size={16} />
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-surface-sunken">
          {item.description && (
            <p className="text-label text-text-secondary mb-4">{item.description}</p>
          )}

          {/* File materials — inline document/media viewer */}
          {item.content_type === 'file' && (
            fileLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-label text-text-secondary">
                <Loader2 size={18} className="animate-spin text-primary-text" /> Loading material…
              </div>
            ) : fileView ? (
              <MaterialViewer
                key={`${item.id}-${maximized ? 'fs' : 'win'}`}
                data={fileView}
                viewOnly={!fileView.allow_download}
                watermark={watermark}
                pdfLoader={() => getAdminItemFile(orgId, pathId, item.id)}
                fullscreen={maximized}
              />
            ) : (
              <p className="text-label text-text-muted text-center py-12">Couldn’t load this material.</p>
            )
          )}

          {/* Article — inline text body */}
          {item.content_type === 'article' && (
            <div className="bg-surface border border-border-light rounded-card p-4">
              <div className="prose prose-sm max-w-none text-text-primary whitespace-pre-wrap">
                {item.content_body ?? 'No content available.'}
              </div>
            </div>
          )}

          {/* Video — embedded player */}
          {item.content_type === 'video' && item.content_url && (
            <div className="w-full aspect-video rounded-card overflow-hidden bg-black">
              <iframe
                src={toEmbeddableVideoUrl(item.content_url)}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                title={item.title}
              />
            </div>
          )}

          {/* URL / document — open externally */}
          {['url', 'document'].includes(item.content_type) && item.content_url && (
            <div className="bg-surface border border-border-light rounded-card p-8 flex flex-col items-center text-center gap-4">
              <div className="w-12 h-12 rounded-card bg-primary-subtle flex items-center justify-center">
                <TypeIcon size={22} className="text-primary-text" />
              </div>
              <p className="text-label text-text-secondary break-all max-w-lg">{item.content_url}</p>
              <a
                href={item.content_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 text-label font-medium text-primary-foreground bg-primary hover:bg-primary-hover rounded-control transition-colors"
              >
                <ExternalLink size={15} />
                Open {item.content_type === 'document' ? 'Document' : 'Link'}
              </a>
            </div>
          )}

          {/* Nothing to show */}
          {item.content_type !== 'file'
            && !item.content_body
            && !item.content_url && (
            <p className="text-label text-text-muted text-center py-12">No content available for this material.</p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
