// Unit tests for each import's config: header aliases, row mapping, validators and the
// fixed failure vocabulary. Run: npm run test:unit
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { gridToRows, buildAliasMap } from '../parse'
import { failureStatuses } from '../failure'
import { parseCsv } from '../csv'
import {
  EMPLOYEE_COLUMNS,
  EMPLOYEE_MISSING_COLUMNS,
  employeeFailureStatusFromMessage,
  employeeFailureStatuses,
} from '../configs/employees'
import {
  GUIDE_MARKER,
  TASK_COLUMNS,
  TASK_MISSING_COLUMNS,
  deadlineIso,
  mapTaskRow,
  referencedAttachmentNames,
  taskFailureStatuses,
} from '../configs/tasks'
import { CHECKLIST_COLUMNS, CHECKLIST_MISSING_COLUMNS, mapChecklistRow } from '../configs/checklists'
import {
  DEPARTMENT_COLUMNS,
  DEPARTMENT_MISSING_COLUMNS,
  isDepartmentReady,
  mapDepartmentRow,
  preflightDepartmentRows,
} from '../configs/departments'
import {
  JOB_ROLE_COLUMNS,
  JOB_ROLE_MISSING_COLUMNS,
  checkJobRoleRow,
  mapJobRoleRow,
  type JobRoleImportRow,
} from '../configs/roles'
import { HOLIDAY_TYPES, holidayRowError, parseHolidayCsv } from '../configs/holidays'

describe('gridToRows (shared parsing)', () => {
  it('reports an empty file, a missing header column and no data rows', () => {
    const spec = { headerRequired: ['name' as const], missingColumnsError: 'MISSING' }
    const cols = [{ key: 'name' as const, label: 'name' }]
    assert.equal(gridToRows([], cols, spec).error, 'The file is empty.')
    assert.equal(gridToRows([['other']], cols, spec).error, 'MISSING')
    assert.equal(gridToRows([['name'], ['', '']], cols, spec).error, 'No data rows found below the header.')
  })

  it('skips blank rows and records the true spreadsheet row of each kept row', () => {
    const grid = [['title *', 'deadline_date'], ['A', '2030-01-01'], ['', ''], ['B', '2030-01-02']]
    const out = gridToRows(grid, TASK_COLUMNS, { headerRequired: ['title'], missingColumnsError: '', mapRow: mapTaskRow })
    assert.equal(out.rows.length, 2)
    assert.deepEqual(out.sourceRows, [2, 4])
  })

  it('uses the first of two columns that share an alias', () => {
    const grid = [['name', 'full_name', 'email'], ['First', 'Second', 'a@b.c']]
    const out = gridToRows(grid, EMPLOYEE_COLUMNS, { headerRequired: ['name', 'email'], missingColumnsError: '' })
    assert.equal(out.rows[0].name, 'First')
  })

  it('maps every column key to itself in the alias map', () => {
    const map = buildAliasMap(EMPLOYEE_COLUMNS)
    for (const c of EMPLOYEE_COLUMNS) assert.equal(map[c.key], c.key)
  })
})

describe('employees config', () => {
  const required = { headerRequired: ['name', 'email'] as ('name' | 'email')[], missingColumnsError: EMPLOYEE_MISSING_COLUMNS }

  it('has 13 columns with the blue (required) ones marked in the header', () => {
    assert.equal(EMPLOYEE_COLUMNS.length, 13)
    assert.deepEqual(
      EMPLOYEE_COLUMNS.filter((c) => c.required).map((c) => c.label),
      ['name *', 'email *', 'department *', 'role *', 'system_role *'],
    )
  })

  it('accepts the header aliases', () => {
    const grid = [['Full Name', 'Email *', 'Dept', 'Job Role', 'Access Role', 'Manager', 'Code', 'Is Head'], ['Jane', 'j@x.co', 'Sales', 'AE', 'Employee', 'Bob', 'E1', 'Yes']]
    const row = gridToRows(grid, EMPLOYEE_COLUMNS, required).rows[0]
    assert.equal(row.name, 'Jane')
    assert.equal(row.department, 'Sales')
    assert.equal(row.role, 'AE')
    assert.equal(row.system_role, 'Employee')
    assert.equal(row.reporting_to, 'Bob')
    assert.equal(row.employee_code, 'E1')
    assert.equal(row.is_department_head, 'Yes')
  })

  it('requires the name and email columns', () => {
    assert.equal(gridToRows([['name', 'dept'], ['a', 'b']], EMPLOYEE_COLUMNS, required).error, EMPLOYEE_MISSING_COLUMNS)
  })

  it('maps issues to the fixed failure vocabulary', () => {
    assert.deepEqual(
      employeeFailureStatuses({
        status: 'duplicate',
        issues: [
          { severity: 'error', message: 'x', field: 'date_of_birth' },
          { severity: 'error', message: 'y', field: 'marriage_date' },
          { severity: 'error', message: 'z', field: 'reporting_to' },
          { severity: 'warning', message: 'w', field: 'email' },
        ],
      }),
      ['Duplicate', 'Date', 'Manager'],
    )
    assert.deepEqual(employeeFailureStatuses({ status: 'error', issues: [] }), ['Other'])
    assert.deepEqual(employeeFailureStatuses({ status: 'error', issues: [{ severity: 'error', message: '', field: 'nope' }] }), ['Other'])
  })

  it('categorises commit messages', () => {
    assert.equal(employeeFailureStatusFromMessage('Email already exists'), 'Duplicate')
    assert.equal(employeeFailureStatusFromMessage('Unknown system role'), 'System Role')
    assert.equal(employeeFailureStatusFromMessage('Already a head for Sales'), 'Department Head')
    assert.equal(employeeFailureStatusFromMessage('Department not found'), 'Department')
    assert.equal(employeeFailureStatusFromMessage('Bad date of birth'), 'Date')
    assert.equal(employeeFailureStatusFromMessage('something odd'), 'Other')
  })
})

describe('tasks config', () => {
  const spec = { headerRequired: ['title' as const], missingColumnsError: TASK_MISSING_COLUMNS, mapRow: mapTaskRow }

  it('has 27 columns, three required', () => {
    assert.equal(TASK_COLUMNS.length, 27)
    assert.deepEqual(TASK_COLUMNS.filter((c) => c.required).map((c) => c.key), ['title', 'deadline_date', 'assignee_1'])
  })

  it('accepts the forgiving aliases', () => {
    const grid = [['Task', 'Desc', 'Due Date', 'Due Time', 'Assignee', 'CC', 'Goal', 'Checklist', 'Tag'], ['T', 'D', '2030-05-06', '09:30', 'Jane · Sales', 'Bob', 'G', 'a | b', 'x']]
    const row = gridToRows(grid, TASK_COLUMNS, spec).rows[0]
    assert.equal(row.title, 'T')
    assert.equal(row.description, 'D')
    assert.equal(row.deadline_date, '2030-05-06')
    assert.equal(row.deadline_time, '09:30')
    assert.equal(row.assignee_1, 'Jane · Sales')
    assert.equal(row.cc_1, 'Bob')
    assert.equal(row.linked_goal, 'G')
    assert.equal(row.checklist_items, 'a | b')
    assert.equal(row.tags, 'x')
  })

  it('skips the template guide row wherever it sits', () => {
    const grid = [['title', 'deadline_date'], [`${GUIDE_MARKER} Guide row`, 'rule'], ['Real', '2030-01-01']]
    const out = gridToRows(grid, TASK_COLUMNS, spec)
    assert.equal(out.rows.length, 1)
    assert.equal(out.rows[0].title, 'Real')
    assert.deepEqual(out.sourceRows, [3])
  })

  it('computes the local deadline instant, defaulting the time to 23:59', () => {
    assert.equal(deadlineIso('2030-05-06', '09:30'), new Date('2030-05-06T09:30').toISOString())
    assert.equal(deadlineIso('2030-05-06', ''), new Date('2030-05-06T23:59').toISOString())
    assert.equal(deadlineIso('2030-05-06', 'bad'), new Date('2030-05-06T23:59').toISOString())
    assert.equal(deadlineIso('06/05/2030', '09:30'), undefined)
    assert.equal(deadlineIso('', '09:30'), undefined)
    assert.equal(deadlineIso('2030-13-45', ''), undefined)
  })

  it('collects the referenced attachment filenames, deduped and lower-cased', () => {
    assert.deepEqual(
      Array.from(referencedAttachmentNames([{ attachments: 'A.pdf | b.png' }, { attachments: 'a.PDF\nc.doc' }, {}])).sort(),
      ['a.pdf', 'b.png', 'c.doc'],
    )
  })

  it('maps issue fields to failure categories (errors only)', () => {
    assert.deepEqual(
      taskFailureStatuses({
        issues: [
          { severity: 'error', message: '', field: 'assignee_2' },
          { severity: 'error', message: '', field: 'assignee_1' },
          { severity: 'error', message: '', field: 'deadline_time' },
          { severity: 'warning', message: '', field: 'title' },
        ],
      }),
      ['Assignee', 'Deadline'],
    )
  })
})

describe('checklists config', () => {
  const spec = { headerRequired: ['checklist_name', 'item'] as ('checklist_name' | 'item')[], missingColumnsError: CHECKLIST_MISSING_COLUMNS, mapRow: mapChecklistRow }

  it('accepts header aliases and maps each row', () => {
    const grid = [['Template Name *', 'Step'], ['Onboarding', 'Create account'], ['Onboarding', 'Send email']]
    assert.deepEqual(gridToRows(grid, CHECKLIST_COLUMNS, spec).rows, [
      { checklist_name: 'Onboarding', item: 'Create account' },
      { checklist_name: 'Onboarding', item: 'Send email' },
    ])
  })

  it('needs both columns', () => {
    assert.equal(gridToRows([['Checklist Name'], ['x']], CHECKLIST_COLUMNS, spec).error, CHECKLIST_MISSING_COLUMNS)
  })
})

describe('departments config', () => {
  const spec = { headerRequired: ['name' as const], missingColumnsError: DEPARTMENT_MISSING_COLUMNS, mapRow: mapDepartmentRow }

  it('maps aliases to the payload fields', () => {
    const grid = [['Department', 'Parent', 'Manager', 'description'], ['Mobile', 'Eng', 'Jane', 'Apps']]
    assert.deepEqual(gridToRows(grid, DEPARTMENT_COLUMNS, spec).rows, [{ name: 'Mobile', parent: 'Eng', head: 'Jane', description: 'Apps' }])
  })

  it('preflight fails blank names and duplicates (existing or earlier in the file)', () => {
    const rows = [
      { name: 'Eng', parent: '', head: '', description: '' },
      { name: '', parent: '', head: '', description: '' },
      { name: 'ops', parent: '', head: '', description: '' },
      { name: 'OPS ', parent: '', head: '', description: '' },
      { name: 'Eng', parent: '', head: '', description: '' },
    ]
    const { failures, pending } = preflightDepartmentRows(rows, ['eng'])
    assert.deepEqual(failures, [
      { row: 2, label: 'Eng', error: 'A department with this name already exists.' },
      { row: 3, label: '(blank)', error: 'Name is required.' },
      { row: 5, label: 'OPS ', error: 'A department with this name already exists.' },
      { row: 6, label: 'Eng', error: 'A department with this name already exists.' },
    ])
    assert.deepEqual(pending.map((p) => [p.line, p.row.name]), [[4, 'ops']])
  })

  it('a row is ready with no parent or once its parent exists', () => {
    const known = new Set(['eng'])
    assert.equal(isDepartmentReady({ name: 'a', parent: '', head: '', description: '' }, known), true)
    assert.equal(isDepartmentReady({ name: 'a', parent: ' ENG', head: '', description: '' }, known), true)
    assert.equal(isDepartmentReady({ name: 'a', parent: 'nope', head: '', description: '' }, known), false)
  })
})

describe('job roles config', () => {
  const spec = { headerRequired: ['title', 'department'] as ('title' | 'department')[], missingColumnsError: JOB_ROLE_MISSING_COLUMNS, mapRow: mapJobRoleRow }
  const depts = new Map([['sales', 'd1']])
  const row = (over: Partial<JobRoleImportRow>): JobRoleImportRow => ({ title: 'AE', department: 'Sales', level: '', job_description: '', ...over })

  it('maps aliases and requires title and department', () => {
    const grid = [['Role', 'Dept', 'Seniority', 'JD'], ['AE', 'Sales', 'senior', 'sell']]
    assert.deepEqual(gridToRows(grid, JOB_ROLE_COLUMNS, spec).rows, [{ title: 'AE', department: 'Sales', level: 'senior', job_description: 'sell' }])
    assert.equal(gridToRows([['title'], ['x']], JOB_ROLE_COLUMNS, spec).error, JOB_ROLE_MISSING_COLUMNS)
  })

  it('validates title, department and level in order', () => {
    assert.deepEqual(checkJobRoleRow(row({ title: '' }), depts), { ok: false, label: '(blank)', error: 'Title is required.' })
    assert.deepEqual(checkJobRoleRow(row({ department: '' }), depts), { ok: false, label: 'AE', error: 'Department is required.' })
    assert.deepEqual(checkJobRoleRow(row({ department: 'Ops' }), depts), { ok: false, label: 'AE', error: 'Department "Ops" was not found.' })
    assert.deepEqual(checkJobRoleRow(row({ level: 'boss' }), depts), {
      ok: false,
      label: 'AE',
      error: 'Invalid level "boss". Use one of: head, senior, mid, junior.',
    })
  })

  it('defaults a blank level to mid and accepts any case', () => {
    assert.deepEqual(checkJobRoleRow(row({}), depts), { ok: true, departmentId: 'd1', level: 'mid' })
    assert.deepEqual(checkJobRoleRow(row({ level: ' Senior ', department: ' SALES' }), depts), { ok: true, departmentId: 'd1', level: 'senior' })
  })
})

describe('holidays config', () => {
  it('reports the first problem in a fixed order', () => {
    assert.equal(holidayRowError('', '', 'national'), 'Name is required')
    assert.equal(holidayRowError('Diwali', '', 'national'), 'Date is required')
    assert.equal(holidayRowError('Diwali', '20/10/2025', 'national'), 'Date must be YYYY-MM-DD')
    assert.equal(holidayRowError('Diwali', '2025-13-40', 'national'), 'Date must be YYYY-MM-DD')
    assert.equal(holidayRowError('Diwali', '2025-10-20', 'bank'), `Type must be: ${HOLIDAY_TYPES.join(', ')}`)
    assert.equal(holidayRowError('Diwali', '2025-10-20', 'national'), undefined)
    assert.equal(holidayRowError('Diwali', '2025-10-20', ''), undefined)
  })

  it('parses the CSV, defaulting type and the recurring flag', () => {
    const csv = 'Name,Date,Type,Recurring Yearly,Description\nRepublic Day,2025-01-26,national,yes,"A day, off"\nTeam Day,2025-06-01,company,no,\nBad,nope,regional,yes,\n,,,,\n'
    const rows = parseHolidayCsv(csv)
    assert.equal(rows.length, 3)
    assert.deepEqual(rows[0], { name: 'Republic Day', date: '2025-01-26', type: 'national', is_recurring_yearly: true, description: 'A day, off', _error: undefined })
    assert.equal(rows[1].type, 'company')
    assert.equal(rows[1].is_recurring_yearly, false)
    assert.equal(rows[2]._error, 'Date must be YYYY-MM-DD')
  })

  it('falls back to national for an unknown type but still flags the row', () => {
    const [r] = parseHolidayCsv('name,date,type\nX,2025-01-01,bank')
    assert.equal(r.type, 'national')
    assert.equal(r._error, `Type must be: ${HOLIDAY_TYPES.join(', ')}`)
  })

  it('returns nothing without a data row, and the template file parses cleanly', () => {
    assert.deepEqual(parseHolidayCsv('Name,Date'), [])
    assert.deepEqual(parseHolidayCsv(''), [])
  })
})

describe('failureStatuses', () => {
  it('lists Duplicate first, de-duplicates labels and falls back to Other', () => {
    assert.deepEqual(failureStatuses([{ severity: 'error', message: '', field: 'a' }, { severity: 'error', message: '', field: 'b' }], { a: 'X', b: 'X' }, { duplicate: true }), ['Duplicate', 'X'])
    assert.deepEqual(failureStatuses([], {}), ['Other'])
    assert.deepEqual(failureStatuses([{ severity: 'error', message: '', field: null }], {}), ['Other'])
  })

  it('parseCsv output feeds gridToRows end to end', () => {
    const grid = parseCsv('name,email\n"Doe, Jane",jane@x.co')
    const out = gridToRows(grid, EMPLOYEE_COLUMNS, { headerRequired: ['name', 'email'], missingColumnsError: '' })
    assert.equal(out.rows[0].name, 'Doe, Jane')
  })
})
