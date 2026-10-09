// Unit tests for what an open new-step form gives up when the builder adds it without its
// own button — above all on Save draft / Save, where a filled form must never be dropped.
// Run: npm run test:unit (Node's own test runner — no framework installed).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { StepInput } from '@/lib/types/workflows'
import { blankStepDraft, commitDraft, draftTouched, type StepDraft } from '../stepDraft'

const ME = { user_id: 'u-me', name: 'Mehul' }
const initial = blankStepDraft(ME)
const with_ = (over: Partial<StepDraft>): StepDraft => ({ ...initial, ...over })

/** Stands in for the form's own checks ('add'): a title is required. */
const checked = (d: StepDraft): StepInput | null => (d.title.trim() ? { title: d.title.trim() } : null)

describe('draftTouched', () => {
  it('a form as it opened is untouched', () => {
    assert.equal(draftTouched(blankStepDraft(ME), initial), false)
  })
  it('whitespace-only title is still untouched', () => {
    assert.equal(draftTouched(with_({ title: '   ' }), initial), false)
  })
  it('a title, another assignee, or another setting counts as filled in', () => {
    assert.equal(draftTouched(with_({ title: 'Collect offer letter' }), initial), true)
    assert.equal(draftTouched(with_({ assignees: [{ user_id: 'u-2', name: 'Priya', is_cc: false }] }), initial), true)
    assert.equal(draftTouched(with_({ if_late: 'move_on' }), initial), true)
  })
})

describe('commitDraft', () => {
  it('an untouched form is blank for every reason (nothing to keep)', () => {
    for (const reason of ['add', 'draft', 'save'] as const) assert.equal(commitDraft(initial, initial, reason, checked), 'blank')
  })

  it('Save draft keeps a step with a title and an assignee (the reported data loss)', () => {
    const d = with_({ title: 'Repro step one', assignees: [{ user_id: 'u-2', name: 'Priya', is_cc: false }] })
    const out = commitDraft(d, initial, 'draft', checked)
    assert.notEqual(out, 'blank')
    assert.notEqual(out, 'invalid')
    const input = out as StepInput
    assert.equal(input.title, 'Repro step one')
    assert.deepEqual(input.assignee_user_ids, ['u-2'])
  })

  it('Save draft keeps a filled form with no title (shown as "Untitled step")', () => {
    const d = with_({ description: 'Ask HR for the signed copy' })
    const out = commitDraft(d, initial, 'draft', checked) as StepInput
    assert.equal(typeof out, 'object')
    assert.equal(out.title, '')
    assert.equal(out.description, 'Ask HR for the signed copy')
  })

  it('Save also keeps it as it is: its full checks then name what is missing', () => {
    const d = with_({ assignees: [], escalation_mode: 'people', escalation_user_ids: [] })
    const out = commitDraft(d, initial, 'save', checked) as StepInput
    assert.equal(typeof out, 'object')
    assert.deepEqual(out.assignee_user_ids, [])
    assert.equal(out.escalation_mode, 'people')
  })

  it('escalation people are dropped when "Reporting manager" is chosen', () => {
    const d = with_({ title: 'X', escalation_mode: 'manager', escalation_user_ids: ['u-9'] })
    const out = commitDraft(d, initial, 'draft', checked) as StepInput
    assert.deepEqual(out.escalation_user_ids, [])
  })

  it('opening another form: a filled form without a title is not thrown away (invalid, it says why)', () => {
    assert.equal(commitDraft(with_({ description: 'Notes' }), initial, 'add', checked), 'invalid')
  })

  it('opening another form: a titled form is added through the form checks', () => {
    assert.deepEqual(commitDraft(with_({ title: ' Sign-off ' }), initial, 'add', checked), { title: 'Sign-off' })
  })
})
