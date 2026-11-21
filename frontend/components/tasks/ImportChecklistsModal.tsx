'use client'

import { useState } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, ListChecks } from 'lucide-react'
import { toast } from '@/components/ui/sonner'
import { Button } from '@/components/ui/button'
import Tooltip from '@/components/ui/tooltip'
import BulkImportWizard from '@/components/import/BulkImportWizard'
import { SummaryChip, UndoButton } from '@/components/import/ImportParts'
import { tasksApi } from '@/lib/api/tasks'
import { formatDateTime } from '@/lib/format'
import { writeColumnHeader } from '@/lib/import/xlsx'
import {
  CHECKLIST_COLUMNS,
  CHECKLIST_MISSING_COLUMNS,
  mapChecklistRow,
  type ChecklistColumn,
} from '@/lib/import/configs/checklists'
import type { ImportConfig } from '@/lib/import/types'
import type {
  BulkImportChecklistRow,
  ChecklistImportBatchSummary,
  ChecklistImportResult,
  ChecklistImportValidationResult,
  ChecklistUndoImportResult,
} from '@/lib/types/tasks'

interface Props {
  orgId: string
  onClose: () => void
  onImported: () => void
}

type ChecklistConfig = ImportConfig<
  ChecklistColumn,
  BulkImportChecklistRow,
  ChecklistImportValidationResult,
  ChecklistImportResult,
  ChecklistImportBatchSummary,
  ChecklistImportBatchSummary,
  ChecklistUndoImportResult
>

export default function ImportChecklistsModal({ orgId, onClose, onImported }: Props) {
  const [onlyProblems, setOnlyProblems] = useState(false)

  const config: ChecklistConfig = {
    title: 'Import Checklists',
    phaseTitles: { result: 'Import complete' },
    columns: CHECKLIST_COLUMNS,
    parse: {
      headerRequired: ['checklist_name', 'item'],
      missingColumnsError: CHECKLIST_MISSING_COLUMNS,
      mapRow: mapChecklistRow,
      sheetName: 'Checklists',
      dateMode: 'utc',
    },
    template: {
      fileName: 'checklist-import-template.xlsx',
      build: (wb) => {
        const ws = wb.addWorksheet('Checklists')
        writeColumnHeader(ws, CHECKLIST_COLUMNS)
        ws.columns = [{ width: 34 }, { width: 52 }]

        // Example: two checklists, one row per item (same name groups items).
        ws.addRow(['Client Onboarding', 'Collect KYC documents'])
        ws.addRow(['Client Onboarding', 'Create account'])
        ws.addRow(['Client Onboarding', 'Send welcome email'])
        ws.addRow(['Vendor Setup', 'Verify GST number'])
        ws.addRow(['Vendor Setup', 'Sign NDA'])

        // A short instructions sheet.
        const wsInfo = wb.addWorksheet('How to use')
        wsInfo.columns = [{ width: 90 }]
        const lines = [
          'How to fill this file',
          '',
          '1. Put one checklist ITEM per row.',
          '2. Rows that share the same "Checklist Name" become ONE checklist template.',
          '3. You can add as many checklists as you like in this one file.',
          '4. Both columns are required. Blank rows are ignored.',
          '5. Imported checklists arrive INACTIVE — set "Who can use this checklist", then activate each.',
        ]
        lines.forEach((t, i) => {
          wsInfo.addRow([t])
          if (i === 0) wsInfo.getRow(1).font = { bold: true, size: 13 }
        })
      },
    },
    uploadIntro: (
      <p className="mt-0.5">
        Put <strong>one item per row</strong>. Rows that share the same <strong>Checklist Name</strong> become one checklist —
        so a single file can hold <strong>many checklists</strong>. Imported checklists arrive <strong>inactive</strong> so you
        can set who can use each one, then activate it.
      </p>
    ),
    uploadStep2Label: 'Step 2 — Upload the filled file to review',
    historyButtonLabel: 'History',

    validate: (rows) => tasksApi.validateChecklistImport(orgId, rows),
    preview: {
      fullPage: false,
      backArrow: true,
      readyCount: (v) => v.templates,
      importLabel: (n) => `Import ${n} checklist${n !== 1 ? 's' : ''}`,
      render: (ctx) => {
        const v = ctx.validation
        if (!v) return null
        const groups = v.groups.filter((g) => g.items.length > 0)
        const visibleRows = onlyProblems ? v.rows.filter((r) => r.status !== 'ready' || r.issues.length > 0) : v.rows
        return (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <SummaryChip color="blue" label={`${v.templates} checklist${v.templates !== 1 ? 's' : ''}`} />
              <SummaryChip color="green" label={`${v.ready} item${v.ready !== 1 ? 's' : ''} ready`} />
              {v.errors > 0 && <SummaryChip color="red" label={`${v.errors} error${v.errors !== 1 ? 's' : ''}`} />}
              {v.warnings > 0 && <SummaryChip color="amber" label={`${v.warnings} warning${v.warnings !== 1 ? 's' : ''}`} />}
              <span className="ml-auto text-meta text-text-muted truncate max-w-[40%]">from {ctx.fileName}</span>
            </div>

            {/* Grouped checklists preview */}
            <div className="space-y-2">
              <p className="text-meta font-medium uppercase tracking-wide text-text-muted">Checklists to create</p>
              {groups.length === 0 && (
                <p className="text-body text-text-muted">No valid checklists found. Fix the errors below and re-upload.</p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {groups.map((g, i) => (
                  <div key={i} className="border border-border-light rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-body font-medium text-text-primary truncate">{g.name}</span>
                      <span className="shrink-0 text-meta font-medium rounded-full px-2 py-0.5 bg-primary-subtle text-primary-text">
                        {g.items.length} item{g.items.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    {g.already_exists && (
                      <span className="inline-block mt-1 text-meta font-medium text-warning">
                        A checklist with this name already exists
                      </span>
                    )}
                    <ul className="mt-1.5 space-y-0.5">
                      {g.items.slice(0, 4).map((it, j) => (
                        <li key={j} className="text-meta text-text-secondary truncate">
                          • {it}
                        </li>
                      ))}
                      {g.items.length > 4 && <li className="text-meta text-text-muted">+{g.items.length - 4} more</li>}
                    </ul>
                  </div>
                ))}
              </div>
            </div>

            {/* Problem rows */}
            {(v.errors > 0 || v.warnings > 0) && (
              <div>
                <label className="flex items-center gap-2 text-body text-text-secondary mb-2">
                  <input
                    type="checkbox"
                    checked={onlyProblems}
                    onChange={(e) => setOnlyProblems(e.target.checked)}
                    className="rounded-xs border-border"
                  />
                  Show only rows with problems
                </label>
                <div className="border border-border-light rounded-lg overflow-hidden">
                  <div className="max-h-[34vh] overflow-y-auto">
                    <table className="w-full text-body">
                      <thead className="bg-surface-sunken sticky top-0">
                        <tr className="text-left text-meta text-text-muted">
                          <th className="px-3 py-2 font-medium w-12">Row</th>
                          <th className="px-3 py-2 font-medium">Checklist</th>
                          <th className="px-3 py-2 font-medium">Item</th>
                          <th className="px-3 py-2 font-medium">Issues</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleRows.map((r) => (
                          <tr key={r.row} className="border-t border-border-light align-top">
                            <td className="px-3 py-2 text-text-muted">{r.row}</td>
                            <td className="px-3 py-2 text-text-primary truncate max-w-[140px]">
                              {r.checklist_name || <span className="text-danger">—</span>}
                            </td>
                            <td className="px-3 py-2 text-text-secondary truncate max-w-[160px]">
                              {r.item || <span className="text-danger">—</span>}
                            </td>
                            <td className="px-3 py-2">
                              {r.issues.length === 0 ? (
                                <span className="inline-flex items-center gap-1 text-success text-meta">
                                  <CheckCircle2 size={13} /> OK
                                </span>
                              ) : (
                                <ul className="space-y-0.5">
                                  {r.issues.map((iss, k) => (
                                    <li
                                      key={k}
                                      className={`inline-flex items-center gap-1 text-meta ${iss.severity === 'error' ? 'text-danger' : 'text-warning'}`}
                                    >
                                      {iss.severity === 'error' ? <AlertCircle size={12} /> : <AlertTriangle size={12} />}{' '}
                                      {iss.message}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <Button onClick={ctx.importNow} disabled={v.templates === 0} loading={ctx.importing} loadingLabel="Importing…">
                <ListChecks size={15} /> {`Import ${v.templates} checklist${v.templates !== 1 ? 's' : ''}`}
              </Button>
              <Button variant="secondary" onClick={ctx.chooseAnotherFile}>
                Choose another file
              </Button>
            </div>
          </>
        )
      },
    },

    commit: async (rows, fileName) => {
      const res = await tasksApi.commitChecklistImport(orgId, rows, fileName)
      if (res.created > 0) {
        toast[res.failed > 0 ? 'warning' : 'success'](`Imported ${res.created} checklist${res.created !== 1 ? 's' : ''}`)
        onImported()
      } else {
        toast.error('No checklists were imported')
      }
      return { result: res }
    },
    commitErrorMode: 'inline',
    commitErrorFallback: 'Import failed. Please try again.',

    renderResult: (ctx) => {
      const r = ctx.result
      if (!r) return null
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <SummaryChip color="green" label={`${r.created} created`} />
            {r.failed > 0 && <SummaryChip color="red" label={`${r.failed} failed`} />}
          </div>
          <div className="flex items-start gap-3 p-4 rounded-lg bg-warning-bg border border-warning-border">
            <AlertTriangle size={18} className="text-warning mt-0.5 shrink-0" />
            <p className="text-body text-warning">
              Imported checklists are <strong>inactive</strong>. Open each one, set <strong>“Who can use this checklist”</strong>,
              then <strong>activate</strong> it so it appears when creating tasks.
            </p>
          </div>
          {r.batch_id && (
            <UndoButton
              onClick={() => r.batch_id && ctx.requestUndo(r.batch_id)}
              undoing={ctx.undoingId === r.batch_id}
            />
          )}
          {ctx.undoResult && (
            <p className="text-label text-text-secondary">
              Removed {ctx.undoResult.undone}.{' '}
              {ctx.undoResult.kept.length > 0 && `Kept ${ctx.undoResult.kept.length} (already activated).`}
            </p>
          )}
        </div>
      )
    },

    history: {
      list: () => tasksApi.listChecklistImportBatches(orgId),
      undo: (id) => tasksApi.undoChecklistImport(orgId, id),
      undoToast: (res) => ({
        kind: res.kept.length > 0 ? 'warning' : 'success',
        message: res.undone > 0 ? `Removed ${res.undone} imported checklist${res.undone !== 1 ? 's' : ''}` : 'Nothing was removed',
      }),
      undoErrorFallback: 'Undo failed.',
      render: (ctx) => (
        <div className="space-y-3">
          {ctx.batches.length === 0 && <p className="text-body text-text-muted text-center py-8">No imports yet.</p>}
          {ctx.batches.map((b) => (
            <div key={b.id} className="border border-border-light rounded-lg p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-body font-medium text-text-primary truncate">{b.file_name || 'Checklist import'}</p>
                  <p className="text-meta text-text-muted mt-0.5">
                    {formatDateTime(b.created_at)} · by {b.imported_by}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    <SummaryChip color="green" label={`${b.created_count} created`} />
                    {b.failed_count > 0 && <SummaryChip color="red" label={`${b.failed_count} failed`} />}
                    <SummaryChip color="blue" label={`${b.remaining} remaining`} />
                    {b.status !== 'committed' && (
                      <SummaryChip color="amber" label={b.status === 'undone' ? 'undone' : 'partly undone'} />
                    )}
                  </div>
                </div>
                <Tooltip label={b.can_undo ? 'Remove the still-inactive checklists from this import' : 'Nothing left to undo'}>
                  <span className="shrink-0">
                    <UndoButton
                      size="sm"
                      label="Undo"
                      onClick={() => ctx.requestUndo(b.id)}
                      undoing={ctx.undoingId === b.id}
                      disabled={!b.can_undo}
                    />
                  </span>
                </Tooltip>
              </div>
            </div>
          ))}
        </div>
      ),
    },
  }

  return <BulkImportWizard config={config} onClose={onClose} onChanged={onImported} />
}
