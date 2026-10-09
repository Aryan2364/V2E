// Unit tests for the instance discussion helpers (@mentions, unread divider, merging).
// Run: npm run test:unit (Node's own test runner — no framework installed).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { DiscussionMessage } from '@/lib/types/workflows'
import {
  activeMentionIds,
  addMessage,
  countShown,
  fileSize,
  filterPeople,
  firstUnreadId,
  insertMention,
  mentionQuery,
  mergeMessages,
  messageTime,
  removeMessage,
  splitMentions,
  taggableSteps,
} from '../discussion'

const people = [
  { id: 'u1', name: 'Meena Patel' },
  { id: 'u2', name: 'Mehul Shah' },
  { id: 'u3', name: 'Ravi Kumar' },
  { id: 'u4', name: 'Amit Mehta' },
]

const msg = (id: string, over: Partial<DiscussionMessage> = {}): DiscussionMessage => ({
  id,
  body: id,
  author: { id: 'u1', name: 'Meena Patel' },
  created_at: '2026-10-08T10:00:00.000Z',
  task_id: null,
  reply_to_id: null,
  for_step: null,
  send_back: null,
  mentions: [],
  attachments: [],
  can_delete: false,
  deleted: false,
  replies: [],
  ...over,
})

describe('mentionQuery', () => {
  it('finds the "@…" being typed at the caret', () => {
    assert.deepEqual(mentionQuery('Hi @Me', 6), { start: 3, query: 'Me' })
    assert.deepEqual(mentionQuery('@', 1), { start: 0, query: '' })
    assert.deepEqual(mentionQuery('Thanks (@Ravi K', 15), { start: 8, query: 'Ravi K' })
  })
  it('ignores e-mail addresses, line breaks, double spaces and a caret before the "@"', () => {
    assert.equal(mentionQuery('mail a@b.com', 12), null)
    assert.equal(mentionQuery('@Meena\nnext', 11), null)
    assert.equal(mentionQuery('@Meena  x', 9), null)
    assert.equal(mentionQuery('@ x', 3), null)
    assert.equal(mentionQuery('Hi @Me', 2), null)
  })
})

describe('filterPeople', () => {
  it('ranks name starts, then word starts, then anywhere; skips people already picked', () => {
    assert.deepEqual(filterPeople(people, 'me').map((p) => p.id), ['u1', 'u2', 'u4'])
    assert.deepEqual(filterPeople(people, 'kum').map((p) => p.id), ['u3'])
    assert.deepEqual(filterPeople(people, 'me', ['u1']).map((p) => p.id), ['u2', 'u4'])
    assert.equal(filterPeople(people, '').length, 4)
    assert.equal(filterPeople(people, '', [], 2).length, 2)
  })
})

describe('insertMention / activeMentionIds', () => {
  it('replaces the typed query with "@Name " and puts the caret after it', () => {
    assert.deepEqual(insertMention('Hi @me please', 3, 6, 'Meena Patel'), { text: 'Hi @Meena Patel please', caret: 16 })
  })
  it('keeps only mentions still in the text', () => {
    const picked = [people[0], people[2]]
    assert.deepEqual(activeMentionIds('@Meena Patel can you check?', picked), ['u1'])
    assert.deepEqual(activeMentionIds('no one', picked), [])
  })
})

describe('splitMentions', () => {
  it('splits a message into text and mentions (longest names first)', () => {
    const segs = splitMentions('@Meena Patel and @Meena, see', [{ id: 'u1', name: 'Meena Patel' }, { id: 'u9', name: 'Meena' }])
    assert.deepEqual(
      segs.map((s) => [s.text, s.mention?.id ?? null]),
      [
        ['@Meena Patel', 'u1'],
        [' and ', null],
        ['@Meena', 'u9'],
        [', see', null],
      ],
    )
    assert.deepEqual(splitMentions('plain', []), [{ text: 'plain' }])
    assert.deepEqual(splitMentions('', people), [])
  })
})

describe('firstUnreadId', () => {
  const read = '2026-10-08T10:00:00.000Z'
  it('is the first message (or holder of a reply) by someone else after my marker', () => {
    const list = [
      msg('a', { created_at: '2026-10-08T09:00:00.000Z' }),
      msg('b', { created_at: '2026-10-08T09:30:00.000Z', replies: [msg('b1', { created_at: '2026-10-08T11:00:00.000Z' })] }),
      msg('c', { created_at: '2026-10-08T12:00:00.000Z' }),
    ]
    assert.equal(firstUnreadId(list, read, 'me'), 'b')
  })
  it('never counts my own or removed messages; never read = from the first one by others', () => {
    const mine = msg('m', { author: { id: 'me', name: 'Me' }, created_at: '2026-10-08T11:00:00.000Z' })
    assert.equal(firstUnreadId([mine], read, 'me'), null)
    assert.equal(firstUnreadId([msg('d', { deleted: true, author: null, created_at: '2026-10-08T11:00:00.000Z' })], read, 'me'), null)
    assert.equal(firstUnreadId([mine, msg('x')], null, 'me'), 'x')
  })
})

describe('merging and removing', () => {
  it('updates in place by id and keeps time order', () => {
    const shown = [msg('a', { created_at: '2026-10-08T09:00:00.000Z' }), msg('b', { created_at: '2026-10-08T10:00:00.000Z' })]
    const fresh = [msg('b', { body: 'edited', created_at: '2026-10-08T10:00:00.000Z' }), msg('c', { created_at: '2026-10-08T11:00:00.000Z' })]
    const out = mergeMessages(shown, fresh)
    assert.deepEqual(out.map((m) => [m.id, m.body]), [['a', 'a'], ['b', 'edited'], ['c', 'c']])
  })
  it('adds a reply under its top message', () => {
    const out = addMessage([msg('a')], msg('r', { reply_to_id: 'a' }))
    assert.deepEqual(out[0].replies.map((r) => r.id), ['r'])
  })
  it('a removed message with replies stays as a placeholder; a removed reply goes', () => {
    const list = [msg('a', { replies: [msg('r')] }), msg('b')]
    const out = removeMessage(list, 'a')
    assert.equal(out[0].deleted, true)
    assert.equal(out[0].body, '')
    assert.deepEqual(removeMessage(list, 'r')[0].replies, [])
    assert.deepEqual(removeMessage(list, 'b').map((m) => m.id), ['a'])
    assert.equal(countShown(list), 3)
    assert.equal(countShown(out), 2)
  })
})

describe('taggableSteps', () => {
  it('offers steps not done or skipped, never the step it is written on', () => {
    const steps = [
      { row_id: 'r1', title: 'Collect', status: 'completed', task_id: 't1' },
      { row_id: 'r2', title: 'Verify', status: 'active', task_id: 't2' },
      { row_id: 'r3', title: 'Issue PO', status: 'pending', task_id: null },
      { row_id: 'r4', title: 'Old', status: 'skipped', task_id: null },
    ]
    assert.deepEqual(taggableSteps(steps).map((s) => s.row_id), ['r2', 'r3'])
    assert.deepEqual(taggableSteps(steps, 't2').map((s) => s.row_id), ['r3'])
  })
})

describe('fileSize', () => {
  it('reads like a person would say it', () => {
    assert.equal(fileSize(500), '500 B')
    assert.equal(fileSize(12_300), '12 KB')
    assert.equal(fileSize(1_468_006), '1.4 MB')
  })
})

describe('messageTime', () => {
  const now = new Date(2026, 9, 8, 23, 30)
  it('time only today, day + time this year, with the year before', () => {
    assert.equal(messageTime(new Date(2026, 9, 8, 23, 11).toISOString(), now), '11:11 PM')
    assert.equal(messageTime(new Date(2026, 9, 7, 9, 5).toISOString(), now), '7 Oct, 9:05 AM')
    assert.equal(messageTime(new Date(2025, 0, 2, 12, 0).toISOString(), now), '2 Jan 2025, 12:00 PM')
    assert.equal(messageTime('nope', now), '')
  })
})
