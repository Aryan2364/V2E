import {
  ChecklistSnapshotItem,
  LiveChecklistTemplate,
  applyChecklistTemplates,
  buildStepSnapshot,
  checklistTemplateIds,
  readSnapshot,
  resolveChecklistTemplates,
  snapshotTemplateIds,
  templateItemTitles,
} from './snapshot'

const KYC = 'tpl-kyc'
const EXIT = 'tpl-exit'

const item = (title: string, extra: Partial<ChecklistSnapshotItem> = {}): ChecklistSnapshotItem => ({
  title,
  order_index: 0,
  group_title: null,
  ...extra,
})
const live = (over: Partial<LiveChecklistTemplate> = {}): LiveChecklistTemplate => ({
  id: KYC,
  name: 'KYC (current)',
  is_active: true,
  items: [
    { title: 'Verify PAN', order_index: 1 },
    { title: 'Collect ID', order_index: 0 },
    { title: '   ', order_index: 2 },
  ],
  ...over,
})
const titles = (items: ChecklistSnapshotItem[]) => items.map((i) => i.title)

describe('linked checklist templates — snapshot resolution', () => {
  const stored: ChecklistSnapshotItem[] = [
    item('Say hello', { order_index: 0 }),
    item('Old copy 1', { order_index: 1, group_title: 'KYC (old)', template_id: KYC }),
    item('Old copy 2', { order_index: 2, group_title: 'KYC (old)', template_id: KYC }),
    item('Wrap up', { order_index: 3, group_title: 'Mine' }),
  ]

  it('a live active template replaces its saved copy with current items, in template order', () => {
    const out = resolveChecklistTemplates(stored, new Map([[KYC, live()]]))
    expect(out).toEqual([
      { title: 'Say hello', order_index: 0, group_title: null },
      { title: 'Collect ID', order_index: 1, group_title: 'KYC (current)', template_id: KYC },
      { title: 'Verify PAN', order_index: 2, group_title: 'KYC (current)', template_id: KYC },
      { title: 'Wrap up', order_index: 3, group_title: 'Mine' },
    ])
  })

  it('an inactive template keeps the saved copy', () => {
    const out = resolveChecklistTemplates(stored, new Map([[KYC, live({ is_active: false })]]))
    expect(titles(out)).toEqual(['Say hello', 'Old copy 1', 'Old copy 2', 'Wrap up'])
    expect(out[1].group_title).toBe('KYC (old)')
  })

  it('a deleted (or other-org, i.e. not found) template keeps the saved copy', () => {
    const out = resolveChecklistTemplates(stored, new Map())
    expect(out).toEqual(stored.map((it, i) => ({ ...it, order_index: i })))
  })

  it('keeps each group at its original position among several groups', () => {
    const items = [
      item('E1', { group_title: 'Exit', template_id: EXIT }),
      item('Mine 1'),
      item('K1', { group_title: 'KYC', template_id: KYC }),
      item('Mine 2'),
    ]
    const out = resolveChecklistTemplates(
      items,
      new Map([
        [KYC, live({ items: [{ title: 'K-new' }] })],
        [EXIT, live({ id: EXIT, name: 'Exit', items: [{ title: 'E-new-1' }, { title: 'E-new-2' }] })],
      ]),
    )
    expect(titles(out)).toEqual(['E-new-1', 'E-new-2', 'Mine 1', 'K-new', 'Mine 2'])
    expect(out.map((i) => i.order_index)).toEqual([0, 1, 2, 3, 4])
  })

  it('a split group is emitted once, at its first item', () => {
    const items = [item('K1', { template_id: KYC }), item('Mine'), item('K2', { template_id: KYC })]
    const out = resolveChecklistTemplates(items, new Map([[KYC, live({ items: [{ title: 'New' }] })]]))
    expect(titles(out)).toEqual(['New', 'Mine'])
  })

  const v2Step = (over: Record<string, unknown> = {}) => ({
    id: 'ws-1',
    title: 'Step',
    description: null,
    assigner_user_id: 'a',
    assignee_user_ids: ['u1', 'u2', 'u1'],
    cc_user_ids: ['u2', 'c1'],
    completion_mode: 'all_must_complete',
    priority_id: null,
    category_id: null,
    tag_ids: ['t1'],
    proof_required: true,
    proof_allowed_extensions: ['pdf'],
    checklist_items: [{ title: 'Old', group_title: 'KYC', template_id: KYC }],
    due_days: 3,
    due_time: '09:30',
    escalation_mode: 'people',
    escalation_user_ids: ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'],
    if_late: 'move_on',
    depends_on_step_ids: ['ws-0', 'ws-1', 'ws-0'],
    order_index: 1,
    ...over,
  })

  it('template_id survives build/read of a snapshot and resolves against live templates', () => {
    const snap = buildStepSnapshot(v2Step())
    expect(snap.checklist_items[0].template_id).toBe(KYC)
    expect(readSnapshot(JSON.parse(JSON.stringify(snap)))!.checklist_items[0].template_id).toBe(KYC)
    expect(snapshotTemplateIds(snap)).toEqual([KYC])
    const resolved = applyChecklistTemplates(snap, new Map([[KYC, live({ items: [{ title: 'K-new' }] })]]))
    expect(titles(resolved.checklist_items)).toEqual(['K-new'])
  })

  it('v2 snapshot: deduped people (CC never also an assignee), self-dependency dropped, ≤5 escalation levels', () => {
    const snap = readSnapshot(JSON.parse(JSON.stringify(buildStepSnapshot(v2Step()))))!
    expect(snap.version).toBe(2)
    expect(snap.assignee_user_ids).toEqual(['u1', 'u2'])
    expect(snap.cc_user_ids).toEqual(['c1'])
    expect(snap.depends_on_step_ids).toEqual(['ws-0'])
    expect(snap.escalation_user_ids).toHaveLength(5)
    expect(snap).toMatchObject({
      completion_mode: 'all_must_complete',
      due_days: 3,
      due_time: '09:30',
      escalation_mode: 'people',
      if_late: 'move_on',
      tag_ids: ['t1'],
      proof_allowed_extensions: ['pdf'],
    })
  })

  it('legacy snapshots normalise to v2 (sequence, fixed person, x_days, proceed_anyway → move on)', () => {
    const legacy = {
      title: 'Old step',
      description: null,
      assignee_type: 'fixed_person',
      assignee_user_id: 'u-old',
      assignee_role: null,
      assigner_user_id: 'a',
      deadline_config: { type: 'x_days_after_prev_completed', days: 4, time: '10:15' },
      proof_required: false,
      priority_id: null,
      category_id: null,
      checklist_items: [],
      if_overdue_action: 'proceed_anyway',
      branch_step_id: null,
      is_branch_step: false,
      order_index: 2,
    }
    const snap = readSnapshot(legacy)!
    expect(snap).toMatchObject({
      assignee_user_ids: ['u-old'],
      cc_user_ids: [],
      due_days: 4,
      due_time: '10:15',
      if_late: 'move_on',
      escalation_mode: 'manager',
      depends_on_step_ids: null,
    })
    expect(readSnapshot({ ...legacy, deadline_config: { type: 'weekly', day: 2 }, if_overdue_action: 'block_next' })).toMatchObject({
      due_days: 1,
      due_time: '18:00',
      if_late: 'wait',
    })
    expect(readSnapshot({ ...legacy, assignee_type: 'role', assignee_user_id: null })!.assignee_user_ids).toEqual([])
  })

  it('helpers ignore junk', () => {
    expect(checklistTemplateIds(null)).toEqual([])
    expect(checklistTemplateIds([{ title: 'a', template_id: KYC }, { template_id: KYC }, { title: 'b' }])).toEqual([KYC])
    expect(templateItemTitles([{ title: 'b' }, { title: 'a', order_index: -1 }, null, { nope: 1 }])).toEqual(['a', 'b'])
  })
})

describe('step timing in snapshots', () => {
  const base = {
    id: 'ws-1',
    title: 'Review',
    description: null,
    assigner_user_id: 'u-1',
    assignee_user_ids: ['u-2'],
    cc_user_ids: [],
    completion_mode: 'any_can_complete',
    priority_id: null,
    category_id: null,
    tag_ids: [],
    proof_required: false,
    proof_allowed_extensions: [],
    checklist_items: [],
    due_days: 1,
    due_time: '18:00',
    escalation_mode: 'manager',
    escalation_user_ids: [],
    if_late: 'wait',
    depends_on_step_ids: [],
    order_index: 0,
  }

  it('carries both rules (canonical) and survives a read', () => {
    const snap = buildStepSnapshot({
      ...base,
      start_rule: { kind: 'weekday', weekday: 4, time: '09:00', extra: true },
      due_rule: { kind: 'month_day', day: 'last', time: '18:00' },
    })
    expect(snap.start_rule).toEqual({ kind: 'weekday', weekday: 4, time: '09:00' })
    expect(snap.due_rule).toEqual({ kind: 'month_day', day: 'last', time: '18:00' })
    const read = readSnapshot({ ...snap, timing_every: 2 })!
    expect(read.start_rule).toEqual(snap.start_rule)
    expect(read.due_rule).toEqual(snap.due_rule)
    expect(read.timing_every).toBe(2)
  })

  it('legacy: no rules (or partial draft rules) → null = today’s behaviour', () => {
    expect(buildStepSnapshot(base).start_rule).toBeNull()
    expect(buildStepSnapshot({ ...base, start_rule: { kind: 'weekday' }, due_rule: null }).start_rule).toBeNull()
    const old = readSnapshot({ ...buildStepSnapshot(base), start_rule: undefined, due_rule: undefined, timing_every: undefined })!
    expect(old.start_rule).toBeNull()
    expect(old.due_rule).toBeNull()
    expect(old.timing_every).toBe(1)
  })
})
