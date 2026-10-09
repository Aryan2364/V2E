// Unit tests for the workflow-task badge wording and instance titles.
// Run: npm run test:unit (Node's own test runner — no framework installed).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { TaskWorkflowRef } from '@/lib/types/tasks'
import { badgeDate, instanceTitle, isScheduled, workflowBadgeText, workflowBadgeTip } from '../instanceLabel'

const NOW = new Date(2026, 9, 9, 12, 0)

const ref = (over: Partial<TaskWorkflowRef> = {}): TaskWorkflowRef => ({
  instance_id: 'i1',
  template_id: 't1',
  label: 'ACME Ltd onboarding',
  instance_number: 12,
  step_label: '2',
  total_steps: 5,
  started_by_name: 'Mehul',
  started_at: new Date(2026, 10, 3, 9, 0).toISOString(),
  trigger_type: 'manual',
  template_name: 'Vendor onboarding',
  instance_name: 'ACME Ltd onboarding',
  ...over,
})

describe('instanceTitle', () => {
  it('numbers instances', () => {
    assert.equal(instanceTitle(12), 'Instance #12')
    assert.equal(instanceTitle(null), 'Instance')
    assert.equal(instanceTitle(0), 'Instance')
  })
})

describe('badgeDate', () => {
  it('leaves out the current year', () => {
    assert.equal(badgeDate(new Date(2026, 10, 3), NOW), '3 Nov')
  })
  it('adds another year', () => {
    assert.equal(badgeDate(new Date(2025, 0, 21), NOW), '21 Jan 2025')
  })
  it('is empty for no date or a bad one', () => {
    assert.equal(badgeDate(null, NOW), '')
    assert.equal(badgeDate('not a date', NOW), '')
  })
})

describe('workflowBadgeText', () => {
  it('uses the server’s ready-made label', () => {
    assert.equal(workflowBadgeText(ref({ label: 'ACME Ltd onboarding · 3 Nov' }), NOW), 'ACME Ltd onboarding · 3 Nov')
  })
  it('without a label: a manual instance shows its name and date', () => {
    assert.equal(workflowBadgeText(ref({ label: '' }), NOW), 'ACME Ltd onboarding · 3 Nov')
  })
  it('without a label: a scheduled instance shows the workflow name and date', () => {
    const w = ref({ label: '', trigger_type: 'schedule', started_by_name: null, instance_name: 'Vendor onboarding — 3 Nov 2026' })
    assert.equal(workflowBadgeText(w, NOW), 'Vendor onboarding · 3 Nov')
  })
  it('without a label: adds the year when the instance started in another year', () => {
    assert.equal(workflowBadgeText(ref({ label: '', started_at: new Date(2025, 11, 30).toISOString() }), NOW), 'ACME Ltd onboarding · 30 Dec 2025')
  })
  it('without a label or a date: just the name', () => {
    assert.equal(workflowBadgeText(ref({ label: '', started_at: null }), NOW), 'ACME Ltd onboarding')
  })
})

describe('workflowBadgeTip / isScheduled', () => {
  it('says the instance, the step and who started it', () => {
    assert.equal(workflowBadgeTip(ref()), 'Instance #12 · Step 2 of 5 · started by Mehul')
  })
  it('says a schedule started it', () => {
    assert.equal(workflowBadgeTip(ref({ trigger_type: 'schedule', started_by_name: null })), 'Instance #12 · Step 2 of 5 · started by schedule')
  })
  it('leaves out who started it when a manual instance has no name for them', () => {
    assert.equal(workflowBadgeTip(ref({ started_by_name: null })), 'Instance #12 · Step 2 of 5')
  })
  it('the server’s is_scheduled wins', () => {
    assert.equal(isScheduled({ is_scheduled: true, trigger_type: 'manual', started_by_name: 'Asha' }), true)
    assert.equal(workflowBadgeTip(ref({ is_scheduled: true, started_by_name: null, trigger_type: null })), 'Instance #12 · Step 2 of 5 · started by schedule')
  })
  it('without a trigger type, no starter means a schedule', () => {
    assert.equal(isScheduled({ trigger_type: null, started_by_name: null }), true)
    assert.equal(isScheduled({ trigger_type: null, started_by_name: 'Asha' }), false)
  })
})
