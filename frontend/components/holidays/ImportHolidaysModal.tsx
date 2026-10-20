'use client'

import { useState, useRef } from 'react'
import { Upload, Download, AlertCircle, CheckCircle2, Trash2 } from 'lucide-react'
import { holidaysApi } from '@/lib/api/holidays'
import { Button } from '@/components/ui/button'
import Tooltip from '@/components/ui/tooltip'
import ImportDialog from '@/components/imports/ImportDialog'
import { useGuardedClose } from '@/lib/use-guarded-close'

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

  const guard = useGuardedClose({
    open: true,
    values: { count: result ? 0 : rows.length },
    noun: 'import',
    onClose,
  })

  return (
    <ImportDialog
      title="Import holidays"
      onClose={guard.requestClose}
      busy={importing}
      footer={
        <>
          <p className="mr-auto hidden text-body text-text-secondary sm:block">
            {rows.length > 0 ? <><span className="font-medium text-text-primary">{validSelected}</span> of {rows.length} rows selected</> : 'No file uploaded'}
          </p>
          <Button variant="secondary" type="button" onClick={guard.requestClose} disabled={importing}>
            {result ? 'Close' : 'Cancel'}
          </Button>
          {!result && (
            <Button
              variant="primary"
              type="button"
              onClick={handleImport}
              disabled={validSelected === 0}
              loading={importing}
              loadingLabel="Importing"
            >
              {`Import ${validSelected} holiday${validSelected !== 1 ? 's' : ''}`}
            </Button>
          )}
        </>
      }
    >
          {/* Actions row */}
          <div className="flex items-center gap-3 flex-wrap">
            <Button variant="secondary" type="button" onClick={downloadTemplate}>
              <Download size={14} />
              Download template
            </Button>
            <Button variant="secondary" type="button" onClick={() => fileRef.current?.click()}>
              <Upload size={14} />
              {rows.length > 0 ? 'Replace CSV' : 'Upload CSV'}
            </Button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleFile} className="hidden" />
            <p className="text-meta text-text-muted">Columns: Name, Date (YYYY-MM-DD), Type, Recurring yearly (yes/no), Description</p>
          </div>

          {/* Error summary */}
          {errorCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-danger-bg border border-danger-border rounded-lg text-body text-danger">
              <AlertCircle size={14} className="shrink-0" />
              {errorCount} row{errorCount !== 1 ? 's' : ''} have errors and will be skipped. Fix in your CSV and re-upload.
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="flex items-center gap-2 px-3 py-2 bg-success-bg border border-success-border rounded-lg text-body text-success">
              <CheckCircle2 size={14} className="shrink-0" />
              {result.imported} imported, {result.skipped} skipped (duplicates or invalid dates).
            </div>
          )}

          {/* Preview table */}
          {rows.length > 0 && (
            <div className="border border-border-light rounded-xl overflow-hidden">
              <table className="w-full text-body">
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
                    <th className="px-3 py-2.5 text-left text-meta font-medium text-text-muted">Name</th>
                    <th className="px-3 py-2.5 text-left text-meta font-medium text-text-muted">Date</th>
                    <th className="px-3 py-2.5 text-left text-meta font-medium text-text-muted">Type</th>
                    <th className="px-3 py-2.5 text-left text-meta font-medium text-text-muted">Recurring</th>
                    <th className="w-8 px-2 py-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-control">
                  {rows.map((row, i) => (
                    <tr key={i} className={row._error ? 'bg-danger-bg' : selected.has(i) ? 'bg-surface-sunken' : 'bg-surface'}>
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
                        {row._error && <p className="text-meta text-danger mt-0.5">{row._error}</p>}
                      </td>
                      <td className="px-3 py-2 text-text-secondary">{row.date}</td>
                      <td className="px-3 py-2 text-text-secondary capitalize">{row.type}</td>
                      <td className="px-3 py-2 text-text-secondary">{row.is_recurring_yearly ? 'Yes' : 'No'}</td>
                      <td className="px-2 py-2">
                        <Tooltip label="Remove row">
                          <Button variant="ghost" size="icon-sm" type="button" onClick={() => removeRow(i)} aria-label="Remove row">
                            <Trash2 size={13} />
                          </Button>
                        </Tooltip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {rows.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center border-2 border-dashed border-border-light rounded-card">
              <Upload size={28} className="text-text-muted mb-3" />
              <p className="text-body font-medium text-text-primary">Upload a CSV file to preview holidays</p>
              <p className="text-meta text-text-secondary mt-1">Download the template above to get started</p>
            </div>
          )}
      {guard.warning}
    </ImportDialog>
  )
}
