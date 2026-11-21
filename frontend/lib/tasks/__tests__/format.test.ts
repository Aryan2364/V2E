import test from 'node:test'
import assert from 'node:assert/strict'
import { avatarColor, deadlineColor, formatCountdown, getInitials, namesSummary, secondsUntil } from '../format'

test('getInitials takes up to two capitals', () => {
  assert.equal(getInitials('Aryan Shah'), 'AS')
  assert.equal(getInitials('priya'), 'P')
  assert.equal(getInitials('A B C'), 'AB')
  assert.equal(getInitials(''), '')
})

test('avatarColor is stable and falls back for empty names', () => {
  assert.equal(avatarColor(''), 'bg-primary')
  assert.equal(avatarColor('Aryan'), avatarColor('Aryan'))
  assert.match(avatarColor('Someone'), /^bg-/)
})

test('formatCountdown', () => {
  assert.equal(formatCountdown(0), '')
  assert.equal(formatCountdown(-3), '')
  assert.equal(formatCountdown(40), '40s')
  assert.equal(formatCountdown(125), '2m 5s')
})

test('deadlineColor: overdue, today, later, none', () => {
  const now = new Date(2026, 10, 16, 15, 0, 0)
  assert.equal(deadlineColor(undefined, now), 'text-text-secondary')
  assert.equal(deadlineColor(new Date(2026, 10, 15, 23, 0).toISOString(), now), 'text-danger font-medium')
  assert.equal(deadlineColor(new Date(2026, 10, 16, 9, 0).toISOString(), now), 'text-warning font-medium')
  assert.equal(deadlineColor(new Date(2026, 10, 17, 9, 0).toISOString(), now), 'text-text-secondary')
})

test('secondsUntil never goes negative', () => {
  const now = new Date('2026-11-16T10:00:00Z')
  assert.equal(secondsUntil('2026-11-16T10:01:30Z', now), 90)
  assert.equal(secondsUntil('2026-11-16T09:00:00Z', now), 0)
})

test('namesSummary shows three then a count', () => {
  assert.equal(namesSummary(['A', 'B']), 'A, B')
  assert.equal(namesSummary(['A', 'B', 'C', 'D', 'E']), 'A, B, C +2 more')
})
