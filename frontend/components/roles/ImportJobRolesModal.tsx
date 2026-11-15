'use client'

import { toast } from '@/components/ui/sonner'
import BulkImportWizard from '@/components/import/BulkImportWizard'
import {
  SimpleResultView,
  simpleHistoryRender,
  type SimpleBatch,
  type SimpleResult,
  type SimpleRowResult,
  type SimpleUndo,
} from '@/components/import/simpleViews'
import { createRole, listImportBatches, createImportBatch, undoImport } from '@/lib/api/roles'
import { apiErrorMessage, norm, uniq } from '@/lib/import/csv'
import { addColumnValidation, columnLetter, listValidation, writeColumnHeader } from '@/lib/import/xlsx'
import {
  JOB_ROLE_COLUMNS,
  JOB_ROLE_LEVELS,
  JOB_ROLE_MISSING_COLUMNS,
  checkJobRoleRow,
  mapJobRoleRow,
  type JobRoleColumn,
  type JobRoleImportRow,
} from '@/lib/import/configs/roles'
import type { ImportConfig } from '@/lib/import/types'
import type { Department } from '@/lib/types'

interface Props {
  orgId: string
  departments: Department[]
  onClose: () => void
  onImported: () => void
}

type JobRoleConfig = ImportConfig<JobRoleColumn, JobRoleImportRow, never, SimpleResult, SimpleBatch, SimpleBatch, SimpleUndo>

export default function ImportJobRolesModal({ orgId, departments, onClose, onImported }: Props) {
  async function commit(rows: JobRoleImportRow[], fileName: string) {
    const deptByName = new Map(departments.map((d) => [norm(d.name), d.id]))
    const results: SimpleRowResult[] = []

    const createdRoleIds: string[] = []
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const line = i + 2 // header is line 1
      const check = checkJobRoleRow(row, deptByName)
      if (!check.ok) {
        results.push({ row: line, label: check.label, status: 'failed', error: check.error })
        continue
      }
      try {
        const created = await createRole(orgId, {
          department_id: check.departmentId,
          title: row.title,
          level: check.level,
          job_description: row.job_description || undefined,
        })
        createdRoleIds.push(created.id)
        results.push({ row: line, label: row.title, status: 'created' })
      } catch (err) {
        results.push({
          row: line,
          label: row.title,
          status: 'failed',
          error: apiErrorMessage(err, 'Could not create this job role.'),
        })
      }
    }

    const created = results.filter((r) => r.status === 'created').length
    const failed = results.length - created

    if (created > 0) {
      try {
        await createImportBatch(orgId, {
          file_name: fileName || undefined,
          total_rows: rows.length,
          created_count: created,
          failed_count: failed,
          role_ids: results
            .filter((r) => r.status === 'created')
            // Match with standard createRole return ids
            .map((_, i) => createdRoleIds[i])
            .filter(Boolean),
        })
      } catch (e) {
        console.error('Failed to create import batch record', e)
      }
    }

    if (created > 0) {
      const importedMsg = `Imported ${created} job role${created !== 1 ? 's' : ''}`
      if (failed > 0) toast.warning(importedMsg)
      else toast.success(importedMsg)
      onImported()
    } else {
      toast.error('No job roles were imported')
    }
    return { result: { created, failed, results } }
  }

  const config: JobRoleConfig = {
    title: 'Import Job Roles',
    columns: JOB_ROLE_COLUMNS,
    parse: {
      headerRequired: ['title', 'department'],
      missingColumnsError: JOB_ROLE_MISSING_COLUMNS,
      mapRow: mapJobRoleRow,
      dateMode: 'none',
    },
    template: {
      fileName: 'job-role-import-template.xlsx',
      build: (wb) => {
        const ws = wb.addWorksheet('Job Roles')
        const lists = wb.addWorksheet('Lists')
        lists.state = 'veryHidden'

        const deptNames = uniq(departments.map((d) => d.name))
        deptNames.forEach((v, i) => (lists.getCell(i + 1, 1).value = v)) // col A
        JOB_ROLE_LEVELS.forEach((v, i) => (lists.getCell(i + 1, 2).value = v)) // col B

        writeColumnHeader(ws, JOB_ROLE_COLUMNS, 28)
        const sampleDept = departments[0]?.name ?? 'Engineering'
        ws.addRow(['Senior Engineer', sampleDept, 'senior', 'Owns delivery of core services'])
        ws.addRow(['Engineer', sampleDept, 'mid', ''])

        addColumnValidation(ws, columnLetter(1), 300, listValidation(`Lists!$A$1:$A$${Math.max(deptNames.length, 1)}`))
        addColumnValidation(ws, columnLetter(2), 300, listValidation(`Lists!$B$1:$B$${JOB_ROLE_LEVELS.length}`))
      },
    },
    uploadIntro: (
      <p className="mt-0.5">
        Required columns (<span className="font-medium text-primary-text">blue header, marked&nbsp;*</span>): title and
        department. The <strong>department</strong> and <strong>level</strong> columns are <strong>dropdowns</strong>. Level
        defaults to <strong>mid</strong> when left blank.
      </p>
    ),
    uploadStep2Label: 'Step 2 — Upload the filled file',
    historyButtonLabel: 'Import History',
    directNoun: 'job role',
    commit,
    commitErrorMode: 'inline',
    commitErrorFallback: 'Import failed. Please try again.',
    renderResult: (ctx) =>
      ctx.result && (
        <SimpleResultView
          result={ctx.result}
          note={
            <>
              KRAs and KPIs aren&apos;t part of the import — open a job role and use{' '}
              <span className="font-medium text-text-primary">Edit</span> to add them.
            </>
          }
        />
      ),
    history: {
      list: () => listImportBatches(orgId),
      undo: (id) => undoImport(orgId, id),
      undoToast: () => ({ kind: 'success', message: 'Import undone successfully' }),
      undoErrorFallback: 'Could not undo this import',
      render: simpleHistoryRender('job role'),
    },
  }

  return <BulkImportWizard config={config} onClose={onClose} onChanged={onImported} />
}
