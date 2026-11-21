'use client'

import { useState, useRef } from 'react'
import { Upload, Download, AlertCircle, CheckCircle2, Trash2 } from 'lucide-react'
import { holidaysApi } from '@/lib/api/holidays'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { downloadBlob } from '@/lib/import/csv'
import {
  HOLIDAY_TEMPLATE_CSV,
  HOLIDAY_TEMPLATE_FILE_NAME,
  parseHolidayCsv,
  type ParsedHoliday,
} from '@/lib/import/configs/holidays'

interface Props {
  orgId: string
  onClose: () => void
  onImported: () => void
}

// Holidays are a CSV-only, edit-before-import list (pick rows, drop rows) with no server
// validation or history, so it shares the CSV parsing, header handling and download helper
// with the other imports but not the wizard's upload -> review -> history flow.
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
      const parsed = parseHolidayCsv(String(ev.target?.result ?? ''))
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
      prev.forEach((idx) => {
        if (idx !== i) next.add(idx > i ? idx - 1 : idx)
      })
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
  const validRows = rows.filter((r) => !r._error)
  const th = 'px-3 py-2.5 text-left text-meta font-medium text-text-muted uppercase tracking-wide'

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="lg" className="max-w-3xl max-h-[92vh] p-0">
        <div className="flex flex-col max-h-[92vh]">
          <div className="px-6 pt-4 pb-4 border-b border-border-light shrink-0">
            <DialogTitle className="text-section font-medium text-text-primary">Import Holidays</DialogTitle>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <Button
                variant="secondary"
                onClick={() => downloadBlob(new Blob([HOLIDAY_TEMPLATE_CSV], { type: 'text/csv' }), HOLIDAY_TEMPLATE_FILE_NAME)}
              >
                <Download size={14} /> Download Template
              </Button>
              <Button onClick={() => fileRef.current?.click()}>
                <Upload size={14} /> {rows.length > 0 ? 'Replace CSV' : 'Upload CSV'}
              </Button>
              <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleFile} className="hidden" />
              <p className="text-meta text-text-muted">Columns: Name, Date (YYYY-MM-DD), Type, Recurring Yearly (yes/no), Description</p>
            </div>

            {errorCount > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 bg-danger-bg border border-danger-border rounded-lg text-body text-danger">
                <AlertCircle size={14} className="shrink-0" />
                {errorCount} row{errorCount !== 1 ? 's' : ''} have errors and will be skipped. Fix in your CSV and re-upload.
              </div>
            )}

            {result && (
              <div className="flex items-center gap-2 px-3 py-2 bg-success-bg border border-success-border rounded-lg text-body text-success">
                <CheckCircle2 size={14} className="shrink-0" />
                {result.imported} imported, {result.skipped} skipped (duplicates or invalid dates).
              </div>
            )}

            {rows.length > 0 ? (
              <div className="border border-border-light rounded-lg overflow-hidden">
                <table className="w-full text-body">
                  <thead className="bg-surface-sunken border-b border-border-light">
                    <tr>
                      <th className="w-10 px-3 py-2.5 text-left">
                        <input
                          type="checkbox"
                          aria-label="Select all valid rows"
                          checked={selected.size === validRows.length && validRows.length > 0}
                          onChange={(e) =>
                            setSelected(e.target.checked ? new Set(rows.map((_, i) => i).filter((i) => !rows[i]._error)) : new Set())
                          }
                          className="accent-primary"
                        />
                      </th>
                      <th className={th}>Name</th>
                      <th className={th}>Date</th>
                      <th className={th}>Type</th>
                      <th className={th}>Recurring</th>
                      <th className="w-8 px-2 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-control">
                    {rows.map((row, i) => (
                      <tr key={i} className={row._error ? 'bg-danger-bg' : selected.has(i) ? 'bg-surface-sunken' : 'bg-surface'}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            aria-label={`Select ${row.name || 'row'}`}
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
                          <button
                            type="button"
                            aria-label={`Remove ${row.name || 'row'}`}
                            onClick={() => removeRow(i)}
                            className="text-text-muted hover:text-danger transition-colors"
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center border-2 border-dashed border-border-light rounded-lg">
                <Upload size={28} className="text-text-muted mb-3" />
                <p className="text-body font-medium text-text-primary">Upload a CSV file to preview holidays</p>
                <p className="text-meta text-text-secondary mt-1">Download the template above to get started</p>
              </div>
            )}
          </div>

          <div className="shrink-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-6 py-4 border-t border-border-light">
            <p className="text-body text-text-secondary">
              {rows.length > 0 ? (
                <>
                  <span className="font-medium text-text-primary">{validSelected}</span> of {rows.length} rows selected
                </>
              ) : (
                'No file uploaded'
              )}
            </p>
            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3">
              <Button variant="secondary" onClick={onClose}>
                {result ? 'Close' : 'Cancel'}
              </Button>
              {!result && (
                <Button onClick={() => void handleImport()} disabled={validSelected === 0} loading={importing} loadingLabel="Importing...">
                  {`Import ${validSelected} Holiday${validSelected !== 1 ? 's' : ''}`}
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
