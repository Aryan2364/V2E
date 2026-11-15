import { norm } from '../csv'
import type { ColumnSpec } from '../types'

export type JobRoleLevel = 'head' | 'senior' | 'mid' | 'junior'

export interface JobRoleImportRow {
  title: string
  department: string
  level: string
  job_description: string
}

export type JobRoleColumn = 'title' | 'department' | 'level' | 'job_description'

export const JOB_ROLE_COLUMNS: readonly ColumnSpec<JobRoleColumn>[] = [
  { key: 'title', label: 'title *', required: true, aliases: ['role', 'job_role', 'name'] },
  { key: 'department', label: 'department *', required: true, aliases: ['dept'] },
  { key: 'level', label: 'level', aliases: ['seniority'] },
  { key: 'job_description', label: 'job_description', aliases: ['description', 'jd'] },
]

export const JOB_ROLE_LEVELS: JobRoleLevel[] = ['head', 'senior', 'mid', 'junior']

export const JOB_ROLE_MISSING_COLUMNS =
  'Could not find the required "title" and "department" columns. Download the template to see the expected format.'

export function mapJobRoleRow(get: (k: JobRoleColumn) => string): JobRoleImportRow {
  return {
    title: get('title'),
    department: get('department'),
    level: get('level'),
    job_description: get('job_description'),
  }
}

export type JobRoleRowCheck =
  | { ok: true; departmentId: string; level: JobRoleLevel }
  | { ok: false; label: string; error: string }

/** The row's own validation: title, department lookup and level (blank means mid). */
export function checkJobRoleRow(row: JobRoleImportRow, deptByName: ReadonlyMap<string, string>): JobRoleRowCheck {
  if (!row.title) return { ok: false, label: '(blank)', error: 'Title is required.' }
  const departmentId = deptByName.get(norm(row.department))
  if (!departmentId) {
    return {
      ok: false,
      label: row.title,
      error: row.department ? `Department "${row.department}" was not found.` : 'Department is required.',
    }
  }
  const lvl = norm(row.level)
  if (!lvl) return { ok: true, departmentId, level: 'mid' }
  if ((JOB_ROLE_LEVELS as string[]).includes(lvl)) return { ok: true, departmentId, level: lvl as JobRoleLevel }
  return {
    ok: false,
    label: row.title,
    error: `Invalid level "${row.level}". Use one of: ${JOB_ROLE_LEVELS.join(', ')}.`,
  }
}
