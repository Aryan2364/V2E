'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, History, Paperclip } from 'lucide-react'
import FileDropzone, { AttachmentErrorBox } from '@/components/ui/FileDropzone'
import { PendingFileList } from '@/components/ui/AttachmentList'
import { toast } from '@/components/ui/sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import BulkImportWizard from '@/components/import/BulkImportWizard'
import {
  FailedTile,
  FilterChip,
  FixLoopBanner,
  IssueList,
  PreviewTable,
  StatusDot,
  SuccessTile,
  UndoButton,
  previewRowClass,
} from '@/components/import/ImportParts'
import { formatDateTime } from '@/lib/format'
import { tasksApi } from '@/lib/api/tasks'
import { getNow } from '@/lib/clock'
import TagList from '@/components/tasks/TagList'
import { useTaskTags } from '@/lib/tasks/useTaskTags'
import type { TaskTagRef } from '@/lib/types/tasks'
import {
  getImportOptions,
  validateTaskImport,
  commitTaskImport,
  listTaskImportBatches,
  getTaskImportBatchDetail,
  undoTaskImport,
  type BulkTaskImportRow,
  type TaskImportBatchDetail,
  type TaskImportBatchSummary,
  type TaskImportOptions,
  type TaskImportResolved,
  type TaskImportResult,
  type TaskImportValidationResult,
  type TaskUndoImportResult,
} from '@/lib/api/task-import'
import {
  GUIDE_MARKER,
  TASK_COLUMNS,
  TASK_COLUMN_RULE,
  TASK_MISSING_COLUMNS,
  mapTaskRow,
  normName,
  referencedAttachmentNames,
  taskFailureStatuses,
  type TaskColumn,
} from '@/lib/import/configs/tasks'
import {
  addColumnValidation,
  columnLetter,
  dateValidation,
  listValidation,
  setColumnWidths,
  writeColumnHeader,
  writeReferenceHeader,
} from '@/lib/import/xlsx'
import { apiErrorMessage, toYmdLocal } from '@/lib/import/csv'
import type { ImportConfig } from '@/lib/import/types'

interface Props {
  orgId: string
  onClose: () => void
  onImported: () => void
  /** Render inline inside another modal (the Create Task modal's "Bulk upload" tab):
      no own portal/overlay, no close-X, no full-page preview breakout. */
  embedded?: boolean
}

type TaskConfig = ImportConfig<
  TaskColumn,
  BulkTaskImportRow,
  TaskImportValidationResult,
  TaskImportResult,
  TaskImportBatchSummary,
  TaskImportBatchDetail,
  TaskUndoImportResult
>

type ChipFilter = 'total' | 'ready' | 'error' | 'warning'

const ASSIGNEE_COLUMNS: TaskColumn[] = [
  'assignee_1', 'assignee_2', 'assignee_3', 'assignee_4', 'assignee_5',
  'cc_1', 'cc_2', 'cc_3', 'escalation_1', 'escalation_2', 'escalation_3',
]

function plural(n: number, word: string): string {
  return `${n} ${word}${n !== 1 ? 's' : ''}`
}

function StatusBadge({ s }: { s: TaskImportBatchSummary['status'] }) {
  const cls = {
    committed: 'bg-success-bg text-success border-success-border',
    undone: 'bg-danger-bg text-danger border-danger-border',
    partially_undone: 'bg-warning-bg text-warning border-warning-border',
  }[s]
  const label = s === 'partially_undone' ? 'Partly undone' : s === 'undone' ? 'Undone' : 'Committed'
  return <span className={`text-meta font-medium px-2 py-0.5 rounded-full border ${cls}`}>{label}</span>
}

export default function ImportTasksModal({ orgId, onClose, onImported, embedded = false }: Props) {
  // ─── Template options (reference data), loaded up front with a retry ──────────
  const [options, setOptions] = useState<TaskImportOptions | null>(null)
  const [loadingOptions, setLoadingOptions] = useState(true)
  const [optionsError, setOptionsError] = useState<string | null>(null)
  const fetchOptions = useCallback(() => {
    getImportOptions(orgId)
      .then((o) => {
        setOptions(o)
        setOptionsError(null)
      })
      .catch((err: unknown) => {
        setOptions(null)
        setOptionsError(apiErrorMessage(err, (err as { message?: string } | null)?.message ?? 'Could not load the template options. Please retry.'))
      })
      .finally(() => setLoadingOptions(false))
  }, [orgId])
  const loadOptions = useCallback(() => {
    setLoadingOptions(true)
    setOptionsError(null)
    fetchOptions()
  }, [fetchOptions])
  useEffect(() => {
    if (orgId) fetchOptions()
  }, [orgId, fetchOptions])
  const noOrg = !orgId

  const [chipFilter, setChipFilter] = useState<ChipFilter>('total')

  // Shared attachment pool: files referenced by the sheet's `attachments` column,
  // matched to rows by filename and uploaded to each created task after commit.
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([])
  const [attachErrors, setAttachErrors] = useState<string[]>([])

  // A row's resolved tags as chips: colours from the shared tag list, names falling back
  // to the import options (unknown names are row errors, listed under Issues).
  const { tags: orgTags } = useTaskTags(orgId, { includeInactive: true })
  const resolvedTags = useCallback(
    (resolved: TaskImportResolved): TaskTagRef[] => {
      const ids = resolved.tag_ids ?? []
      const names = resolved.tags ?? []
      return ids.map((id, i) => {
        const known = orgTags.find((t) => t.id === id)
        if (known) return known
        const name = names[i] ?? options?.tags?.find((t) => t.id === id)?.name ?? 'Tag'
        return { id, name, color: 'slate', is_active: true }
      })
    },
    [orgTags, options],
  )

  const uploadedNameSet = useMemo(() => new Set(attachmentFiles.map((f) => normName(f.name))), [attachmentFiles])

  // ─── Template (.xlsx with reference sheets + dropdowns) ───────────────────────
  function buildTemplate(wb: Parameters<TaskConfig['template']['build']>[0]) {
    if (!options) return
    const importTags = options.tags ?? []
    const ws = wb.addWorksheet('Tasks')
    const wsPri = wb.addWorksheet('Priorities')
    const wsCat = wb.addWorksheet('Categories')
    const wsTag = wb.addWorksheet('Tags')
    const wsGoal = wb.addWorksheet('Goals')
    const wsTpl = wb.addWorksheet('Checklist Templates')
    const wsPeople = wb.addWorksheet('Assignees')

    writeReferenceHeader(wsPri, ['Sr. No.', 'Priority'])
    options.priorities.forEach((p, i) => wsPri.addRow([i + 1, p.label]))
    setColumnWidths(wsPri, (i) => (i === 0 ? 8 : 28))

    writeReferenceHeader(wsCat, ['Sr. No.', 'Category'])
    options.categories.forEach((c, i) => wsCat.addRow([i + 1, c.name]))
    setColumnWidths(wsCat, (i) => (i === 0 ? 8 : 28))

    // Tags: the valid names for the `tags` column. A cell takes several, so it gets
    // no dropdown; it is checked against this list on upload.
    writeReferenceHeader(wsTag, ['Sr. No.', 'Tag'])
    importTags.forEach((t, i) => wsTag.addRow([i + 1, t.name]))
    setColumnWidths(wsTag, (i) => (i === 0 ? 8 : 28))

    writeReferenceHeader(wsGoal, ['Sr. No.', 'Quarterly Goal'])
    options.goals.forEach((g, i) => wsGoal.addRow([i + 1, g.title]))
    setColumnWidths(wsGoal, (i) => (i === 0 ? 8 : 40))

    writeReferenceHeader(wsTpl, ['Sr. No.', 'Checklist Template'])
    options.checklist_templates.forEach((t, i) => wsTpl.addRow([i + 1, t.name]))
    setColumnWidths(wsTpl, (i) => (i === 0 ? 8 : 36))

    // Assignees: Sr | Name | Department | Role | Value (pick this). Value is the
    // exact dropdown value used by every assignee / CC / escalation column.
    writeReferenceHeader(wsPeople, ['Sr. No.', 'Name', 'Department', 'Role', 'Value (pick this)'])
    options.assignees.forEach((a, i) => wsPeople.addRow([i + 1, a.name, a.department_name ?? '', a.role_title ?? '', a.value]))
    setColumnWidths(wsPeople, (i) => (i === 0 ? 8 : i === 4 ? 44 : 24))

    writeColumnHeader(ws, TASK_COLUMNS, 20)

    // Guide row (row 2): each column's rule in plain words. Skipped on import
    // (its title cell starts with GUIDE_MARKER); the user may delete it.
    const guideCells = TASK_COLUMNS.map((c) => TASK_COLUMN_RULE[c.key])
    guideCells[0] = `${GUIDE_MARKER} Guide row (safe to delete) · ${TASK_COLUMN_RULE.title}`
    const guideRow = ws.addRow(guideCells)
    guideRow.height = 30
    guideRow.eachCell((cell) => {
      cell.font = { italic: true, color: { argb: 'FF475569' }, size: 9 }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }
      cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
    })

    // Two example rows using real option values where available.
    const p0 = options.priorities[0]?.label ?? ''
    const c0 = options.categories[0]?.name ?? ''
    const tg0 = importTags.slice(0, 2).map((t) => t.name).join(', ')
    const a0 = options.assignees[0]?.value ?? 'Jane Doe · Sales'
    const a1 = options.assignees[1]?.value ?? ''
    const tpl0 = options.checklist_templates[0]?.name ?? ''
    const soon = toYmdLocal(new Date(getNow().getTime() + 7 * 864e5))
    ws.addRow([
      'Prepare Q3 report', 'Draft and circulate the quarterly report', p0, c0, tg0,
      soon, '17:00', a0, a1, '', '', '', '', '', '',
      a1 ? 'all_must_complete' : 'any_can_complete', 'No', '', '', '', '', '',
      '2', tpl0, 'Collect figures | Write summary | Send for review', '', 'No',
    ])
    ws.addRow([
      'Kickoff meeting notes', '', p0, c0, '',
      soon, '', a0, '', '', '', '', '', '', '',
      'any_can_complete', 'Yes', 'pdf | docx', '', '', '', '', '1', '', '', 'notes.pdf', 'No',
    ])

    const LAST = 500
    const letterOf = (col: TaskColumn) => columnLetter(TASK_COLUMNS.findIndex((c) => c.key === col))
    const addList = (col: TaskColumn, formula: string) => addColumnValidation(ws, letterOf(col), LAST, listValidation(formula))

    // Only attach a range-backed dropdown when its reference sheet has rows:
    // an empty list would produce an inverted range ($B$2:$B$1) that Excel rejects.
    if (options.priorities.length) addList('priority', `Priorities!$B$2:$B$${options.priorities.length + 1}`)
    if (options.categories.length) addList('category', `Categories!$B$2:$B$${options.categories.length + 1}`)
    addColumnValidation(
      ws,
      letterOf('deadline_date'),
      LAST,
      dateValidation('greaterThanOrEqual', 'Enter a real date that is today or later (YYYY-MM-DD).'),
      'yyyy-mm-dd',
    )
    if (options.assignees.length) {
      const range = `Assignees!$E$2:$E$${options.assignees.length + 1}`
      for (const col of ASSIGNEE_COLUMNS) addList(col, range)
    }
    addList('completion_mode', '"any_can_complete,all_must_complete"')
    addList('proof_required', '"No,Yes"')
    if (options.goals.length) addList('linked_goal', `Goals!$B$2:$B$${options.goals.length + 1}`)
    if (options.checklist_templates.length) {
      addList('checklist_template', `'Checklist Templates'!$B$2:$B$${options.checklist_templates.length + 1}`)
    }
    addList('holiday_override', '"No,Yes"')
  }

  // ─── Views ────────────────────────────────────────────────────────────────────
  const renderPreview: NonNullable<TaskConfig['preview']>['render'] = (ctx) => {
    const v = ctx.validation
    if (!v) return null
    let visible = v.rows
    if (chipFilter === 'ready') visible = v.rows.filter((r) => r.status === 'ready')
    else if (chipFilter === 'error') visible = v.rows.filter((r) => r.status === 'error')
    else if (chipFilter === 'warning')
      visible = v.rows.filter((r) => r.status === 'ready' && r.issues.some((i) => i.severity === 'warning'))
    const notReady = v.rows.filter((r) => r.status !== 'ready').length

    const referenced = referencedAttachmentNames(ctx.rows)
    const missing = Array.from(referenced).filter((n) => !uploadedNameSet.has(n))

    const downloadFailures = () =>
      ctx.downloadReport(
        v.rows
          .filter((r) => r.status !== 'ready')
          .map((vr) => ({
            payload: ctx.rows[vr.row - 2] ?? {},
            status: taskFailureStatuses(vr).join(', '),
            reason: vr.issues.filter((i) => i.severity === 'error').map((i) => i.message).join('; '),
          })),
        'task-import-failures.xlsx',
      )

    return (
      <>
        <div className="flex items-center gap-2 flex-wrap">
          <FilterChip color="slate" label={`${v.total} total`} active={chipFilter === 'total'} onClick={() => setChipFilter('total')} />
          <FilterChip color="green" label={`${v.ready} ready`} active={chipFilter === 'ready'} onClick={() => setChipFilter('ready')} />
          {v.errors > 0 && (
            <FilterChip color="red" label={`${v.errors} error`} active={chipFilter === 'error'} onClick={() => setChipFilter('error')} />
          )}
          {v.warnings > 0 && (
            <FilterChip color="amber" label={`${v.warnings} warning`} active={chipFilter === 'warning'} onClick={() => setChipFilter('warning')} />
          )}
          <span className="ml-auto text-meta text-text-muted">from {ctx.fileName}</span>
        </div>

        <PreviewTable
          headers={['#', 'Status', 'Title', 'Assignees', 'Deadline', 'Issues']}
          maxHeightClass="max-h-[60vh]"
          textClass="text-body"
          empty={visible.length === 0}
        >
          {visible.map((r, i) => (
            <tr key={r.row} className={previewRowClass(r.status !== 'ready', i)}>
              <td className="px-3 py-2 text-text-muted">{ctx.excelRow(r.row)}</td>
              <td className="px-3 py-2">
                <StatusDot status={r.status} />
              </td>
              <td className="px-3 py-2">
                <div className="font-medium text-text-primary">{r.title || '—'}</div>
                {r.resolved.checklist_item_count ? (
                  <div className="text-text-muted">{plural(r.resolved.checklist_item_count, 'checklist item')}</div>
                ) : null}
                {r.resolved.tag_ids?.length ? <TagList tags={resolvedTags(r.resolved)} max={3} className="mt-1" /> : null}
              </td>
              <td className="px-3 py-2 text-text-secondary">
                {r.resolved.assignees?.length ? r.resolved.assignees.join(', ') : '—'}
                {r.resolved.cc?.length ? <span className="text-text-muted"> · CC {r.resolved.cc.length}</span> : null}
              </td>
              <td className="px-3 py-2 text-text-secondary">{r.resolved.deadline || '—'}</td>
              <td className="px-3 py-2">
                <IssueList issues={r.issues} />
              </td>
            </tr>
          ))}
        </PreviewTable>

        {/* Attachments: shared pool matched to rows by filename */}
        {referenced.size > 0 && (
          <div className="rounded-lg border border-border-light bg-surface p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Paperclip size={16} className="text-primary-text" />
              <p className="text-body font-medium text-text-primary">Attachments</p>
              <span className="text-meta text-text-secondary">
                {plural(referenced.size, 'file')} referenced · {referenced.size - missing.length} matched
              </span>
            </div>
            <p className="text-body text-text-secondary">
              Your sheet references files in the <strong>attachments</strong> column. Drop those exact files here — each is matched
              to its row by filename and uploaded to the created task.
            </p>
            <FileDropzone onFiles={(fs) => setAttachmentFiles((prev) => [...prev, ...fs])} onReject={setAttachErrors} disabled={ctx.importing} />
            {(attachErrors.length > 0 || attachmentFiles.length > 0) && (
              <div className="max-h-[180px] overflow-y-auto space-y-2">
                {attachErrors.length > 0 && <AttachmentErrorBox errors={attachErrors} onDismiss={() => setAttachErrors([])} />}
                {attachmentFiles.length > 0 && (
                  <PendingFileList files={attachmentFiles} onRemove={(idx) => setAttachmentFiles((prev) => prev.filter((_, i) => i !== idx))} />
                )}
              </div>
            )}
            {missing.length > 0 && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-warning-bg border border-warning-border">
                <AlertTriangle size={15} className="text-warning mt-0.5 shrink-0" />
                <p className="text-body text-warning">
                  {missing.length} referenced file{missing.length !== 1 ? 's are' : ' is'} not uploaded yet and will be skipped:{' '}
                  <strong>{missing.join(', ')}</strong>. The tasks still import.
                </p>
              </div>
            )}
          </div>
        )}

        <FixLoopBanner ready={v.ready} total={v.total} notReady={notReady} detailed={false} onDownload={downloadFailures} />
      </>
    )
  }

  const config: TaskConfig = {
    title: 'Import Tasks',
    columns: TASK_COLUMNS,
    parse: {
      headerRequired: ['title'],
      missingColumnsError: TASK_MISSING_COLUMNS,
      mapRow: mapTaskRow,
      sheetName: 'Tasks',
      dateMode: 'local',
    },
    template: { fileName: 'task-import-template.xlsx', build: buildTemplate },
    uploadIntro: (
      <p className="mt-0.5">
        Required columns (<span className="font-medium text-primary-text">blue header, marked *</span>): title, deadline_date,
        assignee_1. <strong>Priority</strong>, <strong>category</strong>, <strong>assignees</strong>, <strong>CC</strong>,{' '}
        <strong>escalation</strong>, <strong>goal</strong> and <strong>checklist template</strong> are <strong>dropdowns</strong>.
        The assignee / CC / escalation dropdowns only list people you’re allowed to assign to. Checklist items and attachment
        filenames are pipe-separated (<code>a | b | c</code>);
        <strong> tags</strong> are comma-separated (<code>a, b, c</code>) and each must match one on the template’s Tags sheet.
        The template’s <strong>second row spells out each column’s rule</strong> — it’s ignored on upload, so you can leave or
        delete it.
      </p>
    ),
    uploadStep2Label: 'Step 2 — Upload the filled file to review',
    historyButtonLabel: 'History',

    validate: (rows) => validateTaskImport(orgId, rows),
    preview: {
      fullPage: true,
      readyCount: (v) => v.ready,
      importLabel: (n) => `Import ${n} ready`,
      render: renderPreview,
      footerWarning: (v) => (
        <>
          Importing creates live tasks and notifies assignees. Only the <strong>{v.ready} ready</strong> row
          {v.ready !== 1 ? 's' : ''} import; the rest are skipped. A short-lived undo is available right after.
        </>
      ),
      confirm: {
        tone: 'primary',
        title: (v) => `Import ${plural(v.ready, 'task')}?`,
        description:
          'This creates live tasks and notifies each assignee. A guarded undo is available for a short window afterward (it can only remove tasks nobody has acted on yet).',
      },
    },

    commit: async (rows, fileName) => {
      const res = await commitTaskImport(orgId, rows, fileName)
      // Upload matched attachments to each created task (best-effort, sequential).
      let attachFailures = 0
      if (attachmentFiles.length > 0) {
        const byName = new Map(attachmentFiles.map((f) => [normName(f.name), f]))
        for (const r of res.results) {
          if (r.status !== 'created' || !r.task_id || !r.attachment_names?.length) continue
          for (const nm of r.attachment_names) {
            const file = byName.get(normName(nm))
            if (!file) continue
            try {
              await tasksApi.uploadTaskAttachment(orgId, r.task_id, file)
            } catch {
              attachFailures++
            }
          }
        }
      }
      if (res.created > 0) {
        toast[res.failed > 0 || attachFailures > 0 ? 'warning' : 'success'](
          `Imported ${plural(res.created, 'task')}` +
            (attachFailures > 0 ? ` — ${plural(attachFailures, 'attachment')} failed to upload` : ''),
        )
        onImported()
      } else {
        toast.error('No tasks were imported')
      }
      return { result: res }
    },
    commitErrorMode: 'toast',
    commitErrorFallback: 'Import failed. Please try again.',

    renderResult: (ctx) => {
      const result = ctx.result
      if (!result) return null
      const undo = ctx.undoResult
      const failed = result.results.filter((r) => r.status === 'failed')
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <SuccessTile label={`${result.created} created`} />
            {result.failed > 0 && <FailedTile label={`${result.failed} failed`} />}
          </div>

          {undo && (
            <div className="p-3.5 rounded-lg bg-surface-sunken border border-border-light text-body text-text-secondary">
              Undo removed <strong className="text-text-primary">{undo.undone}</strong> task{undo.undone !== 1 ? 's' : ''}.
              {undo.kept.length > 0 && (
                <>
                  {' '}
                  <strong className="text-text-primary">{undo.kept.length}</strong> kept because they’ve been acted on:
                  <ul className="mt-1.5 space-y-1">
                    {undo.kept.map((k, i) => (
                      <li key={i} className="text-text-secondary">
                        <strong className="text-text-primary">{k.title}</strong> — {k.reason}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {failed.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-body font-medium text-text-primary">Rows that didn’t import</p>
                <Button
                  size="sm"
                  onClick={() =>
                    ctx.downloadReport(
                      failed.map((r) => ({ payload: ctx.rows[r.row - 2] ?? {}, status: 'Failed', reason: r.error || 'Failed to import' })),
                      'task-import-fixes.xlsx',
                    )
                  }
                >
                  Download to fix
                </Button>
              </div>
              <div className="border border-border-light rounded-lg max-h-[280px] overflow-auto divide-y divide-surface-control-pressed">
                {failed.map((r) => (
                  <div key={r.row} className="px-3 py-2 text-body bg-danger-bg">
                    <span className="text-text-muted">Row {ctx.excelRow(r.row)}</span> ·{' '}
                    <span className="font-medium text-text-primary">{r.title || '—'}</span>
                    <div className="text-danger">{r.error}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.batch_id && result.created > 0 && !undo && (
            <UndoButton undoing={ctx.undoingId === result.batch_id} onClick={() => result.batch_id && ctx.requestUndo(result.batch_id)} />
          )}
        </div>
      )
    },

    history: {
      list: () => listTaskImportBatches(orgId),
      undo: (id) => undoTaskImport(orgId, id),
      detail: (id) => getTaskImportBatchDetail(orgId, id),
      undoToast: (res) => ({
        kind: res.kept.length > 0 ? 'warning' : 'success',
        message: res.undone > 0 ? `Removed ${plural(res.undone, 'imported task')}` : 'Nothing was removed',
      }),
      undoErrorFallback: 'Undo failed.',
      undoConfirm: {
        description: (
          <>
            This removes the tasks created by this import. Any task that has already been acted on — worked on, commented, or
            completed — is <strong>kept</strong> and listed afterward. This can’t be reversed.
          </>
        ),
      },
      render: (ctx) =>
        ctx.batches.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-surface-control flex items-center justify-center mb-3">
              <History size={20} className="text-text-muted" />
            </div>
            <p className="text-body font-medium text-text-primary">No imports yet</p>
            <p className="text-body text-text-secondary mt-1">Task imports you run will appear here.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {ctx.batches.map((b) => (
              <div key={b.id} className="flex items-center gap-3 p-3 rounded-lg border border-border-light hover:bg-surface-sunken transition-colors">
                <button onClick={() => ctx.openBatch(b.id, 'history')} className="flex-1 min-w-0 text-left">
                  <div className="flex items-center gap-2">
                    <p className="text-body font-medium text-text-primary truncate">{b.file_name || 'Task import'}</p>
                    <StatusBadge s={b.status} />
                  </div>
                  <p className="text-meta text-text-secondary mt-0.5">
                    {b.created_count} created{b.failed_count > 0 ? ` · ${b.failed_count} failed` : ''} · {b.remaining} present · by{' '}
                    {b.imported_by} · {formatDateTime(b.created_at)}
                  </p>
                </button>
                {b.can_undo && (
                  <UndoButton size="sm" label="Undo" className="shrink-0" undoing={ctx.undoingId === b.id} onClick={() => ctx.requestUndo(b.id)} />
                )}
              </div>
            ))}
          </div>
        ),
      renderDetail: (ctx) => {
        const detail = ctx.detail
        if (ctx.loadingDetail || !detail) {
          return (
            <div className="space-y-2 py-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          )
        }
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-success-bg text-success text-body font-medium border border-success-border">
                {detail.created_count} created
              </span>
              {detail.failed_count > 0 && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-danger-bg text-danger text-body font-medium border border-danger-border">
                  {detail.failed_count} failed
                </span>
              )}
              <span className="text-body text-text-secondary">{detail.remaining} still present</span>
              {detail.can_undo && (
                <UndoButton size="sm" label="Undo import" className="ml-auto" undoing={ctx.undoingId === detail.id} onClick={() => ctx.requestUndo(detail.id)} />
              )}
            </div>
            <div className="border border-border-light rounded-lg max-h-[52vh] overflow-auto divide-y divide-surface-control-pressed">
              {detail.rows.map((r) => (
                <div key={r.row} className={`px-3 py-2 text-body ${r.status === 'failed' ? 'bg-danger-bg' : 'bg-surface'}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-text-muted">Row {r.row}</span>
                    <span className="font-medium text-text-primary">{r.title || '—'}</span>
                    {r.status === 'created' ? (
                      <span
                        className={`ml-auto text-meta font-medium px-2 py-0.5 rounded-full border ${r.still_present ? 'bg-success-bg text-success border-success-border' : 'bg-surface-control text-text-secondary border-border-light'}`}
                      >
                        {r.still_present ? 'Present' : 'Removed'}
                      </span>
                    ) : (
                      <span className="ml-auto text-meta font-medium px-2 py-0.5 rounded-full border bg-danger-bg text-danger border-danger-border">
                        Failed
                      </span>
                    )}
                  </div>
                  {r.error && <div className="text-danger mt-0.5">{r.error}</div>}
                </div>
              ))}
            </div>
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
      embedded={embedded}
      report={{ colWidth: 20 }}
      templateGate={{
        loading: loadingOptions && !noOrg,
        loadingLabel: 'Loading options…',
        disabled: !options,
        error: noOrg ? 'No organization selected.' : optionsError,
        onRetry: loadOptions,
      }}
      onReset={() => {
        setAttachmentFiles([])
        setAttachErrors([])
      }}
    />
  )
}
