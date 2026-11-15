// Unit tests for the shared import helpers: CSV parsing, header normalisation, date text.
// Run: npm run test:unit (Node's own test runner, no framework installed).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { apiErrorMessage, norm, normalizeHeader, parseCsv, toYmdLocal, toYmdUtc, uniq } from '../csv'

describe('parseCsv', () => {
  it('splits plain rows and fields', () => {
    assert.deepEqual(parseCsv('a,b,c\n1,2,3'), [['a', 'b', 'c'], ['1', '2', '3']])
  })

  it('handles CRLF and a trailing newline without an extra row', () => {
    assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']])
  })

  it('keeps commas, newlines and escaped quotes inside quoted fields', () => {
    assert.deepEqual(parseCsv('name,note\n"Smith, J","line1\nline2"\n"say ""hi""",x'), [
      ['name', 'note'],
      ['Smith, J', 'line1\nline2'],
      ['say "hi"', 'x'],
    ])
  })

  it('strips a UTF-8 byte order mark', () => {
    assert.deepEqual(parseCsv('﻿name,email\nA,b@c.d'), [['name', 'email'], ['A', 'b@c.d']])
  })

  it('keeps empty fields and returns no rows for empty input', () => {
    assert.deepEqual(parseCsv('a,,c\n,,'), [['a', '', 'c'], ['', '', '']])
    assert.deepEqual(parseCsv(''), [])
  })

  it('reads a final row that has no newline', () => {
    assert.deepEqual(parseCsv('a\nb'), [['a'], ['b']])
  })
})

describe('normalizeHeader', () => {
  it('lower-cases, drops the required star and joins words with underscores', () => {
    assert.equal(normalizeHeader('Name *'), 'name')
    assert.equal(normalizeHeader('  Checklist Name * '), 'checklist_name')
    assert.equal(normalizeHeader('Date of Joining'), 'date_of_joining')
  })

  it('drops parenthesised hints and turns hyphens into underscores', () => {
    assert.equal(normalizeHeader('head (manager name)'), 'head')
    assert.equal(normalizeHeader('Is-Department-Head'), 'is_department_head')
    assert.equal(normalizeHeader('Parent Dept (optional)'), 'parent_dept')
  })

  it('leaves an already-normal header alone', () => {
    assert.equal(normalizeHeader('assignee_1'), 'assignee_1')
  })
})

describe('small helpers', () => {
  it('uniq drops blanks and duplicates, keeping the first', () => {
    assert.deepEqual(uniq(['a', '', ' ', 'b', 'a']), ['a', 'b'])
  })

  it('norm trims and lower-cases', () => {
    assert.equal(norm('  Sales Team '), 'sales team')
  })

  it('formats dates as YYYY-MM-DD', () => {
    assert.equal(toYmdUtc(new Date('2024-03-05T23:30:00Z')), '2024-03-05')
    assert.equal(toYmdLocal(new Date(2024, 2, 5, 23, 30)), '2024-03-05')
  })

  it('apiErrorMessage joins arrays, passes strings and falls back', () => {
    assert.equal(apiErrorMessage({ response: { data: { message: ['a', 'b'] } } }, 'x'), 'a, b')
    assert.equal(apiErrorMessage({ response: { data: { message: 'bad' } } }, 'x'), 'bad')
    assert.equal(apiErrorMessage(new Error('boom'), 'fallback'), 'fallback')
    assert.equal(apiErrorMessage(null, 'fallback'), 'fallback')
  })
})
