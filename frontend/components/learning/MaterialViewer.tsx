'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, Loader2, FileWarning, Lock } from 'lucide-react'
import type { MaterialViewData } from '@/lib/types/learning'
import OfficeViewer from './OfficeViewer'

/**
 * In-app document viewer. Renders a material inline — PDF (incl. Office docs
 * converted to PDF), image, video, or audio — so learners never leave the app.
 *
 * When `viewOnly` (the course-decider set "no download"), it renders defensively:
 *  • PDFs draw to <canvas> via pdf.js — no browser toolbar, so no download/print button.
 *  • a personalised watermark (viewer name/email/time) is tiled across the content, so
 *    any screenshot is traceable to the person who took it.
 *  • right-click, text selection, drag-save and media download affordances are suppressed.
 * True prevention of screenshots is impossible on the web; this is deterrence + traceability.
 */
export default function MaterialViewer({
  data,
  viewOnly,
  watermark,
  onDownload,
  pdfLoader,
  fullscreen = false,
}: {
  data: MaterialViewData
  /** true = no-download material: strip toolbars, watermark, suppress save paths. */
  viewOnly: boolean
  /** Identity string tiled over the content when viewOnly (e.g. "Jane · jane@co.com · 2026-07-19"). */
  watermark?: string
  /** Shown as a Download button when the material allows downloading. */
  onDownload?: () => void
  /** Fetches the PDF bytes same-origin (avoids R2 CORS); used for kind === 'pdf'. */
  pdfLoader?: () => Promise<ArrayBuffer>
  /** Render tall to fill a fullscreen container (PDF/video use more vertical space). */
  fullscreen?: boolean
}) {
  const guardProps = viewOnly
    ? {
        onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
        style: { userSelect: 'none' as const, WebkitUserSelect: 'none' as const },
      }
    : {}

  return (
    <div className="relative" {...guardProps}>
      {/* Download affordance only when allowed */}
      {!viewOnly && onDownload && (
        <div className="flex justify-end mb-3">
          <button
            onClick={onDownload}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-[8px] transition-colors"
          >
            <Download size={15} /> Download
          </button>
        </div>
      )}
      {viewOnly && (
        <div className="flex items-center gap-1.5 mb-3 text-xs text-[#64748B]">
          <Lock size={13} /> View-only — downloading is disabled for this material.
        </div>
      )}

      <div className="relative rounded-[10px] overflow-hidden border border-[#E2E8F0] bg-[#F8FAFC]">
        <MaterialBody data={data} viewOnly={viewOnly} pdfLoader={pdfLoader} fullscreen={fullscreen} onDownload={onDownload} />
        {viewOnly && watermark && <WatermarkOverlay text={watermark} />}
      </div>
    </div>
  )
}

const OFFICE_KINDS = ['docx', 'xlsx', 'csv', 'text']

function MaterialBody({ data, viewOnly, pdfLoader, fullscreen, onDownload }: { data: MaterialViewData; viewOnly: boolean; pdfLoader?: () => Promise<ArrayBuffer>; fullscreen?: boolean; onDownload?: () => void }) {
  // Word/Excel/CSV/text are rendered in-browser from their bytes (not a URL).
  if (OFFICE_KINDS.includes(data.kind) && pdfLoader) {
    return <OfficeViewer kind={data.kind} loader={pdfLoader} fullscreen={fullscreen} onDownload={onDownload} />
  }
  if (!data.url || data.kind === 'none') {
    const preparing = data.preview_status === 'pending'
    return (
      <div className="flex flex-col items-center justify-center text-center py-16 px-6">
        {preparing ? (
          <>
            <Loader2 size={26} className="text-[#2563EB] animate-spin mb-3" />
            <p className="text-sm font-medium text-[#0F172A]">Preparing preview…</p>
            <p className="text-xs text-[#64748B] mt-1">This document is being converted for in-app viewing.</p>
          </>
        ) : (
          <>
            <FileWarning size={26} className="text-[#94A3B8] mb-3" />
            <p className="text-sm font-medium text-[#0F172A]">Preview not available for this file type</p>
            <p className="text-xs text-[#64748B] mt-1">
              {viewOnly ? 'This material can only be viewed in-app.' : 'Use the Download button to open it.'}
            </p>
          </>
        )}
      </div>
    )
  }

  if (data.kind === 'pdf') return <PdfCanvas url={data.url} loader={pdfLoader} fullscreen={fullscreen} />
  if (data.kind === 'image') {
    return (
      <div className="flex justify-center p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={data.url}
          alt={data.file_name ?? 'Image'}
          draggable={false}
          className="max-w-full h-auto rounded-[6px]"
        />
      </div>
    )
  }
  if (data.kind === 'video') {
    return (
      <video
        src={data.url}
        controls
        controlsList={viewOnly ? 'nodownload noplaybackrate' : undefined}
        onContextMenu={viewOnly ? (e) => e.preventDefault() : undefined}
        style={{ maxHeight: fullscreen ? 'calc(100vh - 120px)' : '70vh' }}
        className="w-full bg-black"
      />
    )
  }
  if (data.kind === 'audio') {
    return (
      <div className="p-6">
        <audio src={data.url} controls controlsList={viewOnly ? 'nodownload' : undefined} className="w-full" />
      </div>
    )
  }
  return null
}

/** Renders every page of a PDF to canvas with pdf.js — no browser chrome, so no built-in download/print. */
function PdfCanvas({ url, loader, fullscreen }: { url: string | null; loader?: () => Promise<ArrayBuffer>; fullscreen?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    const container = containerRef.current
    if (!container) return

    ;(async () => {
      try {
        // pdf.js v4 relies on Promise.withResolvers (Chrome 119+/FF121+) — polyfill for older browsers.
        if (typeof (Promise as any).withResolvers !== 'function') {
          ;(Promise as any).withResolvers = function () {
            let resolve: any, reject: any
            const promise = new Promise((res, rej) => { resolve = res; reject = rej })
            return { promise, resolve, reject }
          }
        }
        // Load pdf.js from /public at runtime, fully hidden from static bundling.
        // A plain `import('pdfjs-dist')` pulls build/pdf.mjs into the module graph,
        // whose fake-worker fallback `import(this.workerSrc)` neither webpack (via the
        // magic comment) nor Turbopack (which ignores it) can resolve — breaking the
        // build. Building the dynamic import through Function() keeps the specifier
        // invisible to BOTH bundlers; the browser resolves '/pdf.min.mjs' same-origin.
        const loadPdfjs = new Function("return import('/pdf.min.mjs')") as () => Promise<any>
        const pdfjs: any = await loadPdfjs()
        // Served same-origin from /public — no bundler/CDN worker resolution to fail.
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

        // Prefer the same-origin byte loader (avoids R2 CORS); fall back to a direct URL.
        const source = loader
          ? { data: new Uint8Array(await loader()) }
          : { url: url as string }
        const doc = await pdfjs.getDocument(source).promise
        if (cancelled) return
        container.innerHTML = ''
        // Target the width actually available so pages fill the column (crisp, not upscaled).
        const avail = container.clientWidth || 900
        const targetWidth = fullscreen
          ? Math.min(1800, (typeof window !== 'undefined' ? window.innerWidth : 1400) - 48)
          : avail
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n)
          if (cancelled) return
          const base = page.getViewport({ scale: 1 })
          // Fit to the target width, but don't blow tiny pages up past 2.5×.
          const scale = Math.min(2.5, Math.max(1, targetWidth / base.width))
          const viewport = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          canvas.className = 'mx-auto mb-3 shadow-xs max-w-full h-auto'
          const ctx = canvas.getContext('2d')
          if (!ctx) continue
          container.appendChild(canvas)
          await page.render({ canvasContext: ctx, viewport }).promise
        }
        if (!cancelled) setStatus('ready')
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()

    return () => { cancelled = true }
  }, [url])

  return (
    <div className="overflow-y-auto p-4" style={{ maxHeight: fullscreen ? 'calc(100vh - 110px)' : '72vh' }}>
      {status === 'loading' && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#475569]">
          <Loader2 size={18} className="animate-spin text-[#2563EB]" /> Loading document…
        </div>
      )}
      {status === 'error' && (
        <div className="flex flex-col items-center py-16 text-center">
          <FileWarning size={24} className="text-[#94A3B8] mb-2" />
          <p className="text-sm font-medium text-[#0F172A]">Couldn’t render this document</p>
        </div>
      )}
      <div ref={containerRef} className={status === 'ready' ? '' : 'hidden'} />
    </div>
  )
}

/** Tiled, rotated, low-opacity identity stamp — traceable if screenshotted. */
function WatermarkOverlay({ text }: { text: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden select-none" aria-hidden>
      <div
        className="absolute inset-[-25%] flex flex-wrap gap-x-16 gap-y-14 opacity-[0.12] rotate-[-30deg]"
        style={{ fontSize: 13, color: '#0F172A', fontWeight: 600 }}
      >
        {Array.from({ length: 120 }).map((_, i) => (
          <span key={i} className="whitespace-nowrap">{text}</span>
        ))}
      </div>
    </div>
  )
}
