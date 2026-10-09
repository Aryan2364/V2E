import { findLoop, loopingDependency, sendBackTargets, rowDependencyMap, spliceOut } from './step-graph'

const g = (o: Record<string, string[]>) => new Map(Object.entries(o))

describe('step-graph (template side)', () => {
  it('finds the dependency that would close a loop', () => {
    const deps = g({ a: ['c'], b: ['a'], c: ['b'] })
    expect(loopingDependency(deps, 'a')).toBe('c')
    expect(loopingDependency(g({ a: [], b: ['a'], c: ['a', 'b'] }), 'c')).toBeNull()
    expect(loopingDependency(g({ a: ['a'] }), 'a')).toBe('a')
  })

  it('reports the first loop in display order', () => {
    expect(findLoop(g({ a: [], b: ['c'], c: ['b'] }), ['a', 'b', 'c'])).toEqual({ from: 'b', to: 'c' })
    expect(findLoop(g({ a: [], b: ['a'], c: ['a'], d: ['b', 'c'] }), ['a', 'b', 'c', 'd'])).toBeNull()
  })

  it('splices a deleted step out: its dependents inherit its dependencies (no duplicates)', () => {
    const out = spliceOut(g({ a: [], x: [], b: ['a', 'x'], c: ['b'], d: ['b', 'a'], e: ['a'] }), 'b')
    expect(Object.fromEntries(out)).toEqual({ c: ['a', 'x'], d: ['a', 'x'] })
    // Deleting a starting step: its dependents start with the run.
    expect(Object.fromEntries(spliceOut(g({ a: [], b: ['a'] }), 'a'))).toEqual({ b: [] })
  })
})

describe('step-graph (run side, engine rule)', () => {
  const snap = (stepId: string, deps: string[] | null) => ({
    version: deps ? 2 : undefined,
    title: stepId,
    assigner_user_id: 'u',
    ...(deps ? { depends_on_step_ids: deps } : {}),
  })
  const row = (id: string, stepId: string, status: string, deps: string[] | null, order: number) => ({
    id,
    workflow_step_id: stepId,
    status,
    order_index: order,
    created_at: new Date(0),
    step_snapshot: snap(stepId, deps),
  })

  it('maps step dependencies onto rows; send-back targets are completed ancestors, nearest first', () => {
    const rows = [
      row('r1', 's1', 'completed', [], 0),
      row('r2', 's2', 'completed', ['s1'], 1),
      row('r3', 's3', 'skipped', ['s1'], 2),
      row('r4', 's4', 'active', ['s2', 's3'], 3),
    ]
    const deps = rowDependencyMap(rows)
    expect(deps.get('r4')).toEqual(['r2', 'r3'])
    expect(sendBackTargets(rows, deps, 'r4').map((t) => [t.row.id, t.distance])).toEqual([
      ['r2', 1],
      ['r1', 2],
    ])
  })

  it('a legacy run (no dependency lists) is a straight sequence', () => {
    const rows = [row('r1', 's1', 'completed', null, 0), row('r2', 's2', 'active', null, 1)]
    expect(rowDependencyMap(rows).get('r2')).toEqual(['r1'])
  })
})
