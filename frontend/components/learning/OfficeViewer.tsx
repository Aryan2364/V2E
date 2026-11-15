'use client'

import { useEffect, useState } from 'react'
import DOMPurify from 'dompurify'
import { Loader2, FileWarning, Download } from 'lucide-react'
import type { PreviewKind } from '@/lib/types/learning'

/**
 * Renders Office/text materials IN THE BROWSER from their raw bytes — no server
 * conversion. Word (.docx) via Mammoth → HTML; Excel (.xlsx) via ExcelJS and CSV via a small parser
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
            setHtml(csvToHtml(new TextDecoder().decode(new Uint8Array(buf))))
          }
        } else if (kind === 'docx') {
          const mammoth: any = await import('mammoth')
          const res = await mammoth.convertToHtml({ arrayBuffer: buf })
          if (cancelled) return
          setHtml(res.value || '<p>(empty document)</p>')
        } else if (kind === 'xlsx') {
          const ExcelJS = await import('exceljs')
          const wb = new ExcelJS.Workbook()
          await wb.xlsx.load(buf)
          if (cancelled) return
          setHtml(sheetsToHtml(wb))
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
      <div className="flex items-center justify-center gap-2 py-12 text-label text-text-secondary">
        <Loader2 size={18} className="animate-spin text-primary-text" /> Loading document…
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <FileWarning size={24} className="text-text-muted" />
        <p className="text-label font-medium text-text-primary">Couldn’t render this document</p>
        {onDownload && (
          <button
            onClick={onDownload}
            className="inline-flex items-center gap-2 px-4 py-2 text-label font-medium text-primary-foreground bg-primary hover:bg-primary-hover rounded-control transition-colors"
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
        <pre className="whitespace-pre-wrap text-label text-text-primary font-mono leading-relaxed">{text}</pre>
      </div>
    )
  }

  // docx / xlsx / csv — rendered HTML
  return (
    <div className="office-html overflow-auto p-4" style={{ maxHeight }}>
      <style>{OFFICE_CSS}</style>
      <div
        className={kind === 'docx' ? 'prose prose-sm max-w-none text-text-primary' : ''}
        // Sanitize the library output (Mammoth/ExcelJS) before injecting — strips any
        // script/event-handler/javascript: URI that could ride in via a crafted file.
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
      />
    </div>
  )
}

/** Join all sheets to HTML, labelling each when there's more than one. */
function rowsToTable(rows: string[][]): string {
  const body = rows
    .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
    .join('')
  return `<table><tbody>${body}</tbody></table>`
}

function sheetsToHtml(wb: import('exceljs').Workbook): string {
  const sheets = wb.worksheets
  return sheets
    .map((ws) => {
      const cols = ws.columnCount
      const rows: string[][] = []
      ws.eachRow({ includeEmpty: true }, (row) => {
        const cells: string[] = []
        for (let c = 1; c <= cols; c++) cells.push(row.getCell(c).text ?? '')
        rows.push(cells)
      })
      const table = rowsToTable(rows)
      return sheets.length > 1 ? `<div class="sheet-name">${escapeHtml(ws.name)}</div>${table}` : table
    })
    .join('')
}

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
function csvToHtml(text: string): string {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ } else quoted = false
      } else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''; rows.push(row); row = []
    } else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rowsToTable(rows)
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}

/** Table styling for SheetJS. */
const OFFICE_CSS = `
.office-html table { border-collapse: collapse; width: max-content; max-width: 100%; margin-bottom: 16px; font-size: 13px; }
.office-html td, .office-html th { border: 1px solid var(--border-light); padding: 4px 8px; color: var(--text-primary); white-space: nowrap; }
.office-html tr:first-child td { background: var(--surface-sunken); font-weight: 500; }
.office-html .sheet-name { font-weight: 500; color: var(--text-primary); margin: 12px 0 6px; }
.office-html img { max-width: 100%; height: auto; }
`
