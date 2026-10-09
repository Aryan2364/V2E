import { isDagRun, readyRows, rowDependencies, runFinished, upstreamOf } from './dag'

const at = (n: number) => new Date(1000 + n)
const v2 = (step: string, deps: string[]) => ({
  version: 2,
  title: step,
  assigner_user_id: 'a',
  depends_on_step_ids: deps,
})
const row = (id: string, step: string, order: number, status: string, snapshot: unknown) => ({
  id,
  workflow_step_id: step,
  order_index: order,
  created_at: at(order),
  status,
  step_snapshot: snapshot,
})

describe('workflow run graph', () => {
  // A → (B, C) → D
  const rows = [
    row('ra', 'a', 0, 'completed', v2('A', [])),
    row('rb', 'b', 1, 'completed', v2('B', ['a'])),
    row('rc', 'c', 2, 'active', v2('C', ['a', 'zz-not-in-run'])),
    row('rd', 'd', 3, 'pending', v2('D', ['b', 'c', 'd'])),
  ]

  it('maps template step ids to rows; drops unknown and self references', () => {
    const deps = rowDependencies(rows)
    expect(isDagRun(rows)).toBe(true)
    expect(deps.get('rc')).toEqual(['ra'])
    expect(deps.get('rd')).toEqual(['rb', 'rc'])
  })

  it('a join is ready only when ALL inputs are satisfied (moved_on counts)', () => {
    expect(readyRows(rows, rowDependencies(rows))).toEqual([])
    const moved = rows.map((r) => (r.id === 'rc' ? { ...r, status: 'moved_on' } : r))
    expect(readyRows(moved, rowDependencies(moved)).map((r) => r.id)).toEqual(['rd'])
  })

  it('upstream distances (nearest first) are cycle-safe', () => {
    expect([...upstreamOf(rowDependencies(rows), 'rd')]).toEqual([
      ['rb', 1],
      ['rc', 1],
      ['ra', 2],
    ])
    const cyc = [row('x', 'x', 0, 'pending', v2('X', ['y'])), row('y', 'y', 1, 'pending', v2('Y', ['x']))]
    expect([...upstreamOf(rowDependencies(cyc), 'x').keys()]).toEqual(['y'])
  })

  it('legacy runs are a straight sequence; escalation rows are not part of the flow', () => {
    const legacy = [
      row('l2', 's2', 1, 'pending', { title: 'Two', assigner_user_id: 'a' }),
      row('l1', 's1', 0, 'completed', { title: 'One', assigner_user_id: 'a' }),
      row('esc', 's9', 0, 'active', { title: 'Esc', assigner_user_id: 'a', is_branch: true }),
    ]
    expect(isDagRun(legacy)).toBe(false)
    const deps = rowDependencies(legacy)
    expect(deps.get('l1')).toEqual([])
    expect(deps.get('l2')).toEqual(['l1'])
    expect(deps.has('esc')).toBe(false)
    expect(readyRows(legacy, deps).map((r) => r.id)).toEqual(['l2'])
  })

  it('the run is finished when every flow row is completed or skipped (moved_on is not)', () => {
    const done = rows.map((r) => ({ ...r, status: r.id === 'rc' ? 'skipped' : 'completed' }))
    expect(runFinished(done)).toBe(true)
    expect(runFinished(done.map((r) => (r.id === 'rc' ? { ...r, status: 'moved_on' } : r)))).toBe(false)
  })
})
