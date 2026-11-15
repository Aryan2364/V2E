import test from 'node:test'
import assert from 'node:assert/strict'
import { canDeleteTask, derivePhoneActions, deriveTaskFlags } from '../detail-rules'
import type { Task } from '@/lib/types/tasks'

const NOW = new Date('2026-11-16T10:00:00Z')

function makeTask(over: Record<string, unknown> = {}): Task {
  return {
    id: 't1',
    created_at: '2026-11-01T10:00:00Z',
    created_by_user_id: 'boss',
    completion_mode: 'any_can_complete',
    status: { id: 's1', type: 'in_progress', label: 'In progress', color: '#000' },
    assignees: [
      { id: 'a1', user_id: 'me', is_cc: false, is_completed: false },
      { id: 'a2', user_id: 'other', is_cc: false, is_completed: true },
      { id: 'a3', user_id: 'cc', is_cc: true },
    ],
    ...over,
  } as unknown as Task
}

function flags(task: Task, userId: string, isAdmin = false, now = NOW) {
  return deriveTaskFlags({ task, userId, isAdmin, now })
}

test('assignee on an open task: not owner, may move shared status', () => {
  const f = flags(makeTask(), 'me')
  assert.equal(f.isAssignee, true)
  assert.equal(f.canEdit, false)
  assert.equal(f.canMoveSharedStatus, true)
  assert.equal(f.canManageCc, true)
  assert.equal(f.canEditRoster, false)
  assert.deepEqual(f.pendingNames, ['Someone'])
  assert.equal(f.completedCount, 1)
  assert.equal(f.totalAssignees, 2)
})

test('creator may edit and reassign; admin too', () => {
  assert.equal(flags(makeTask(), 'boss').canEdit, true)
  assert.equal(flags(makeTask(), 'boss').canEditRoster, true)
  assert.equal(flags(makeTask(), 'nobody', true).canEdit, true)
  assert.equal(flags(makeTask(), 'nobody').canEdit, false)
})

test('a simulated-future task is read-only for everyone', () => {
  const f = flags(makeTask({ created_at: '2026-12-01T00:00:00Z' }), 'boss')
  assert.equal(f.isFutureTask, true)
  assert.equal(f.canEdit, false)
  assert.equal(f.canManageCc, false)
  assert.equal(f.isAssignee, false)
})

test('a closed task freezes CC and roster edits', () => {
  const f = flags(makeTask({ status: { id: 's2', type: 'completed', label: 'Done', color: '#0f0' } }), 'boss')
  assert.equal(f.isTaskTerminal, true)
  assert.equal(f.canManageCc, false)
  assert.equal(f.canEditRoster, false)
})

test('CC person can manage CC but not complete', () => {
  const f = flags(makeTask(), 'cc')
  assert.equal(f.currentUserIsCC, true)
  assert.equal(f.canManageCc, true)
  assert.equal(f.isAssignee, false)
})

test('all_must_complete counts blocked and pending parts', () => {
  const task = makeTask({
    completion_mode: 'all_must_complete',
    assignees: [
      { id: 'a1', user_id: 'me', is_cc: false, is_completed: false, cannot_complete: true },
      { id: 'a2', user_id: 'x', is_cc: false, is_completed: true },
      { id: 'a3', user_id: 'y', is_cc: false, is_completed: false },
    ],
  })
  const f = flags(task, 'boss')
  assert.equal(f.blockedCount, 1)
  assert.equal(f.completedCount, 1)
  assert.equal(f.pendingCount, 1)
})

test('canDeleteTask: admin, org opt-in, unknown while loading', () => {
  assert.equal(canDeleteTask(true, undefined), true)
  assert.equal(canDeleteTask(false, undefined), undefined)
  assert.equal(canDeleteTask(false, null), false)
  assert.equal(canDeleteTask(false, { task_delete_roles: ['employee'] } as never), true)
  assert.equal(canDeleteTask(false, { task_delete_roles: ['manager'] } as never), false)
})

test('phone: reopen is direct inside the undo window, reason after, none for others', () => {
  const closed = makeTask({ status: { id: 's2', type: 'completed', label: 'Done', color: '#0f0' } })
  const mine = (userId: string, windowOpen: boolean, isAdmin = false) =>
    derivePhoneActions({ task: closed, flags: flags(closed, userId, isAdmin), isAdmin, windowOpen }).reopenKind
  assert.equal(mine('me', true), 'direct')
  assert.equal(mine('me', false), null)
  assert.equal(mine('boss', false), 'reason')
  assert.equal(mine('nobody', false, true), 'reason')
  assert.equal(mine('stranger', true), null)
})

test('phone: owner override and status gates in all_must_complete', () => {
  const task = makeTask({
    completion_mode: 'all_must_complete',
    assignees: [
      { id: 'a1', user_id: 'me', is_cc: false, is_completed: false },
      { id: 'a2', user_id: 'x', is_cc: false, is_completed: false },
    ],
  })
  const owner = derivePhoneActions({ task, flags: flags(task, 'boss'), isAdmin: false, windowOpen: false })
  assert.equal(owner.canCompleteForAll, true)
  assert.equal(owner.canChangeMode, true)
  assert.equal(owner.canChangeStatus, false)
  const me = derivePhoneActions({ task, flags: flags(task, 'me'), isAdmin: false, windowOpen: false })
  assert.equal(me.statusMine, true)
  assert.equal(me.canChangeStatus, true)
  assert.equal(me.canCantComplete, true)
  assert.equal(me.myPartDone, false)
})
