'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, History, Undo2 } from 'lucide-react'
import {
  validateImport,
  commitImport,
  listImportBatches,
  undoImport,
  getImportBatchDetail,
  type BulkImportRow,
  type BulkImportResult,
  type ImportBatchDetail,
  type ImportBatchSummary,
  type ImportValidationResult,
  type UndoImportResult,
} from '@/lib/api/employees'
import { listSystemRoles, type SystemRoleLite } from '@/lib/api/permissions'
import { toast } from '@/components/ui/sonner'
import BulkImportWizard from '@/components/import/BulkImportWizard'
import {
  BatchHistoryList,
  DownloadFixesButton,
  FailedRowItem,
  FailedTile,
  FilterChip,
  FixLoopBanner,
  IssueList,
  KeptList,
  ListSection,
  LoadingDetail,
  InfoNote,
  PreviewTable,
  StatTile,
  StatusDot,
  SuccessTile,
  UndoButton,
  previewRowClass,
} from '@/components/import/ImportParts'
import { formatDateTime } from '@/lib/format'
import {
  EMPLOYEE_COLUMNS,
  EMPLOYEE_MISSING_COLUMNS,
  REMOVED_BY_UNDO_REASON,
  VALUE_SEPARATOR,
  employeeFailureStatusFromMessage,
  employeeFailureStatuses,
  type EmployeeColumn,
} from '@/lib/import/configs/employees'
import {
  addColumnValidation,
  columnLetter,
  dateValidation,
  listValidation,
  setColumnWidths,
  writeColumnHeader,
  writeReferenceHeader,
} from '@/lib/import/xlsx'
import type { ErrorReportEntry, ImportConfig } from '@/lib/import/types'
import type { Department, Role, EmployeeProfile } from '@/lib/types'

interface Props {
  orgId: string
  departments: Department[]
  roles: Role[]
  employees: EmployeeProfile[]
  onClose: () => void
  onImported: () => void
}

type EmployeeConfig = ImportConfig<
  EmployeeColumn,
  BulkImportRow,
  ImportValidationResult,
  BulkImportResult,
  ImportBatchSummary,
  ImportBatchDetail,
  UndoImportResult
>

type ChipFilter = 'total' | 'ready' | 'duplicate' | 'error' | 'warning'

const PASSWORD_NOTE = (
  <>
    New accounts use the password from the sheet, or <span className="font-medium text-text-primary">Welcome@123</span> when the
    password column is blank. Ask staff to change it after first sign-in.
  </>
)

function plural(n: number, word: string): string {
  return `${n} ${word}${n !== 1 ? 's' : ''}`
}

/** "Download N rows to fix & re-upload (a failed + b removed)". */
function fixesLabel(failed: number, removed: number): string {
  return removed > 0
    ? `Download ${failed + removed} rows to fix & re-upload (${failed} failed + ${removed} removed)`
    : `Download ${failed} ${failed === 1 ? 'row' : 'rows'} to fix & re-upload`
}

function PersonLine({ name, email, row }: { name: string | null; email: string | null; row: number }) {
  return (
    <div className="px-4 py-2">
      <p className="text-label text-text-primary">
        <span className="font-medium">{name || `Row ${row}`}</span>
        {email && <span className="text-text-muted"> · {email}</span>}
      </p>
    </div>
  )
}

export default function ImportEmployeesModal({ orgId, departments, roles, employees, onClose, onImported }: Props) {
  const [systemRoles, setSystemRoles] = useState<SystemRoleLite[]>([])
  useEffect(() => {
    listSystemRoles(orgId)
      .then(({ systemRoles }) => setSystemRoles(systemRoles))
      .catch(() => setSystemRoles([]))
  }, [orgId])

  const [chipFilter, setChipFilter] = useState<ChipFilter>('total')

  const deptNameById = useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments])

  // ─── Template (.xlsx with 4 reference sheets + dropdowns) ─────────────────────
  function buildTemplate(wb: Parameters<EmployeeConfig['template']['build']>[0]) {
    const ws = wb.addWorksheet('Employees')
    const wsDept = wb.addWorksheet('Departments')
    const wsRole = wb.addWorksheet('Roles')
    const wsMgr = wb.addWorksheet('Reports To')
    const wsSys = wb.addWorksheet('System Roles')

    // Departments — Sr. No. | Department | Parent Department (sorted by name).
    writeReferenceHeader(wsDept, ['Sr. No.', 'Department', 'Parent Department'])
    const deptSorted = [...departments].sort((a, b) => a.name.localeCompare(b.name))
    deptSorted.forEach((d, i) =>
      wsDept.addRow([i + 1, d.name, d.parent_department_id ? (deptNameById.get(d.parent_department_id) ?? '') : '']),
    )
    setColumnWidths(wsDept, (i) => (i === 0 ? 8 : 28))

    // Roles — Sr. No. | Role | Department | Value (sorted by dept, then role).
    writeReferenceHeader(wsRole, ['Sr. No.', 'Role', 'Department', 'Value (pick this in Employees)'])
    const roleRows = [...roles]
      .map((r) => ({ title: r.title, dept: deptNameById.get(r.department_id) ?? '' }))
      .sort((a, b) => a.dept.localeCompare(b.dept) || a.title.localeCompare(b.title))
    roleRows.forEach((r, i) => wsRole.addRow([i + 1, r.title, r.dept, `${r.title}${VALUE_SEPARATOR}${r.dept}`]))
    setColumnWidths(wsRole, (i) => (i === 0 ? 8 : i === 3 ? 36 : 26))

    // Reports To — Sr. No. | Name | Department | Role | Value (sorted by dept, then name).
    writeReferenceHeader(wsMgr, ['Sr. No.', 'Name', 'Department', 'Role', 'Value (pick this in Employees)'])
    const mgrRows = employees
      .map((e) => ({
        name: e.user?.name ?? '',
        dept: deptNameById.get(e.department_id) ?? '',
        role: e.role?.title ?? '',
      }))
      .filter((m) => m.name)
      .sort((a, b) => a.dept.localeCompare(b.dept) || a.name.localeCompare(b.name))
    mgrRows.forEach((m, i) =>
      wsMgr.addRow([i + 1, m.name, m.dept, m.role, `${m.name}${VALUE_SEPARATOR}${m.dept}${VALUE_SEPARATOR}${m.role}`]),
    )
    setColumnWidths(wsMgr, (i) => (i === 0 ? 8 : i === 4 ? 40 : 24))

    // System Roles — Sr. No. | System Role. Preserve the API order
    // (Employee, Manager, Leadership, …, Administrator) rather than re-sorting.
    writeReferenceHeader(wsSys, ['Sr. No.', 'System Role'])
    systemRoles.forEach((s, i) => wsSys.addRow([i + 1, s.name]))
    setColumnWidths(wsSys, (i) => (i === 0 ? 8 : 30))

    writeColumnHeader(ws, EMPLOYEE_COLUMNS, 22)

    // Example rows.
    const deptName = deptSorted[0]?.name ?? 'Engineering'
    const roleValue = roleRows[0]
      ? `${roleRows[0].title}${VALUE_SEPARATOR}${roleRows[0].dept}`
      : 'Software Engineer · Engineering'
    const sysName = systemRoles[0]?.name ?? 'Member'
    const mgrValue = mgrRows[0] ? `${mgrRows[0].name}${VALUE_SEPARATOR}${mgrRows[0].dept}${VALUE_SEPARATOR}${mgrRows[0].role}` : ''
    ws.addRow(['Jane Doe', 'jane.doe@company.com', '', deptName, 'Yes', roleValue, sysName, 'full_time', 'EMP-001', '', '2024-01-15', '1995-06-20', ''])
    ws.addRow(['John Smith', 'john.smith@company.com', '', deptName, 'No', roleValue, sysName, 'part_time', 'EMP-002', mgrValue, '2024-03-01', '1990-11-02', '2019-12-10'])

    // Dropdowns + date constraints for rows 2..LAST.
    const LAST = 500
    const letterOf = (col: EmployeeColumn) => columnLetter(EMPLOYEE_COLUMNS.findIndex((c) => c.key === col))
    const addList = (col: EmployeeColumn, formula: string) => addColumnValidation(ws, letterOf(col), LAST, listValidation(formula))
    const addDate = (col: EmployeeColumn) =>
      addColumnValidation(
        ws,
        letterOf(col),
        LAST,
        dateValidation('lessThanOrEqual', 'Enter a real date that is not in the future (YYYY-MM-DD).'),
        'yyyy-mm-dd',
      )
    addList('department', `'Departments'!$B$2:$B$${deptSorted.length + 1}`)
    // Department Head is a Yes/No choice; No is the default (listed first, and
    // a blank cell is treated as No by the importer).
    addList('is_department_head', '"No,Yes"')
    addList('role', `'Roles'!$D$2:$D$${roleRows.length + 1}`)
    addList('system_role', `'System Roles'!$B$2:$B$${systemRoles.length + 1}`)
    addList('reporting_to', `'Reports To'!$E$2:$E$${mgrRows.length + 1}`)
    addList('employment_type', '"full_time,part_time,contract"')
    addDate('date_of_joining')
    addDate('date_of_birth')
    addDate('marriage_date')
  }

  // ─── Views ────────────────────────────────────────────────────────────────────
  const renderPreview: NonNullable<EmployeeConfig['preview']>['render'] = (ctx) => {
    const v = ctx.validation
    if (!v) return null
    let visible = v.rows
    if (chipFilter === 'ready') visible = v.rows.filter((r) => r.status === 'ready')
    else if (chipFilter === 'duplicate') visible = v.rows.filter((r) => r.status === 'duplicate')
    else if (chipFilter === 'error') visible = v.rows.filter((r) => r.status === 'error')
    else if (chipFilter === 'warning')
      visible = v.rows.filter((r) => r.status === 'ready' && r.issues.some((i) => i.severity === 'warning'))
    const notReady = v.rows.filter((r) => r.status !== 'ready').length

    const downloadFailures = () =>
      ctx.downloadReport(
        v.rows
          .filter((r) => r.status !== 'ready')
          .map((vr) => ({
            payload: ctx.rows[vr.row - 2] ?? {},
            status: employeeFailureStatuses(vr).join(', '),
            reason: vr.issues.filter((i) => i.severity === 'error').map((i) => i.message).join('; '),
          })),
        'employee-import-failures.xlsx',
      )

    return (
      <>
        {/* Clickable filter chips: pick a category to show only those rows below. */}
        <div className="flex items-center gap-2 flex-wrap">
          <FilterChip color="slate" label={`${v.total} total`} active={chipFilter === 'total'} onClick={() => setChipFilter('total')} />
          <FilterChip color="green" label={`${v.ready} ready`} active={chipFilter === 'ready'} onClick={() => setChipFilter('ready')} />
          {v.duplicates > 0 && (
            <FilterChip color="red" label={`${v.duplicates} duplicate`} active={chipFilter === 'duplicate'} onClick={() => setChipFilter('duplicate')} />
          )}
          {v.errors > 0 && (
            <FilterChip color="red" label={`${v.errors} error`} active={chipFilter === 'error'} onClick={() => setChipFilter('error')} />
          )}
          {v.warnings > 0 && (
            <FilterChip color="amber" label={`${v.warnings} warning`} active={chipFilter === 'warning'} onClick={() => setChipFilter('warning')} />
          )}
          <span className="ml-auto text-meta text-text-muted">from {ctx.fileName}</span>
        </div>

        <PreviewTable
          headers={['#', 'Status', 'Name', 'Department', 'Role', 'System role', 'Issues']}
          maxHeightClass="max-h-[72vh]"
          textClass="text-label"
          empty={visible.length === 0}
        >
          {visible.map((r, i) => (
            <tr key={r.row} className={previewRowClass(r.status !== 'ready', i)}>
              <td className="px-3 py-2 text-text-muted">{r.row}</td>
              <td className="px-3 py-2">
                <StatusDot status={r.status} />
              </td>
              <td className="px-3 py-2">
                <div className="font-medium text-text-primary">{r.name || '—'}</div>
                <div className="text-text-muted">{r.email || '—'}</div>
              </td>
              <td className="px-3 py-2 text-text-secondary">{r.resolved.department || '—'}</td>
              <td className="px-3 py-2 text-text-secondary">{r.resolved.role || '—'}</td>
              <td className="px-3 py-2 text-text-secondary">{r.resolved.system_role || '—'}</td>
              <td className="px-3 py-2">
                <IssueList issues={r.issues} />
              </td>
            </tr>
          ))}
        </PreviewTable>

        <FixLoopBanner ready={v.ready} total={v.total} notReady={notReady} detailed onDownload={downloadFailures} />
      </>
    )
  }

  /** Failed rows, plus (after an undo) the rows the undo removed, as one correctable set. */
  function resultReportEntries(result: BulkImportResult, rows: BulkImportRow[], undo: UndoImportResult | null): ErrorReportEntry[] {
    const keptEmails = new Set((undo?.kept ?? []).map((k) => k.email.toLowerCase()))
    const entries: ErrorReportEntry[] = []
    for (const r of result.results) {
      const payload = rows[r.row - 2] ?? {}
      if (r.status === 'failed') {
        entries.push({ payload, status: employeeFailureStatusFromMessage(r.error || ''), reason: r.error || 'Failed to import' })
      } else if (undo && !keptEmails.has(r.email.toLowerCase())) {
        entries.push({ payload, status: 'Removed', reason: REMOVED_BY_UNDO_REASON })
      }
    }
    return entries
  }

  const config: EmployeeConfig = {
    title: 'Import Employees',
    columns: EMPLOYEE_COLUMNS,
    parse: {
      headerRequired: ['name', 'email'],
      missingColumnsError: EMPLOYEE_MISSING_COLUMNS,
      mapRow: (get) => {
        const row: BulkImportRow = {}
        for (const c of EMPLOYEE_COLUMNS) row[c.key] = get(c.key)
        return row
      },
      sheetName: 'Employees',
      dateMode: 'utc',
    },
    template: { fileName: 'employee-import-template.xlsx', build: buildTemplate },
    uploadIntro: (
      <p className="mt-0.5">
        Required columns (<span className="font-medium text-primary-text">blue header, marked *</span>): name, email, department,
        role, system_role. The <strong>department</strong>, <strong>role</strong>, <strong>system role</strong>,{' '}
        <strong>manager</strong> and <strong>employment type</strong> columns are <strong>dropdowns</strong> sourced from the
        reference sheets. Dates use a date picker and can’t be in the future. Leave password blank to default to{' '}
        <strong>Welcome@123</strong>.
      </p>
    ),
    uploadStep2Label: 'Step 2 — Upload the filled file to review',
    historyButtonLabel: 'History',

    validate: (rows) => validateImport(orgId, rows),
    preview: {
      fullPage: true,
      readyCount: (v) => v.ready,
      importLabel: (n) => `Import ${n} ready`,
      render: renderPreview,
      footerWarning: (v) => (
        <>
          Importing creates live user accounts and is <strong>not automatically reversible</strong> — please check the rows above
          thoroughly. Only the <strong>{v.ready} ready</strong> row{v.ready !== 1 ? 's' : ''} will be imported; the rest are
          skipped (download them to fix and re-upload). A short-lived undo is available right after import.
        </>
      ),
      confirm: {
        tone: 'danger',
        title: (v) => `Import ${v.ready} employees?`,
        description: (
          <>
            This creates live accounts and <strong>cannot be undone automatically</strong>. A guarded undo is available for a
            short window afterward, but it can only remove people who haven’t started accumulating data. Make sure you’ve
            reviewed the rows.
          </>
        ),
      },
    },

    commit: async (rows, fileName) => {
      const res = await commitImport(orgId, rows, fileName)
      if (res.created > 0) {
        const msg = `Imported ${plural(res.created, 'employee')}`
        if (res.failed > 0) toast.warning(msg)
        else toast.success(msg)
        onImported()
        // Land on the full Import details page for the batch just created. With nothing
        // created there is no batch: the result page still lists the failed rows.
        return { result: res, openBatchId: res.batch_id ?? undefined }
      }
      toast.error('No employees were imported')
      return { result: res }
    },
    commitErrorMode: 'inline',
    commitErrorFallback: 'Import failed. Please try again.',

    renderResult: (ctx) => {
      const result = ctx.result
      if (!result) return null
      const undo = ctx.undoResult
      const failed = result.results.filter((r) => r.status === 'failed')
      const keptEmails = new Set((undo?.kept ?? []).map((k) => k.email.toLowerCase()))
      const removed = undo ? result.results.filter((r) => r.status === 'created' && !keptEmails.has(r.email.toLowerCase())) : []
      const downloadCount = failed.length + removed.length
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            {undo ? (
              // After an undo, the import counts are stale: show what the undo did.
              <>
                <StatTile tone="neutral" icon={<Undo2 size={16} />} label={`${undo.undone} removed`} />
                {undo.kept.length > 0 && (
                  <StatTile tone="warning" icon={<AlertTriangle size={16} />} label={`${undo.kept.length} kept`} />
                )}
                {failed.length > 0 && <FailedTile label={`${failed.length} failed`} />}
              </>
            ) : (
              <>
                <SuccessTile label={`${result.created} imported`} />
                {result.failed > 0 && <FailedTile label={`${result.failed} failed`} />}
                {result.batch_id && result.created > 0 && (
                  <UndoButton
                    className="ml-auto"
                    undoing={ctx.undoingId === result.batch_id}
                    onClick={() => result.batch_id && ctx.requestUndo(result.batch_id)}
                  />
                )}
              </>
            )}
          </div>

          {downloadCount > 0 && (
            <DownloadFixesButton
              label={fixesLabel(failed.length, removed.length)}
              onClick={() => ctx.downloadReport(resultReportEntries(result, ctx.rows, undo), 'employee-import-fixes.xlsx')}
            />
          )}

          {undo && undo.kept.length > 0 && (
            <KeptList
              intro={`Kept ${undo.kept.length} — they already had activity and were left untouched:`}
              kept={undo.kept.map((k) => ({ key: k.email, name: k.name, reason: k.reason }))}
            />
          )}

          {removed.length > 0 && (
            <ListSection title={`Removed (${removed.length})`} maxHeightClass="max-h-52">
              {removed.map((r) => (
                <PersonLine key={r.row} name={r.name} email={r.email} row={r.row} />
              ))}
            </ListSection>
          )}

          {failed.length > 0 && (
            <ListSection title="Rows that need fixing">
              {failed.map((r) => (
                <FailedRowItem key={r.row} row={r.row} label={r.email || r.name} error={r.error} />
              ))}
            </ListSection>
          )}

          {!undo && <p className="text-label text-text-secondary">{PASSWORD_NOTE}</p>}
        </div>
      )
    },

    history: {
      list: () => listImportBatches(orgId),
      undo: (id) => undoImport(orgId, id),
      detail: (id) => getImportBatchDetail(orgId, id),
      undoToast: (res) => ({
        kind: res.kept.length > 0 ? 'warning' : 'success',
        message: res.undone > 0 ? `Removed ${plural(res.undone, 'imported employee')}` : 'Nothing was removed',
      }),
      undoErrorFallback: 'Undo failed.',
      undoConfirm: {
        description: (
          <>
            This removes the employee accounts created by this import. Anyone who already has activity — heads a department, owns
            data, or has people reporting to them — is <strong>kept</strong> and listed afterward. This can’t be reversed.
          </>
        ),
      },
      render: (ctx) => (
        <BatchHistoryList
          batches={ctx.batches}
          undoingId={ctx.undoingId}
          onUndo={ctx.requestUndo}
          onOpen={(id) => ctx.openBatch(id)}
          noUndoLabel={(b) => (b.status === 'committed' ? 'Undo window passed' : 'Undone')}
          above={
            ctx.undoResult && ctx.undoResult.kept.length > 0 ? (
              <KeptList
                intro={`Kept ${ctx.undoResult.kept.length} — they already had activity and were left untouched:`}
                kept={ctx.undoResult.kept.map((k) => ({ key: k.email, name: k.name, reason: k.reason }))}
              />
            ) : ctx.undoResult ? (
              <div className="border border-border-light rounded-lg p-4 space-y-2">
                <p className="text-body font-medium text-text-primary">Removed {plural(ctx.undoResult.undone, 'employee')}.</p>
              </div>
            ) : null
          }
        />
      ),
      renderDetail: (ctx) => {
        const detail = ctx.detail
        if (ctx.loadingDetail || !detail) return <LoadingDetail />

        const createdPresent = detail.rows.filter((r) => r.status === 'created' && r.still_present)
        const removed = detail.rows.filter((r) => r.status === 'created' && !r.still_present)
        const failed = detail.rows.filter((r) => r.status === 'failed')
        const downloadCount = failed.length + removed.length
        // For reconstructed (pre-persistence) batches the removed rows aren't stored,
        // but the undo summary still records how many were removed.
        const removedCount = removed.length || (detail.rows_reconstructed ? (detail.undo_summary?.undone ?? 0) : 0)

        const downloadFixes = () => {
          const entries: ErrorReportEntry[] = []
          for (const r of detail.rows) {
            if (r.status === 'failed') {
              entries.push({ payload: r.data, status: employeeFailureStatusFromMessage(r.error || ''), reason: r.error || 'Failed to import' })
            } else if (!r.still_present) {
              entries.push({ payload: r.data, status: 'Removed', reason: REMOVED_BY_UNDO_REASON })
            }
          }
          ctx.downloadReport(entries, 'employee-import-fixes.xlsx')
        }

        return (
          <div className="space-y-4">
            <div>
              <p className="text-body font-medium text-text-primary">{detail.file_name || 'Untitled import'}</p>
              <p className="text-meta text-text-muted mt-0.5">
                {formatDateTime(new Date(detail.created_at))} · by {detail.imported_by}
                {detail.status !== 'committed' && (
                  <span className="ml-2 text-meta font-medium text-text-muted uppercase">{detail.status.replace('_', ' ')}</span>
                )}
              </p>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <SuccessTile label={`${createdPresent.length} present`} />
              {removedCount > 0 && <StatTile tone="neutral" icon={<Undo2 size={16} />} label={`${removedCount} removed`} />}
              {failed.length > 0 && <FailedTile label={`${failed.length} failed`} />}
              {detail.can_undo && (
                <UndoButton className="ml-auto" undoing={ctx.undoingId === detail.id} onClick={() => ctx.requestUndo(detail.id)} />
              )}
            </div>

            {detail.rows.length === 0 ? (
              <InfoNote icon={<AlertTriangle size={16} className="text-text-muted mt-0.5 shrink-0" />}>
                Row-level details weren’t recorded for this import (it predates detailed history). The summary above still
                applies: {detail.created_count} created, {detail.failed_count} failed, {detail.remaining} still present.
              </InfoNote>
            ) : (
              <>
                {detail.rows_reconstructed && (
                  <InfoNote icon={<AlertTriangle size={16} className="text-text-muted mt-0.5 shrink-0" />}>
                    This import predates detailed history, so the list below is rebuilt from the employees still in the system.
                    Original cell values and any failed rows weren’t recorded, so re-export isn’t available for this one. New
                    imports keep full row-level detail.
                  </InfoNote>
                )}

                {downloadCount > 0 && <DownloadFixesButton label={fixesLabel(failed.length, removed.length)} onClick={downloadFixes} />}

                {detail.undo_summary && detail.undo_summary.kept.length > 0 && (
                  <KeptList
                    intro={`Kept ${detail.undo_summary.kept.length} on undo — they already had activity and were left untouched:`}
                    kept={detail.undo_summary.kept.map((k) => ({ key: k.email, name: k.name, reason: k.reason }))}
                  />
                )}

                {removed.length > 0 && (
                  <ListSection title={`Removed (${removed.length})`} maxHeightClass="max-h-52">
                    {removed.map((r) => (
                      <PersonLine key={r.row} name={r.name} email={r.email} row={r.row} />
                    ))}
                  </ListSection>
                )}

                {createdPresent.length > 0 && (
                  <ListSection title={`Imported & present (${createdPresent.length})`} maxHeightClass="max-h-52">
                    {createdPresent.map((r) => (
                      <PersonLine key={r.row} name={r.name} email={r.email} row={r.row} />
                    ))}
                  </ListSection>
                )}

                {failed.length > 0 && (
                  <ListSection title={`Rows that need fixing (${failed.length})`}>
                    {failed.map((r) => (
                      <FailedRowItem key={r.row} row={r.row} label={r.email || r.name || undefined} error={r.error ?? undefined} />
                    ))}
                  </ListSection>
                )}
              </>
            )}

            {ctx.detailOrigin === 'import' && (
              <>
                {createdPresent.length > 0 && <p className="text-label text-text-secondary">{PASSWORD_NOTE}</p>}
                <InfoNote icon={<History size={15} className="text-text-muted mt-0.5 shrink-0" />}>
                  You can reopen this import anytime from <span className="font-medium text-text-primary">Import → History</span>.
                </InfoNote>
              </>
            )}
          </div>
        )
      },
    },
  }

  return (
    <BulkImportWizard
      config={config}
      onClose={onClose}
      onChanged={onImported}
      report={{ colWidth: 22 }}
    />
  )
}
