'use client'

import { useEffect, useState } from 'react'
import DOMPurify from 'dompurify'
import { Loader2, FileWarning, Download } from 'lucide-react'
import type { PreviewKind } from '@/lib/types/learning'

/**
 * Renders Office/text materials IN THE BROWSER from their raw bytes — no server
 * conversion. Word (.docx) via Mammoth → HTML; Excel (.xlsx/.xls) and CSV via SheetJS
 * → HTML table(s); plain text directly. Libraries are dynamically imported so they
 * only load when such a file is actually opened.
 */
export default function OfficeViewer({
  kind,
  loader,
  fullscreen,
  onDownload,
}: {
  kind: PreviewKind
  loader: () => Promise<ArrayBuffer>
  fullscreen?: boolean
  /** Optional download fallback shown if rendering fails. */
  onDownload?: () => void
}) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [html, setHtml] = useState('')
  const [text, setText] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const buf = await loader()
        if (cancelled) return
        if (kind === 'text' || kind === 'csv') {
          if (kind === 'text') {
            setText(new TextDecoder().decode(new Uint8Array(buf)))
          } else {
            const XLSX: any = await import('xlsx')
            const wb = XLSX.read(new Uint8Array(buf), { type: 'array' })
            setHtml(sheetsToHtml(XLSX, wb))
          }
        } else if (kind === 'docx') {
          const mammoth: any = await import('mammoth')
          const res = await mammoth.convertToHtml({ arrayBuffer: buf })
          if (cancelled) return
          setHtml(res.value || '<p>(empty document)</p>')
        } else if (kind === 'xlsx') {
          const XLSX: any = await import('xlsx')
          const wb = XLSX.read(new Uint8Array(buf), { type: 'array' })
          setHtml(sheetsToHtml(XLSX, wb))
        }
        if (!cancelled) setStatus('ready')
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()
    return () => { cancelled = true }
    // loader identity changes per render; the parent remounts this per material (keyed
    // by item id), so a mount-once effect is correct and avoids a refetch loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  const maxHeight = fullscreen ? 'calc(100vh - 120px)' : '72vh'

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-text-secondary">
        <Loader2 size={18} className="animate-spin text-primary-text" /> Loading document…
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className="flex flex-col items-center gap-3 py-14 text-center">
        <FileWarning size={24} className="text-text-muted" />
        <p className="text-sm font-medium text-text-primary">Couldn’t render this document</p>
        {onDownload && (
          <button
            onClick={onDownload}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-primary hover:bg-primary-hover rounded-[8px] transition-colors"
          >
            <Download size={15} /> Download to open it
          </button>
        )}
      </div>
    )
  }

  if (kind === 'text') {
    return (
      <div className="overflow-auto p-4" style={{ maxHeight }}>
        <pre className="whitespace-pre-wrap text-sm text-text-primary font-mono leading-relaxed">{text}</pre>
      </div>
    )
  }

  // docx / xlsx / csv — rendered HTML
  return (
    <div className="office-html overflow-auto p-5" style={{ maxHeight }}>
      <style>{OFFICE_CSS}</style>
      <div
        className={kind === 'docx' ? 'prose prose-sm max-w-none text-text-primary' : ''}
        // Sanitize the library output (Mammoth/SheetJS) before injecting — strips any
        // script/event-handler/javascript: URI that could ride in via a crafted file.
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
      />
    </div>
  )
}

/** Join all sheets to HTML, labelling each when there's more than one. */
function sheetsToHtml(XLSX: any, wb: any): string {
  const names: string[] = wb.SheetNames ?? []
  return names
    .map((name) => {
      const table = XLSX.utils.sheet_to_html(wb.Sheets[name])
      return names.length > 1 ? `<div class="sheet-name">${escapeHtml(name)}</div>${table}` : table
    })
    .join('')
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}

/** Table styling for SheetJS output (which has no classes of its own). */
const OFFICE_CSS = `
.office-html table { border-collapse: collapse; width: max-content; max-width: 100%; margin-bottom: 16px; font-size: 13px; }
.office-html td, .office-html th { border: 1px solid #E2E8F0; padding: 4px 8px; color: #1E293B; white-space: nowrap; }
.office-html tr:first-child td { background: #F8FAFC; font-weight: 600; }
.office-html .sheet-name { font-weight: 700; color: #0F172A; margin: 12px 0 6px; }
.office-html img { max-width: 100%; height: auto; }
`
