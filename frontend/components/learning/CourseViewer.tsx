'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import {
  ArrowLeft, CheckCircle, Lock, Play, FileText, Link2, BookOpen,
  ExternalLink, Clock, File as FileIcon, PanelLeftClose, PanelLeftOpen,
  Maximize2, Minimize2, Download, Pencil,
} from 'lucide-react'
import type { LearningItem, ContentType, MaterialViewData } from '@/lib/types/learning'
import ProgressBar from './ProgressBar'
import ItemTypeBadge from './ItemTypeBadge'
import MaterialViewer from './MaterialViewer'
import { toEmbeddableVideoUrl } from '@/lib/learning/video-embed'
import LinkEmbed from './LinkEmbed'
import Tooltip from '@/components/ui/Tooltip'

const TYPE_ICONS: Record<ContentType, any> = {
  video: Play, file: FileIcon, document: FileText, url: Link2, article: BookOpen,
}

/**
 * The course consumption screen — the ONE component the learner sees AND the creator
 * previews, so a preview can never drift from reality. Data comes in via loaders so
 * the same UI works off a real assignment (learner) or straight off the path (preview).
 *
 * In `preview` mode: nothing is persisted (completion is local, no analytics view is
 * recorded — the parent wires the no-tracking loaders), sequential locking is relaxed
 * so the creator can roam freely, and an Edit button appears top-right.
 */
export default function CourseViewer({
  title,
  items,
  sequential,
  backHref,
  backLabel,
  watermark,
  loadView,
  loadFile,
  onDownload,
  persistComplete,
  persistUncomplete,
  preview = false,
  editHref,
}: {
  title: string
  items: LearningItem[]
  sequential: boolean
  backHref: string
  backLabel: string
  watermark: string
  loadView: (itemId: string) => Promise<MaterialViewData>
  loadFile: (itemId: string) => Promise<ArrayBuffer>
  onDownload?: (itemId: string) => void
  /** Persist completion (learner). Omit in preview — completion stays local. */
  persistComplete?: (itemId: string, type: 'manual' | 'auto_opened') => Promise<void>
  /** Persist an undo of completion (learner). Omit in preview. */
  persistUncomplete?: (itemId: string) => Promise<void>
  preview?: boolean
  editHref?: string
}) {
  const [completedIds, setCompletedIds] = useState<Set<string>>(
    () => new Set(items.filter((i) => i.progress?.status === 'completed').map((i) => i.id)),
  )
  const [activeItem, setActiveItem] = useState<LearningItem | null>(null)
  const [completing, setCompleting] = useState<string | null>(null)
  const [fileView, setFileView] = useState<MaterialViewData | null>(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [navOpen, setNavOpen] = useState(true)
  const [expanded, setExpanded] = useState(false)

  const percent = items.length ? Math.round((completedIds.size / items.length) * 100) : 0
  const lockedAt = (idx: number) =>
    sequential && !preview && idx > 0 && !completedIds.has(items[idx - 1].id)

  // Open the first accessible, not-yet-done item on mount.
  useEffect(() => {
    const firstIdx = items.findIndex((i, idx) => !lockedAt(idx) && !completedIds.has(i.id))
    const idx = firstIdx >= 0 ? firstIdx : (items.length ? 0 : -1)
    if (idx >= 0) openItem(items[idx], idx)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Esc exits fullscreen
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])

  async function openItem(item: LearningItem, idx: number) {
    if (lockedAt(idx)) return
    setActiveItem(item)

    if (item.content_type === 'file') {
      setFileView(null)
      setFileLoading(true)
      try { setFileView(await loadView(item.id)) } finally { setFileLoading(false) }
    } else {
      setFileView(null)
    }
    // No auto-complete on open — completion is always an explicit "Mark as Complete"
    // click (you can't tell someone watched a video just because they opened it).
  }

  async function markComplete(item: LearningItem, type: 'manual' | 'auto_opened') {
    if (completedIds.has(item.id)) return
    setCompleting(item.id)
    try {
      setCompletedIds((prev) => new Set(prev).add(item.id))
      if (persistComplete) await persistComplete(item.id, type)
    } finally {
      setCompleting(null)
    }
  }

  /** Undo an accidental completion. */
  async function unmarkComplete(item: LearningItem) {
    if (!completedIds.has(item.id)) return
    setCompleting(item.id)
    try {
      setCompletedIds((prev) => {
        const next = new Set(prev)
        next.delete(item.id)
        return next
      })
      if (persistUncomplete) await persistUncomplete(item.id)
    } finally {
      setCompleting(null)
    }
  }

  const isDone = (id: string) => completedIds.has(id)

  return (
    <div className="flex h-[calc(100vh-56px)]">
      {/* Sidebar: item list (collapsible, animated) */}
      <div
        className={[
          'shrink-0 bg-white flex flex-col overflow-hidden transition-[width] duration-300 ease-in-out',
          navOpen ? 'w-72 border-r border-border-light' : 'w-0 border-r-0',
        ].join(' ')}
      >
        <div className="w-72 h-full flex flex-col">
          <div className="p-4 border-b border-border-light">
            <div className="flex items-center justify-between mb-3">
              <Link
                href={backHref}
                className="inline-flex items-center gap-1.5 text-xs text-text-secondary hover:text-primary-text transition-colors"
              >
                <ArrowLeft size={13} />
                {backLabel}
              </Link>
              <Tooltip label="Collapse">
                <button
                  onClick={() => setNavOpen(false)}
                  aria-label="Collapse"
                  className="p-1 -mr-1 text-text-muted hover:text-primary-text hover:bg-primary-subtle rounded-[6px] transition-colors"
                >
                  <PanelLeftClose size={16} />
                </button>
              </Tooltip>
            </div>
            {preview && (
              <div className="mb-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-warning-bg text-warning text-[11px] font-semibold">
                Preview
              </div>
            )}
            <h2 className="text-sm font-bold text-text-primary line-clamp-2 mb-2">{title}</h2>
            <ProgressBar percent={percent} showLabel size="sm" />
          </div>

          <nav className="flex-1 overflow-y-auto py-2 px-2">
            {items.map((item, idx) => {
              const isActive = activeItem?.id === item.id
              const done = isDone(item.id)
              const locked = lockedAt(idx)
              return (
                <button
                  key={item.id}
                  onClick={() => openItem(item, idx)}
                  disabled={locked}
                  className={[
                    'w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-[8px] mb-0.5 transition-colors',
                    locked ? 'opacity-50 cursor-not-allowed'
                      : isActive ? 'bg-primary-subtle' : 'hover:bg-surface-sunken cursor-pointer',
                  ].join(' ')}
                >
                  <div className="mt-0.5 shrink-0">
                    {locked ? <Lock size={14} className="text-text-muted" />
                      : done ? <CheckCircle size={14} className="text-success" />
                      : <div className={`w-3.5 h-3.5 rounded-full border-2 ${isActive ? 'border-primary' : 'border-border'}`} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`text-xs font-medium truncate ${isActive ? 'text-primary-text' : done ? 'text-text-secondary' : 'text-text-primary'}`}>
                      {item.title}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <ItemTypeBadge type={item.content_type} />
                      {item.estimated_minutes && <span className="text-[10px] text-text-muted">{item.estimated_minutes}m</span>}
                    </div>
                  </div>
                </button>
              )
            })}
          </nav>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 overflow-y-auto bg-surface-sunken">
        {(!navOpen || (preview && editHref)) && (
          <div className="flex items-center justify-between max-w-6xl mx-auto px-4 sm:px-8 pt-4">
            {!navOpen ? (
              <div className="flex items-center gap-2">
                <Link
                  href={backHref}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-secondary bg-white border border-border-light rounded-[8px] shadow-xs hover:text-primary-text hover:border-primary transition-colors"
                >
                  <ArrowLeft size={14} /> {backLabel}
                </Link>
                <button
                  onClick={() => setNavOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-secondary bg-white border border-border-light rounded-[8px] shadow-xs hover:text-primary-text hover:border-primary transition-colors"
                >
                  <PanelLeftOpen size={14} /> Show list
                </button>
              </div>
            ) : <span />}
            {preview && editHref && (
              <Link
                href={editHref}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-primary hover:bg-primary-hover rounded-[8px] transition-colors"
              >
                <Pencil size={14} /> Edit course
              </Link>
            )}
          </div>
        )}

        {!activeItem ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <BookOpen size={40} className="text-[#CBD5E1] mx-auto mb-3" />
              <p className="text-sm text-text-secondary">
                {items.length ? 'Select a material from the list to begin' : 'This course has no materials yet'}
              </p>
            </div>
          </div>
        ) : (
          <div className="max-w-6xl mx-auto px-4 sm:px-8 py-6">
            {/* Item header */}
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-2">
                <ItemTypeBadge type={activeItem.content_type} />
                {activeItem.estimated_minutes && (
                  <span className="flex items-center gap-1 text-xs text-text-muted">
                    <Clock size={11} /> {activeItem.estimated_minutes} min
                  </span>
                )}
              </div>
              <h1 className="text-[22px] font-bold text-text-primary mb-1">{activeItem.title}</h1>
              {activeItem.description && <p className="text-sm text-text-secondary">{activeItem.description}</p>}
            </div>

            {/* Content */}
            <div className="bg-white border border-border-light rounded-[12px] p-6 mb-6">
              {activeItem.content_type === 'file' && (
                fileLoading ? (
                  <div className="flex items-center justify-center gap-2 py-16 text-sm text-text-secondary">
                    <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    Loading material…
                  </div>
                ) : fileView ? (
                  <>
                    <div className="flex items-center justify-end gap-2 mb-3">
                      {fileView.allow_download && onDownload && (
                        <button
                          onClick={() => onDownload(activeItem.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-primary hover:bg-primary-hover rounded-[8px] transition-colors"
                        >
                          <Download size={14} /> Download
                        </button>
                      )}
                      <button
                        onClick={() => setExpanded(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-primary-text bg-primary-subtle border border-primary-border rounded-[8px] hover:bg-primary-subtle transition-colors"
                      >
                        <Maximize2 size={14} /> Fullscreen
                      </button>
                    </div>
                    <MaterialViewer
                      key={activeItem.id}
                      data={fileView}
                      viewOnly={!fileView.allow_download}
                      watermark={watermark}
                      pdfLoader={() => loadFile(activeItem.id)}
                    />
                  </>
                ) : (
                  <p className="text-sm text-text-muted text-center py-8">Couldn’t load this material.</p>
                )
              )}

              {activeItem.content_type === 'article' && (
                <div className="prose prose-sm max-w-none text-text-primary whitespace-pre-wrap">
                  {activeItem.content_body ?? 'No content available.'}
                </div>
              )}

              {activeItem.content_type === 'video' && activeItem.content_url && (
                <div>
                  {/* Plays inline — just a small "open in new tab" logo, top-right */}
                  <div className="flex items-center justify-end mb-3">
                    <Tooltip label="Open in a new tab">
                      <a
                        href={activeItem.content_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Open in a new tab"
                        className="p-1.5 text-primary-text bg-primary-subtle border border-primary-border rounded-[8px] hover:bg-primary-subtle transition-colors"
                      >
                        <ExternalLink size={16} />
                      </a>
                    </Tooltip>
                  </div>
                  <div className="w-full aspect-video rounded-[8px] overflow-hidden bg-black">
                    <iframe src={toEmbeddableVideoUrl(activeItem.content_url)} className="w-full h-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen title={activeItem.title} />
                  </div>
                </div>
              )}

              {/* Link — auto-embed if the page allows it, else auto-fallback to a button */}
              {activeItem.content_type === 'url' && activeItem.content_url && (
                <LinkEmbed
                  key={activeItem.id}
                  url={activeItem.content_url}
                  title={activeItem.title}
                  onOpen={() => { if (!isDone(activeItem.id)) markComplete(activeItem, 'auto_opened') }}
                />
              )}

              {/* Document — external link button */}
              {activeItem.content_type === 'document' && activeItem.content_url && (
                <div className="flex flex-col items-center gap-4">
                  <a
                    href={activeItem.content_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => { if (!isDone(activeItem.id)) markComplete(activeItem, 'auto_opened') }}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-primary hover:bg-primary-hover rounded-[8px] transition-colors"
                  >
                    <ExternalLink size={15} />
                    Open Document
                  </a>
                </div>
              )}

              {activeItem.content_type !== 'file' && !activeItem.content_url && !activeItem.content_body && (
                <p className="text-sm text-text-muted text-center py-8">No content available for this item.</p>
              )}
            </div>

            {/* Complete button */}
            {!isDone(activeItem.id) ? (
              <button
                onClick={() => markComplete(activeItem, 'manual')}
                disabled={completing === activeItem.id}
                className="flex items-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-success hover:bg-success rounded-[8px] transition-colors disabled:bg-surface-control-pressed disabled:text-text-muted disabled:cursor-not-allowed"
              >
                {completing === activeItem.id
                  ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <CheckCircle size={16} />}
                Mark as Complete
              </button>
            ) : (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-success">
                  <CheckCircle size={18} /> Completed
                </div>
                <button
                  onClick={() => unmarkComplete(activeItem)}
                  disabled={completing === activeItem.id}
                  className="text-sm font-medium text-text-secondary hover:text-danger underline-offset-2 hover:underline disabled:opacity-60 transition-colors"
                >
                  Undo
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Fullscreen material overlay */}
      {expanded && activeItem?.content_type === 'file' && fileView && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-70 bg-white flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-light shrink-0">
            <div className="min-w-0 flex items-center gap-2">
              <FileIcon size={16} className="text-primary-text shrink-0" />
              <h3 className="text-sm font-semibold text-text-primary truncate">{activeItem.title}</h3>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {fileView.allow_download && onDownload && (
                <button
                  onClick={() => onDownload(activeItem.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white bg-primary hover:bg-primary-hover rounded-[8px] transition-colors"
                >
                  <Download size={15} /> Download
                </button>
              )}
              <Tooltip label="Exit fullscreen (Esc)">
                <button
                  onClick={() => setExpanded(false)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-text-secondary bg-white border border-border-light rounded-[8px] hover:text-primary-text hover:border-primary transition-colors"
                >
                  <Minimize2 size={15} /> Exit
                </button>
              </Tooltip>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <MaterialViewer
              key={`${activeItem.id}-fs`}
              data={fileView}
              viewOnly={!fileView.allow_download}
              watermark={watermark}
              pdfLoader={() => loadFile(activeItem.id)}
              fullscreen
            />
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
