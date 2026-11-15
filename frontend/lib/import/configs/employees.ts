import { failureStatuses } from '../failure'
import type { ColumnSpec, ImportIssue } from '../types'

/** Glue for combined dropdown values, e.g. "Backend Engineer · Backend". Must match the backend. */
export const VALUE_SEPARATOR = ' · '

export type EmployeeColumn =
  | 'name'
  | 'email'
  | 'password'
  | 'department'
  | 'is_department_head'
  | 'role'
  | 'system_role'
  | 'employment_type'
  | 'employee_code'
  | 'reporting_to'
  | 'date_of_joining'
  | 'date_of_birth'
  | 'marriage_date'

/** Template column order (A..M). */
export const EMPLOYEE_COLUMNS: readonly ColumnSpec<EmployeeColumn>[] = [
  { key: 'name', label: 'name *', required: true, aliases: ['full_name'] },
  { key: 'email', label: 'email *', required: true },
  { key: 'password', label: 'password' },
  { key: 'department', label: 'department *', required: true, aliases: ['dept'] },
  {
    key: 'is_department_head',
    label: 'is_department_head',
    aliases: ['is_head', 'head_of_department', 'dept_head', 'department_head'],
  },
  { key: 'role', label: 'role *', required: true, aliases: ['job_role'] },
  { key: 'system_role', label: 'system_role *', required: true, aliases: ['access_role'] },
  { key: 'employment_type', label: 'employment_type' },
  { key: 'employee_code', label: 'employee_code', aliases: ['code'] },
  { key: 'reporting_to', label: 'reporting_to', aliases: ['reports_to', 'manager'] },
  { key: 'date_of_joining', label: 'date_of_joining' },
  { key: 'date_of_birth', label: 'date_of_birth' },
  { key: 'marriage_date', label: 'marriage_date' },
]

export const EMPLOYEE_MISSING_COLUMNS =
  'Could not find the required "name" and "email" columns. Download the template to see the expected format.'

/**
 * Fixed vocabulary for the exported "failure_status" column. The same categories
 * are used for every file so the column is reliably sortable/filterable in Excel,
 * never a new label invented per import.
 */
export const EMPLOYEE_FIELD_FAILURE_LABEL: Record<string, string> = {
  name: 'Name',
  email: 'Email',
  password: 'Password',
  department: 'Department',
  is_department_head: 'Department Head',
  role: 'Role',
  system_role: 'System Role',
  employment_type: 'Employment Type',
  employee_code: 'Employee Code',
  reporting_to: 'Manager',
  date_of_joining: 'Date',
  date_of_birth: 'Date',
  marriage_date: 'Date',
}

/** Categorise a validation row's blocking problems into the fixed vocabulary. */
export function employeeFailureStatuses(row: { status: string; issues: readonly ImportIssue[] }): string[] {
  return failureStatuses(row.issues, EMPLOYEE_FIELD_FAILURE_LABEL, { duplicate: row.status === 'duplicate' })
}

/** Best-effort category when only a commit/undo error message is available. */
export function employeeFailureStatusFromMessage(msg: string): string {
  const m = msg.toLowerCase()
  if (m.includes('already exists') || m.includes('already a member') || m.includes('duplicate')) return 'Duplicate'
  if (m.includes('system role')) return 'System Role'
  if (m.includes('department head') || m.includes('head for') || m.includes('head of')) return 'Department Head'
  if (m.includes('department')) return 'Department'
  if (m.includes('role')) return 'Role'
  if (m.includes('manager') || m.includes('report')) return 'Manager'
  if (m.includes('email')) return 'Email'
  if (m.includes('employment')) return 'Employment Type'
  if (m.includes('code')) return 'Employee Code'
  if (m.includes('date') || m.includes('birth') || m.includes('joining') || m.includes('marriage')) return 'Date'
  if (m.includes('password')) return 'Password'
  if (m.includes('name')) return 'Name'
  return 'Other'
}

export const REMOVED_BY_UNDO_REASON = 'Removed by undo — re-upload this row to re-create the employee'
