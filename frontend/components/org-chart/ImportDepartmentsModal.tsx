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
import { createDepartment, listImportBatches, createImportBatch, undoImport } from '@/lib/api/departments'
import { placeUnderParent } from '@/lib/org-chart-layout'
import { apiErrorMessage, norm, uniq } from '@/lib/import/csv'
import { addColumnValidation, columnLetter, listValidation, writeColumnHeader } from '@/lib/import/xlsx'
import {
  DEPARTMENT_COLUMNS,
  DEPARTMENT_MISSING_COLUMNS,
  isDepartmentReady,
  mapDepartmentRow,
  preflightDepartmentRows,
  type DepartmentColumn,
  type DepartmentImportRow,
} from '@/lib/import/configs/departments'
import type { ImportConfig } from '@/lib/import/types'
import type { Department, User } from '@/lib/types'

interface Props {
  orgId: string
  departments: Department[]
  users: User[]
  onClose: () => void
  onImported: () => void
}

type DepartmentConfig = ImportConfig<
  DepartmentColumn,
  DepartmentImportRow,
  never,
  SimpleResult,
  SimpleBatch,
  SimpleBatch,
  SimpleUndo
>

export default function ImportDepartmentsModal({ orgId, departments, users, onClose, onImported }: Props) {
  // Topological import: create parents before children.
  async function commit(rows: DepartmentImportRow[], fileName: string) {
    // Resolve heads by name; track department names → id as we create them.
    const userByName = new Map(users.map((u) => [norm(u.name), u.id]))
    const nameToId = new Map(departments.map((d) => [norm(d.name), d.id]))
    // A mutable working copy so placeUnderParent offsets new siblings correctly.
    const working: Department[] = departments.map((d) => ({ ...d }))

    const results: SimpleRowResult[] = []
    // Blank names and within-file duplicates fail up front.
    const { failures, pending } = preflightDepartmentRows(rows, nameToId.keys())
    for (const f of failures) results.push({ row: f.row, label: f.label, status: 'failed', error: f.error })

    // Create in waves: a row is ready when it has no parent, or its parent already exists.
    let remaining = pending
    while (remaining.length > 0) {
      const ready = remaining.filter(({ row }) => isDepartmentReady(row, nameToId))
      if (ready.length === 0) break // remaining rows have unresolved/cyclic parents
      const next = remaining.filter((p) => !ready.includes(p))

      for (const { row, line } of ready) {
        const parentId = row.parent ? nameToId.get(norm(row.parent)) : undefined
        const headId = row.head ? userByName.get(norm(row.head)) : undefined
        if (row.head && !headId) {
          results.push({ row: line, label: row.name, status: 'failed', error: `No member named "${row.head}" to set as head.` })
          continue
        }
        const { x, y } = placeUnderParent(working, parentId)
        try {
          // No colour on import — the app auto-assigns a distinct one per dept.
          const created = await createDepartment(orgId, {
            name: row.name,
            description: row.description || undefined,
            parent_department_id: parentId,
            head_user_id: headId,
            position_x: x,
            position_y: y,
          })
          nameToId.set(norm(row.name), created.id)
          working.push({ ...(created as Department), position_x: x, position_y: y })
          results.push({ row: line, label: row.name, status: 'created' })
        } catch (err) {
          results.push({
            row: line,
            label: row.name,
            status: 'failed',
            error: apiErrorMessage(err, 'Could not create this department.'),
          })
        }
      }
      remaining = next
    }
    // Anything still remaining is an unresolved parent reference.
    for (const { row, line } of remaining) {
      results.push({ row: line, label: row.name, status: 'failed', error: `Parent department "${row.parent}" was not found.` })
    }

    results.sort((a, b) => a.row - b.row)
    const created = results.filter((r) => r.status === 'created').length
    const failed = results.length - created

    const createdDeptIds = results
      .filter((r) => r.status === 'created')
      .map((r) => nameToId.get(norm(r.label)))
      .filter((id): id is string => !!id)

    if (createdDeptIds.length > 0) {
      try {
        await createImportBatch(orgId, {
          file_name: fileName || undefined,
          total_rows: rows.length,
          created_count: created,
          failed_count: failed,
          department_ids: createdDeptIds,
        })
      } catch (e) {
        console.error('Failed to create import batch record', e)
      }
    }

    if (created > 0) {
      const message = `Imported ${created} department${created !== 1 ? 's' : ''}`
      if (failed > 0) toast.warning(message)
      else toast.success(message)
      onImported()
    } else {
      toast.error('No departments were imported')
    }
    return { result: { created, failed, results } }
  }

  const config: DepartmentConfig = {
    title: 'Import Departments',
    columns: DEPARTMENT_COLUMNS,
    parse: {
      headerRequired: ['name'],
      missingColumnsError: DEPARTMENT_MISSING_COLUMNS,
      mapRow: mapDepartmentRow,
      dateMode: 'none',
    },
    template: {
      fileName: 'department-import-template.xlsx',
      build: (wb) => {
        const ws = wb.addWorksheet('Departments')
        const lists = wb.addWorksheet('Lists')
        lists.state = 'veryHidden'

        const deptNames = uniq(departments.map((d) => d.name))
        const people = uniq(users.map((u) => u.name))
        deptNames.forEach((v, i) => (lists.getCell(i + 1, 1).value = v)) // col A
        people.forEach((v, i) => (lists.getCell(i + 1, 2).value = v)) // col B

        writeColumnHeader(ws, DEPARTMENT_COLUMNS, 26)
        ws.addRow(['Engineering', departments[0]?.name ?? 'Executive', users[0]?.name ?? '', 'Builds the product'])
        ws.addRow(['Mobile Apps', 'Engineering', '', 'iOS & Android'])

        // Parents may reference other new rows, so the dropdowns don't hard-block.
        addColumnValidation(ws, columnLetter(1), 300, listValidation(`Lists!$A$1:$A$${Math.max(deptNames.length, 1)}`, false))
        addColumnValidation(ws, columnLetter(2), 300, listValidation(`Lists!$B$1:$B$${Math.max(people.length, 1)}`, false))
      },
    },
    uploadIntro: (
      <p className="mt-0.5">
        Only <span className="font-medium text-primary-text">name</span> is required. The <strong>parent_department</strong> and{' '}
        <strong>head</strong> columns are dropdowns from your org. You can reference a parent that is{' '}
        <strong>also being imported</strong> — rows are created parents-first automatically.
      </p>
    ),
    uploadStep2Label: 'Step 2 — Upload the filled file',
    historyButtonLabel: 'Import History',
    directNoun: 'department',
    commit,
    commitErrorMode: 'inline',
    commitErrorFallback: 'Import failed. Please try again.',
    renderResult: (ctx) =>
      ctx.result && (
        <SimpleResultView
          result={ctx.result}
          note={
            <>
              Imported departments are placed under their parent on the chart. Press{' '}
              <span className="font-medium text-text-primary">Auto-arrange</span> in the tree view to tidy the whole structure.
            </>
          }
        />
      ),
    history: {
      list: () => listImportBatches(orgId),
      undo: (id) => undoImport(orgId, id),
      undoToast: () => ({ kind: 'success', message: 'Import undone successfully' }),
      undoErrorFallback: 'Could not undo this import',
      render: simpleHistoryRender('department'),
    },
  }

  return <BulkImportWizard config={config} onClose={onClose} onChanged={onImported} />
}
