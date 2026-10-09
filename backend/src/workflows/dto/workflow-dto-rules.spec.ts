import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { DefinitionStepDto, SaveDefinitionDto } from './definition.dto'
import { SendBackDto, SkipStepDto } from './run-actions.dto'
import { parseDeadlineConfig, isValidDateOnly } from './deadline-config'

describe('parseDeadlineConfig', () => {
  it('accepts and normalizes every type, dropping unknown keys', () => {
    expect(parseDeadlineConfig({ type: 'x_days_after_start', days: 0, time: '18:00', junk: 1 })).toEqual({
      ok: true,
      value: { type: 'x_days_after_start', days: 0, time: '18:00' },
    })
    expect(parseDeadlineConfig({ type: 'fixed_date', date: '2026-02-28', time: '09:30' }).ok).toBe(true)
    expect(parseDeadlineConfig({ type: 'daily', time: '23:59' }).ok).toBe(true)
    expect(parseDeadlineConfig({ type: 'weekly', day: 0, time: '10:00' }).ok).toBe(true)
    expect(parseDeadlineConfig({ type: 'monthly', day_of_month: 31, time: '10:00' }).ok).toBe(true)
    expect(parseDeadlineConfig({ type: 'yearly', month: 2, day: 31, time: '10:00' }).ok).toBe(true)
    expect(parseDeadlineConfig({ type: 'x_days_after_prev_deadline', days: '3', time: '10:00' })).toEqual({
      ok: true,
      value: { type: 'x_days_after_prev_deadline', days: 3, time: '10:00' },
    })
  })

  it.each([
    [null, 'Choose when this step is due.'],
    [{ type: 'bogus', time: '10:00' }, 'Choose when this step is due.'],
    [{ type: 'daily' }, 'Enter a valid due time.'],
    [{ type: 'daily', time: '24:00' }, 'Enter a valid due time.'],
    [{ type: 'x_days_after_start', days: 366, time: '10:00' }, 'The number of days must be a whole number from 0 to 365.'],
    [{ type: 'x_days_after_start', days: 1.5, time: '10:00' }, 'The number of days must be a whole number from 0 to 365.'],
    [{ type: 'fixed_date', date: '2026-02-30', time: '10:00' }, 'Choose a valid due date.'],
    [{ type: 'weekly', day: 7, time: '10:00' }, 'Choose the day of the week it is due.'],
    [{ type: 'monthly', day_of_month: 0, time: '10:00' }, 'The day of the month must be from 1 to 31.'],
    [{ type: 'yearly', month: 13, day: 1, time: '10:00' }, 'Choose the month it is due.'],
  ])('rejects %j', (cfg, error) => {
    expect(parseDeadlineConfig(cfg)).toEqual({ ok: false, error })
  })

  it('validates calendar dates', () => {
    expect(isValidDateOnly('2028-02-29')).toBe(true)
    expect(isValidDateOnly('2027-02-29')).toBe(false)
    expect(isValidDateOnly('2027-1-01')).toBe(false)
  })
})

describe('ChecklistItemDto.template_id', () => {
  const errorsFor = (items: unknown[]) =>
    validateSync(plainToInstance(DefinitionStepDto, { key: 'a', title: 'Step', checklist_items: items }))

  it('accepts own items and template items with a uuid', () => {
    expect(
      errorsFor([
        { title: 'Mine' },
        { title: 'From template', group_title: 'KYC', template_id: '33333333-3333-4333-8333-333333333333' },
        { title: 'Explicitly none', template_id: null },
      ]),
    ).toHaveLength(0)
  })

  it('rejects a non-uuid template id', () => {
    const errors = errorsFor([{ title: 'x', template_id: 'not-a-uuid' }])
    expect(JSON.stringify(errors)).toContain('Choose a valid checklist template.')
  })
})

describe('definition / run-action DTOs', () => {
  const U = (n: number) => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}`
  /** Every constraint message, nested ones included. */
  const messages = (cls: any, body: unknown) => {
    const out: string[] = []
    const walk = (errs: any[]) =>
      errs.forEach((e) => {
        out.push(...Object.values<string>(e.constraints ?? {}))
        walk(e.children ?? [])
      })
    walk(validateSync(plainToInstance(cls, body)))
    return out
  }
  const step = (over: Record<string, unknown> = {}) => ({ key: 'k1', title: 'Collect documents', ...over })
  const definition = (over: Record<string, unknown> = {}) => ({
    name: 'Onboarding',
    mode: 'draft',
    starts: { manual: { enabled: true }, schedules: [] },
    steps: [step()],
    ...over,
  })

  it('accepts a full step, in a track, with "Also wait for" pointing at keys of steps not saved yet', () => {
    expect(
      messages(DefinitionStepDto, {
        key: 'new-2',
        title: 'Review',
        assignee_user_ids: [U(1)],
        cc_user_ids: [U(2)],
        completion_mode: 'all_must_complete',
        tag_ids: [U(3)],
        proof_required: true,
        proof_allowed_extensions: ['pdf'],
        due_days: 0,
        due_time: '09:30',
        escalation_mode: 'people',
        escalation_user_ids: [U(4), U(5)],
        if_late: 'move_on',
        track_key: 'B',
        merge_step_keys: ['new-1', U(6)],
      }),
    ).toEqual([])
  })

  it('a draft step may have a blank title', () => {
    expect(messages(DefinitionStepDto, step({ title: '   ' }))).toEqual([])
  })

  it.each([
    [{ title: 'x'.repeat(51) }, 'A step title can be at most 50 characters.'],
    [{ due_days: 366 }, 'Days must be 0 to 365.'],
    [{ due_time: '6pm' }, 'Enter a valid due time.'],
    [{ if_late: 'retry' }, "If late must be 'wait' or 'move_on'."],
    [{ escalation_mode: 'role' }, "Escalate to must be 'manager' or 'people'."],
    [{ escalation_user_ids: [U(1), U(2), U(3), U(4), U(5), U(6)] }, 'Choose at most 5 people to escalate to.'],
    [{ merge_step_keys: ['a', 'a'] }, '“Also waits for” can list each step only once.'],
    [{ track_key: 'b' }, 'One of the steps is on a path that is not valid. Reload and try again.'],
    [{ assignee_user_ids: [U(1), U(1)] }, 'Each person can be assigned only once.'],
    [{ id: 'nope' }, 'One of the steps is not valid. Reload and try again.'],
  ])('rejects %j', (over, msg) => {
    expect(messages(DefinitionStepDto, step(over))).toContain(msg)
  })

  it('lists reject null (send [] to clear), nullable masters accept null', () => {
    expect(messages(DefinitionStepDto, step({ assignee_user_ids: null })).length).toBeGreaterThan(0)
    expect(messages(DefinitionStepDto, step({ merge_step_keys: null }))).toEqual([])
    expect(messages(DefinitionStepDto, step({ priority_id: null, category_id: null, description: null }))).toEqual([])
  })

  it('tracks: keys are main or capital letters; names are short; split points are keys or null', () => {
    const tracks = (list: unknown[]) => messages(SaveDefinitionDto, definition({ tracks: list }))
    expect(tracks([{ key: 'main' }, { key: 'B', name: 'Finance', split_from_step_key: 'k1' }, { key: 'C', split_from_step_key: null }])).toEqual([])
    expect(tracks([{ key: 'b' }])).toContain('One of the paths is not valid. Reload and try again.')
    expect(tracks([{ key: 'B', name: 'x'.repeat(41) }])).toContain('A path name can be at most 40 characters.')
  })

  it('a definition needs a name and a mode; people need at least one owner', () => {
    expect(messages(SaveDefinitionDto, definition())).toEqual([])
    expect(messages(SaveDefinitionDto, definition({ name: '  ' }))).toContain('Enter a workflow name.')
    expect(messages(SaveDefinitionDto, definition({ mode: 'publish' }))).toContain("Mode must be 'draft' or 'save'.")
    expect(messages(SaveDefinitionDto, definition({ people: { owner_user_ids: [], editor_user_ids: [] } }))).toContain(
      'A workflow needs at least one owner.',
    )
    expect(messages(SaveDefinitionDto, definition({ people: { owner_user_ids: [U(1)], editor_user_ids: [] } }))).toEqual([])
  })

  it('schedules use the recurring-task shape', () => {
    const sched = (over: Record<string, unknown> = {}) => ({
      schedule_type: 'monthly',
      every: 1,
      month_days: [1, -31],
      time: '09:00',
      start_date: '2026-10-01',
      end_condition: 'after_n',
      end_after: 12,
      ...over,
    })
    const withSchedules = (schedules: unknown[]) =>
      definition({ starts: { manual: { enabled: false, starter_user_ids: [U(1)] }, schedules } })
    expect(messages(SaveDefinitionDto, withSchedules([sched()]))).toEqual([])
    expect(messages(SaveDefinitionDto, withSchedules([sched({ schedule_type: 'hourly' })]))).toContain(
      'Repeat must be daily, weekly, monthly or yearly.',
    )
    expect(messages(SaveDefinitionDto, withSchedules([sched({ time: '9am' })]))).toContain(
      'Enter a valid schedule time.',
    )
    expect(messages(SaveDefinitionDto, withSchedules([sched({ start_date: 'soon' })]))).toContain(
      'Choose a start date for the schedule.',
    )
  })

  it('send back needs a target and a real reason (trimmed, 5+ chars)', () => {
    expect(messages(SendBackDto, { to_row_id: U(1), reason: '   ok   ' })).toContain(
      'Enter a reason of at least 5 characters.',
    )
    expect(messages(SendBackDto, { to_row_id: U(1), reason: 'Missing PAN copy' })).toEqual([])
    expect(messages(SendBackDto, { reason: 'Missing PAN copy' })).toContain('Choose the step to send it back to.')
    expect(messages(SkipStepDto, {})).toEqual([])
    expect(messages(SkipStepDto, { row_id: 'x' })).toContain('Choose the step to skip.')
  })
})

describe('DefinitionStepDto timing rules', () => {
  const errorsFor = (over: Record<string, unknown>) =>
    validateSync(plainToInstance(DefinitionStepDto, { key: 'a', title: 'Step', ...over }))

  it('accepts a rule object, null (the default) or nothing; params are checked on Save', () => {
    expect(errorsFor({ start_rule: { kind: 'weekday', weekday: 4, time: '09:00' } })).toHaveLength(0)
    expect(errorsFor({ start_rule: null, due_rule: null })).toHaveLength(0)
    expect(errorsFor({})).toHaveLength(0)
  })

  it('rejects a rule that is not an object', () => {
    expect(errorsFor({ start_rule: 'weekday' })[0].constraints).toEqual({ isObject: 'Choose when the step starts.' })
    expect(errorsFor({ due_rule: 3 })[0].constraints).toEqual({ isObject: 'Choose when the step is due.' })
  })
})
