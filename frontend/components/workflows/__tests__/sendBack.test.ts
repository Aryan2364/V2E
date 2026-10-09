// Unit tests for the send-back wording (reason, lead-in, shortening).
// Run: npm run test:unit (Node's own test runner — no framework installed).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { StepSendBack } from '@/lib/types/workflows'
import { REASON_SHORT_LIMIT, isLongReason, sendBackLead, sendBackReason, shortReason } from '../sendBack'

const NOW = new Date(2026, 9, 20, 12, 0)
const AT = new Date(2026, 9, 17, 17, 41).toISOString()

const sender = (over: Partial<Extract<StepSendBack, { role: 'sender' }>> = {}): StepSendBack => ({
  role: 'sender',
  reason: 'PAN and Aadhaar names differ',
  by: { id: 'u1', name: 'Priya' },
  at: AT,
  to_row_id: 'r1',
  to_label: '1 “Collect documents”',
  ...over,
})
const target = (over: Partial<Extract<StepSendBack, { role: 'target' }>> = {}): StepSendBack => ({
  role: 'target',
  reason: 'PAN and Aadhaar names differ',
  by: { id: 'u1', name: 'Priya' },
  at: AT,
  from_row_id: 'r3',
  from_label: '3 “Review”',
  ...over,
})

describe('sendBackLead', () => {
  it('sender: where it went, who sent it and when', () => {
    assert.equal(sendBackLead(sender(), NOW), 'Sent back to 1 “Collect documents” by Priya · 17 Oct')
    assert.equal(sendBackLead(sender({ by: null, at: null }), NOW), 'Sent back to 1 “Collect documents”')
    assert.equal(sendBackLead(sender({ at: new Date(2025, 11, 30).toISOString() }), NOW), 'Sent back to 1 “Collect documents” by Priya · 30 Dec 2025')
  })
  it('target: who asked for more info (instance page) / sent it back (task banner)', () => {
    assert.equal(sendBackLead(target(), NOW), 'Asked for more info by 3 “Review” (Priya)')
    assert.equal(sendBackLead(target(), NOW, { banner: true }), 'Sent back from 3 “Review” by Priya')
    assert.equal(sendBackLead(target({ by: null }), NOW), 'Asked for more info by 3 “Review”')
  })
})

describe('reason', () => {
  it('is trimmed; blank or missing is null', () => {
    assert.equal(sendBackReason(sender({ reason: '  Fix it  ' })), 'Fix it')
    assert.equal(sendBackReason(sender({ reason: '   ' })), null)
    assert.equal(sendBackReason(sender({ reason: null })), null)
    assert.equal(sendBackReason(null), null)
  })
  it('long or multi-line reasons get a toggle; short ones do not', () => {
    assert.equal(isLongReason('Short'), false)
    assert.equal(isLongReason('x'.repeat(REASON_SHORT_LIMIT + 1)), true)
    assert.equal(isLongReason('Line one\nLine two'), true)
    assert.equal(isLongReason(null), false)
  })
  it('shortens at a word with an ellipsis, flattening line breaks', () => {
    const long = 'The PAN card name does not match the Aadhaar card name and the date of birth is also different, please collect a fresh copy of both documents'
    const s = shortReason(long)
    assert.ok(s.endsWith('…'))
    assert.ok(s.length <= REASON_SHORT_LIMIT + 1)
    assert.ok(!s.slice(0, -1).endsWith(' '))
    assert.equal(shortReason('One\n\ntwo'), 'One two')
    // Text is never interpreted: markup stays literal characters.
    assert.equal(shortReason('<b>bold</b>'), '<b>bold</b>')
  })
})
