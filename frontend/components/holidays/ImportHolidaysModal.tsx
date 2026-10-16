'use client'

import { useState, useRef } from 'react'
import { X, Upload, Download, AlertCircle, CheckCircle2, Trash2 } from 'lucide-react'
import { holidaysApi } from '@/lib/api/holidays'

interface ParsedHoliday {
  name: string
  date: string
  type: string
  is_recurring_yearly: boolean
  description: string
  _error?: string
}

const VALID_TYPES = ['national', 'company', 'regional']

const TEMPLATE_CSV = `Name,Date,Type,Recurring Yearly,Description
Republic Day,2025-01-26,national,yes,National holiday
Independence Day,2025-08-15,national,yes,National holiday
Gandhi Jayanti,2025-10-02,national,yes,National holiday
Diwali,2025-10-20,national,no,Festival of lights
Holi,2025-03-14,national,no,Festival of colors
`

function parseCSV(text: string): ParsedHoliday[] {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'))
  const nameIdx = header.indexOf('name')
  const dateIdx = header.indexOf('date')
  const typeIdx = header.indexOf('type')
  const recurringIdx = header.findIndex((h) => h.includes('recurring'))
  const descIdx = header.indexOf('description')

  return lines.slice(1).map((line) => {
    const cols = line.split(',').map((c) => c.trim())
    const name = nameIdx >= 0 ? cols[nameIdx] ?? '' : ''
    const date = dateIdx >= 0 ? cols[dateIdx] ?? '' : ''
    const type = typeIdx >= 0 ? (cols[typeIdx] ?? 'national').toLowerCase() : 'national'
    const recurring = recurringIdx >= 0 ? cols[recurringIdx]?.toLowerCase() === 'yes' : false
    const description = descIdx >= 0 ? cols[descIdx] ?? '' : ''

    let error: string | undefined
    if (!name) error = 'Name is required'
    else if (!date) error = 'Date is required'
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date).getTime())) error = 'Date must be YYYY-MM-DD'
    else if (type && !VALID_TYPES.includes(type)) error = `Type must be: ${VALID_TYPES.join(', ')}`

    return { name, date, type: VALID_TYPES.includes(type) ? type : 'national', is_recurring_yearly: recurring, description, _error: error }
  }).filter((r) => r.name || r.date)
}

function downloadTemplate() {
  const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'holidays_template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

interface Props {
  orgId: string
  onClose: () => void
  onImported: () => void
}

export default function ImportHolidaysModal({ orgId, onClose, onImported }: Props) {
  const [rows, setRows] = useState<ParsedHoliday[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const parsed = parseCSV(text)
      setRows(parsed)
      setSelected(new Set(parsed.map((_, i) => i).filter((i) => !parsed[i]._error)))
      setResult(null)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  function toggleRow(i: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i))
    setSelected((prev) => {
      const next = new Set<number>()
      prev.forEach((idx) => { if (idx !== i) next.add(idx > i ? idx - 1 : idx) })
      return next
    })
  }

  async function handleImport() {
    const toImport = rows.filter((_, i) => selected.has(i) && !rows[i]._error)
    if (toImport.length === 0) return
    setImporting(true)
    try {
      const res = await holidaysApi.bulkImportOrgHolidays(orgId, toImport.map(({ _error: _, ...r }) => r))
      setResult(res)
      onImported()
    } finally {
      setImporting(false)
    }
  }

  const validSelected = rows.filter((r, i) => selected.has(i) && !r._error).length
  const errorCount = rows.filter((r) => r._error).length

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="relative w-full max-w-3xl bg-white rounded-t-[16px] sm:rounded-[12px] shadow-[0_8px_32px_rgba(0,0,0,0.16)] border border-border-light max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border-light shrink-0">
          <h2 className="text-[20px] font-semibold text-text-primary">Import Holidays</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-[6px] flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-control transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Actions row */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={downloadTemplate}
              className="flex items-center gap-2 h-9 px-4 rounded-[8px] text-sm font-medium text-text-secondary border border-border bg-white hover:bg-surface-sunken transition-colors"
            >
              <Download size={14} />
              Download Template
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 h-9 px-4 rounded-[8px] text-sm font-semibold text-white bg-primary hover:bg-primary-hover transition-colors"
            >
              <Upload size={14} />
              {rows.length > 0 ? 'Replace CSV' : 'Upload CSV'}
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleFile} className="hidden" />
            <p className="text-xs text-text-muted">Columns: Name, Date (YYYY-MM-DD), Type, Recurring Yearly (yes/no), Description</p>
          </div>

          {/* Error summary */}
          {errorCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-danger-bg border border-danger-border rounded-[8px] text-sm text-danger">
              <AlertCircle size={14} className="shrink-0" />
              {errorCount} row{errorCount !== 1 ? 's' : ''} have errors and will be skipped. Fix in your CSV and re-upload.
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="flex items-center gap-2 px-3 py-2 bg-success-bg border border-success-border rounded-[8px] text-sm text-success">
              <CheckCircle2 size={14} className="shrink-0" />
              {result.imported} imported, {result.skipped} skipped (duplicates or invalid dates).
            </div>
          )}

          {/* Preview table */}
          {rows.length > 0 && (
            <div className="border border-border-light rounded-[10px] overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-surface-sunken border-b border-border-light">
                  <tr>
                    <th className="w-10 px-3 py-2.5 text-left">
                      <input
                        type="checkbox"
                        checked={selected.size === rows.filter((r) => !r._error).length && rows.some((r) => !r._error)}
                        onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((_, i) => i).filter((i) => !rows[i]._error)) : new Set())}
                        className="accent-primary"
                      />
                    </th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-text-muted uppercase tracking-wide">Name</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-text-muted uppercase tracking-wide">Date</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-text-muted uppercase tracking-wide">Type</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-text-muted uppercase tracking-wide">Recurring</th>
                    <th className="w-8 px-2 py-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-control">
                  {rows.map((row, i) => (
                    <tr key={i} className={row._error ? 'bg-danger-bg' : selected.has(i) ? 'bg-surface-sunken' : 'bg-white'}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selected.has(i) && !row._error}
                          disabled={!!row._error}
                          onChange={() => toggleRow(i)}
                          className="accent-primary disabled:opacity-40"
                        />
                      </td>
                      <td className="px-3 py-2 font-medium text-text-primary">
                        {row.name}
                        {row._error && <p className="text-[11px] text-danger mt-0.5">{row._error}</p>}
                      </td>
                      <td className="px-3 py-2 text-text-secondary">{row.date}</td>
                      <td className="px-3 py-2 text-text-secondary capitalize">{row.type}</td>
                      <td className="px-3 py-2 text-text-secondary">{row.is_recurring_yearly ? 'Yes' : 'No'}</td>
                      <td className="px-2 py-2">
                        <button type="button" onClick={() => removeRow(i)} className="text-text-muted hover:text-danger transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {rows.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center border-2 border-dashed border-border-light rounded-[12px]">
              <Upload size={28} className="text-[#CBD5E1] mb-3" />
              <p className="text-sm font-medium text-text-primary">Upload a CSV file to preview holidays</p>
              <p className="text-xs text-text-secondary mt-1">Download the template above to get started</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-6 py-4 border-t border-border-light">
          <p className="text-sm text-text-secondary">
            {rows.length > 0 ? <><span className="font-semibold text-text-primary">{validSelected}</span> of {rows.length} rows selected</> : 'No file uploaded'}
          </p>
          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3">
            <button type="button" onClick={onClose} className="w-full sm:w-auto px-4 py-2 text-sm font-semibold text-primary-text border-2 border-primary rounded-[8px] hover:bg-primary-subtle transition-colors">
              {result ? 'Close' : 'Cancel'}
            </button>
            {!result && (
              <button
                type="button"
                onClick={handleImport}
                disabled={importing || validSelected === 0}
                className="w-full sm:w-auto px-4 py-2 text-sm font-semibold text-white bg-primary rounded-[8px] hover:bg-primary-hover disabled:bg-surface-control-pressed disabled:text-text-muted transition-colors"
              >
                {importing ? 'Importing...' : `Import ${validSelected} Holiday${validSelected !== 1 ? 's' : ''}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
