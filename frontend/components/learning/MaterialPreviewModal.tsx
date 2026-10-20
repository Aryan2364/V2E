'use client'

import { useEffect, useState } from 'react'
import {
  Maximize2, Minimize2, Download, ExternalLink,
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
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@/components/ui/dialog'

const TYPE_ICONS: Record<ContentType, any> = {
  video: Play,
  file: FileIcon,
  document: FileText,
  url: Link2,
  article: BookOpen,
}

/**
 * Click-to-open preview dialog for a course material (kit Dialog), with a
 * maximize/restore toggle in its header band. File materials render inline via
 * MaterialViewer; article/video/url/document show their body or an
 * open-in-new-tab affordance. Closes on Esc, the backdrop or the close button.
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

  const TypeIcon = TYPE_ICONS[item.content_type] ?? BookOpen
  const canDownload = item.content_type === 'file' && !!fileView?.allow_download
  const watermark = [user?.name, user?.email, new Date().toISOString().slice(0, 10)]
    .filter(Boolean)
    .join(' · ')

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent
        size="lg"
        className={
          maximized
            ? 'h-dvh max-h-dvh w-screen max-w-none rounded-none data-[size=lg]:max-w-none'
            : 'h-[94dvh] max-h-[94dvh] data-[size=lg]:max-w-5xl'
        }
      >
        <DialogHeader>
          <div className="min-w-0 flex items-center gap-2.5 pr-10">
            <TypeIcon size={18} className="shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <DialogTitle className="truncate">{item.title}</DialogTitle>
                <ItemTypeBadge type={item.content_type} />
              </div>
              {item.file_name && <p className="truncate text-meta opacity-90">{item.file_name}</p>}
            </div>
          </div>
          <Tooltip label={maximized ? 'Restore' : 'Maximize'}>
            <Button
              variant="on-brand"
              size="icon"
              className="absolute top-3 right-14"
              onClick={() => setMaximized((m) => !m)}
              aria-label={maximized ? 'Restore' : 'Maximize'}
            >
              {maximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </Button>
          </Tooltip>
        </DialogHeader>

        <DialogBody className="bg-surface-sunken sm:p-6">
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
              <Button
                variant="primary"
                render={<a href={item.content_url} target="_blank" rel="noopener noreferrer" />}
              >
                <ExternalLink size={15} />
                Open {item.content_type === 'document' ? 'document' : 'link'}
              </Button>
            </div>
          )}

          {/* Nothing to show */}
          {item.content_type !== 'file'
            && !item.content_body
            && !item.content_url && (
            <p className="text-label text-text-muted text-center py-12">No content available for this material.</p>
          )}
        </DialogBody>

        {canDownload && (
          <DialogFooter>
            <Button variant="primary" onClick={() => downloadAdminItem(orgId, pathId, item.id)}>
              <Download size={14} /> Download
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
