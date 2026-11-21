import { norm } from '../csv'
import type { ColumnSpec } from '../types'

export interface DepartmentImportRow {
  name: string
  parent: string
  head: string
  description: string
}

// Colour is intentionally NOT importable: every department is auto-assigned a
// distinct colour by the app (users can override it in-app afterwards).
export type DepartmentColumn = 'name' | 'parent_department' | 'head' | 'description'

export const DEPARTMENT_COLUMNS: readonly ColumnSpec<DepartmentColumn>[] = [
  { key: 'name', label: 'name *', required: true, aliases: ['department'] },
  { key: 'parent_department', label: 'parent_department', aliases: ['parent', 'parent_dept'] },
  { key: 'head', label: 'head (manager name)', aliases: ['head_user', 'dept_head', 'manager'] },
  { key: 'description', label: 'description' },
]

export const DEPARTMENT_MISSING_COLUMNS =
  'Could not find the required "name" column. Download the template to see the expected format.'

/** Header cells to payload row, exactly as the modal maps an uploaded sheet. */
export function mapDepartmentRow(get: (k: DepartmentColumn) => string): DepartmentImportRow {
  return {
    name: get('name'),
    parent: get('parent_department'),
    head: get('head'),
    description: get('description'),
  }
}

export interface DepartmentRowFailure {
  row: number
  label: string
  error: string
}

/**
 * First pass over the file: rows with a blank name or a name that already exists
 * (in the org, or earlier in the file) fail up front; the rest are `pending`.
 * `row` is the spreadsheet line (header is line 1).
 */
export function preflightDepartmentRows(rows: DepartmentImportRow[], existingNames: Iterable<string>) {
  const failures: DepartmentRowFailure[] = []
  const pending: { row: DepartmentImportRow; line: number }[] = []
  const seen = new Set<string>(existingNames)
  rows.forEach((row, i) => {
    const line = i + 2
    if (!row.name) {
      failures.push({ row: line, label: '(blank)', error: 'Name is required.' })
      return
    }
    if (seen.has(norm(row.name))) {
      failures.push({ row: line, label: row.name, error: 'A department with this name already exists.' })
      return
    }
    seen.add(norm(row.name))
    pending.push({ row, line })
  })
  return { failures, pending }
}

/** A row can be created once it has no parent, or its parent already exists. */
export function isDepartmentReady(row: DepartmentImportRow, knownNames: { has: (k: string) => boolean }): boolean {
  return !row.parent || knownNames.has(norm(row.parent))
}
