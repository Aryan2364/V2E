import {
  convertDagToTracks,
  deriveDependencies,
  nextTrackKey,
  numberLabel,
  planTracks,
  readTracks,
  redundantMerges,
  resolveStoredTracks,
  runTracks,
  trackIndexOf,
  trackKeyAt,
  trackLabel,
} from './tracks'

const at = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n))
const dag = (spec: [string, string[]][]) => spec.map(([id, deps], i) => ({ id, order_index: i, created_at: at(i), depends_on: deps }))

/** Converted → { id: 'track:pos[+merges]' } for compact assertions. */
function shape(steps: ReturnType<typeof dag>) {
  const out = convertDagToTracks(steps)
  const place = Object.fromEntries(
    [...out.steps].map(([id, c]) => [id, `${c.track_key}:${c.order_index}${c.merge_step_ids.length ? `+${c.merge_step_ids.join(',')}` : ''}`]),
  )
  return { place, tracks: out.tracks.map((t) => `${t.key}<${t.split_from_step_id ?? '-'}`), order: out.order, raw: out }
}

/** The derived dependencies of a conversion, to check the flow runs the same. */
function derived(out: ReturnType<typeof convertDagToTracks>, ids: string[]) {
  const groups = new Map<string, { id: string }[]>(out.tracks.map((t) => [t.key, []]))
  const ordered = ids.slice().sort((a, b) => out.steps.get(a)!.order_index - out.steps.get(b)!.order_index)
  for (const id of ordered) groups.get(out.steps.get(id)!.track_key)!.push({ id })
  const merges = new Map([...out.steps].map(([id, c]) => [id, c.merge_step_ids]))
  return deriveDependencies(out.tracks, groups, merges)
}

/** Transitive closure: id → every step it (directly or not) waits for. */
function closure(deps: Map<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const id of deps.keys()) {
    const seen = new Set<string>()
    const stack = [...(deps.get(id) ?? [])]
    while (stack.length) {
      const d = stack.pop()!
      if (seen.has(d)) continue
      seen.add(d)
      stack.push(...(deps.get(d) ?? []))
    }
    out[id] = [...seen].sort()
  }
  return out
}

describe('track keys and labels', () => {
  it('assigns B, C … Z, AA in order and reads them back', () => {
    expect([1, 2, 25, 26, 27].map(trackKeyAt)).toEqual(['B', 'C', 'Z', 'AA', 'AB'])
    expect(['main', 'B', 'Z', 'AA'].map(trackIndexOf)).toEqual([0, 1, 25, 26])
    expect(nextTrackKey(['main', 'B', 'D'])).toBe('E')
    expect(nextTrackKey(['main'])).toBe('B')
  })

  it('labels tracks and numbers steps', () => {
    expect(trackLabel({ key: 'main' })).toBe('Main path')
    expect(trackLabel({ key: 'B', name: '  ' })).toBe('Path B')
    expect(trackLabel({ key: 'B', name: 'Finance' })).toBe('Finance')
    expect(numberLabel('main', 2)).toBe('3')
    expect(numberLabel('C', 0)).toBe('C1')
  })

  it('reads stored tracks: main first, junk dropped, main never splits', () => {
    expect(
      readTracks([
        { key: 'B', name: ' Finance ', split_from_step_id: 's1' },
        { key: 'main', split_from_step_id: 'x' },
        { key: 'bad' },
        { key: 'B' },
      ]),
    ).toEqual([
      { key: 'main', name: null, split_from_step_id: null },
      { key: 'B', name: 'Finance', split_from_step_id: 's1' },
    ])
    expect(readTracks(null)).toEqual([{ key: 'main', name: null, split_from_step_id: null }])
  })
})

describe('convertDagToTracks (migration)', () => {
  it('a straight chain stays on the main track', () => {
    const s = shape(dag([['a', []], ['b', ['a']], ['c', ['b']]]))
    expect(s.place).toEqual({ a: 'main:0', b: 'main:1', c: 'main:2' })
    expect(s.tracks).toEqual(['main<-'])
  })

  it('split + join: the side branch becomes track B and the join merges it', () => {
    // a → (b, c) → d
    const steps = dag([['a', []], ['b', ['a']], ['c', ['a']], ['d', ['b', 'c']]])
    const s = shape(steps)
    expect(s.place).toEqual({ a: 'main:0', b: 'main:1', c: 'B:0', d: 'main:2+c' })
    expect(s.tracks).toEqual(['main<-', 'B<a'])
    expect(s.order).toEqual(['a', 'b', 'd', 'c'])
    expect(closure(derived(s.raw, steps.map((x) => x.id)))).toEqual(
      closure(new Map(steps.map((x) => [x.id, x.depends_on]))),
    )
  })

  it('independent branches that never join each get their own track', () => {
    // a → b → c and a → x → y
    const steps = dag([['a', []], ['b', ['a']], ['x', ['a']], ['c', ['b']], ['y', ['x']]])
    const s = shape(steps)
    expect(s.place).toEqual({ a: 'main:0', b: 'main:1', c: 'main:2', x: 'B:0', y: 'B:1' })
    expect(s.tracks).toEqual(['main<-', 'B<a'])
  })

  it('several starting steps: the first starts main, the others start with the workflow', () => {
    const steps = dag([['a', []], ['b', []], ['c', ['a', 'b']], ['d', []]])
    const s = shape(steps)
    expect(s.place).toEqual({ a: 'main:0', b: 'B:0', c: 'main:1+b', d: 'C:0' })
    expect(s.tracks).toEqual(['main<-', 'B<-', 'C<-'])
    expect(closure(derived(s.raw, steps.map((x) => x.id)))).toEqual(
      closure(new Map(steps.map((x) => [x.id, x.depends_on]))),
    )
  })

  it('ties follow order_index; the primary is the dependency that comes first in topological order', () => {
    // a → b on main; c splits from a (B). d waits for c and a: a comes first in
    // topological order, so it is the primary — main has moved past a, so d starts
    // track C from a and merges c. e likewise starts track D from a and merges d.
    const steps = dag([['a', []], ['b', ['a']], ['c', ['a']], ['d', ['c', 'a']], ['e', ['d', 'a']]])
    const s = shape(steps)
    expect(s.place).toEqual({ a: 'main:0', b: 'main:1', c: 'B:0', d: 'C:0+c', e: 'D:0+d' })
    expect(closure(derived(s.raw, steps.map((x) => x.id)))).toEqual(
      closure(new Map(steps.map((x) => [x.id, x.depends_on]))),
    )
    // The rule is literal: a redundant earlier dependency (c lists a and b, a → b) is
    // still the primary, so c starts its own track from a and merges b — same flow.
    const redundant = dag([['a', []], ['b', ['a']], ['c', ['a', 'b']]])
    const r = shape(redundant)
    expect(r.place).toEqual({ a: 'main:0', b: 'main:1', c: 'B:0+b' })
    expect(closure(derived(r.raw, ['a', 'b', 'c']))).toEqual(closure(new Map(redundant.map((x) => [x.id, x.depends_on]))))
  })

  it('ignores unknown ids and self references, and breaks a loop instead of hanging', () => {
    expect(shape(dag([['a', ['zz', 'a']], ['b', ['a']]])).place).toEqual({ a: 'main:0', b: 'main:1' })
    const loop = shape(dag([['a', ['b']], ['b', ['a']]]))
    expect(Object.keys(loop.place).sort()).toEqual(['a', 'b'])
  })

  it('handles an empty workflow', () => {
    expect(shape([]).tracks).toEqual(['main<-'])
  })
})

describe('resolveStoredTracks', () => {
  const step = (id: string, track: string, order: number, merges: string[] = [], deps: string[] = []) => ({
    id,
    order_index: order,
    created_at: at(order),
    track_key: track,
    merge_step_ids: merges,
    depends_on_step_ids: deps,
  })

  it('orders steps by track, numbers them and derives depends_on', () => {
    const r = resolveStoredTracks(
      [
        { key: 'main', name: null, split_from_step_id: null },
        { key: 'B', name: 'Finance', split_from_step_id: 'm1' },
      ],
      [step('m2', 'main', 1), step('b1', 'B', 0), step('m1', 'main', 0), step('m3', 'main', 2, ['b2']), step('b2', 'B', 1)],
    )
    expect(r.display.map((s) => s.id)).toEqual(['m1', 'm2', 'm3', 'b1', 'b2'])
    expect(Object.fromEntries(r.labels)).toEqual({ m1: '1', m2: '2', m3: '3', b1: 'B1', b2: 'B2' })
    expect(Object.fromEntries(r.deps)).toEqual({ m1: [], m2: ['m1'], m3: ['m2', 'b2'], b1: ['m1'], b2: ['b1'] })
    expect(r.converted).toBe(false)
  })

  it('converts a template that never had tracks stored', () => {
    const r = resolveStoredTracks([], [step('a', 'main', 0), step('b', 'main', 1, [], ['a']), step('c', 'main', 2, [], ['a'])])
    expect(r.converted).toBe(true)
    expect(Object.fromEntries(r.labels)).toEqual({ a: '1', b: '2', c: 'B1' })
  })

  it('drops empty extra tracks, bad merges and split points that point into the track itself', () => {
    const r = resolveStoredTracks(
      [
        { key: 'main', name: null, split_from_step_id: null },
        { key: 'B', name: null, split_from_step_id: 'b1' },
        { key: 'C', name: null, split_from_step_id: 'm1' },
      ],
      [step('m1', 'main', 0, ['m1', 'gone']), step('b1', 'B', 0)],
    )
    expect(r.tracks.map((t) => [t.key, t.split_from_step_id])).toEqual([
      ['main', null],
      ['B', null],
    ])
    expect(r.merges.get('m1')).toEqual([])
  })
})

describe('planTracks (definition save / preview)', () => {
  const s = (key: string, track = 'main', merges: string[] = [], title = key.toUpperCase()) => ({
    key,
    title,
    track_key: track,
    merge_step_keys: merges,
  })

  it('lays out the example: split after 1, step 4 also waits for B2', () => {
    const { plan, problem } = planTracks(
      [
        { key: 'main' },
        { key: 'B', name: 'Finance', split_from_step_key: 'k1' },
      ],
      [s('k1'), s('k2'), s('k3'), s('k4', 'main', ['b2']), s('b1', 'B'), s('b2', 'B')],
    )
    expect(problem).toBeNull()
    expect(Object.fromEntries(plan.labels)).toEqual({ k1: '1', k2: '2', k3: '3', k4: '4', b1: 'B1', b2: 'B2' })
    expect(Object.fromEntries(plan.deps)).toEqual({ k1: [], k2: ['k1'], k3: ['k2'], k4: ['k3', 'b2'], b1: ['k1'], b2: ['b1'] })
    expect(plan.tracks).toEqual([
      { key: 'main', name: null, split_from: null },
      { key: 'B', name: 'Finance', split_from: 'k1' },
    ])
  })

  it('drops empty tracks; a missing main track is added', () => {
    const { plan, problem } = planTracks([{ key: 'C', split_from_step_key: 'k1' }], [s('k1')])
    expect(problem).toBeNull()
    expect(plan.tracks.map((t) => t.key)).toEqual(['main'])
  })

  it('names the track or step for bad split points and merges', () => {
    expect(planTracks([{ key: 'main' }, { key: 'B', name: 'Finance', split_from_step_key: 'zz' }], [s('k1'), s('b1', 'B')]).problem).toEqual({
      kind: 'track',
      track_key: 'B',
      message: 'Path B “Finance” starts after a step that no longer exists. Reload and try again.',
    })
    expect(planTracks([{ key: 'main' }, { key: 'B', split_from_step_key: 'b1' }], [s('k1'), s('b1', 'B')]).problem).toMatchObject({
      kind: 'track',
      message: 'Path B can’t start after one of its own steps.',
    })
    expect(planTracks([{ key: 'main' }], [s('k1'), s('k2', 'main', ['k1'])]).problem).toEqual({
      kind: 'step',
      step_key: 'k2',
      message: 'Step 2 “K2”: “Also waits for” can only list steps on other paths.',
    })
    expect(planTracks([{ key: 'main' }], [s('k1', 'Q')]).problem).toMatchObject({ kind: 'step', step_key: 'k1' })
  })

  it('refuses a merge that closes a loop, naming both steps', () => {
    // B splits from 2; step 1 also waits for B1 → 1 waits for B1 waits for 2 waits for 1.
    const { problem } = planTracks(
      [{ key: 'main' }, { key: 'B', split_from_step_key: 'k2' }],
      [s('k1', 'main', ['b1']), s('k2'), s('b1', 'B')],
    )
    expect(problem).toEqual({
      kind: 'step',
      step_key: 'k1',
      message: 'Step 1 “K1” can’t also wait for Step B1 “B1”. That would make a loop.',
    })
  })

  it('a track that starts with the workflow has no dependency on its first step', () => {
    const { plan } = planTracks([{ key: 'main' }, { key: 'B', split_from_step_key: null }], [s('k1'), s('b1', 'B')])
    expect(plan.deps.get('b1')).toEqual([])
  })
})

describe('runTracks (run page)', () => {
  it('uses the snapshot labels when every row has them', () => {
    const rows = [
      { id: 'r1', order_index: 0, track_key: 'main', number_label: '1', track_name: null },
      { id: 'r2', order_index: 1, track_key: 'B', number_label: 'B1', track_name: 'Finance' },
    ]
    const r = runTracks(rows, new Map([['r1', []], ['r2', ['r1']]]))
    expect(Object.fromEntries(r.labels)).toEqual({ r1: '1', r2: 'B1' })
    expect(r.tracks).toEqual([
      { key: 'main', label: 'Main path' },
      { key: 'B', label: 'Finance' },
    ])
  })

  it('derives labels for a run started before tracks', () => {
    const rows = [
      { id: 'r1', order_index: 0 },
      { id: 'r2', order_index: 1 },
      { id: 'r3', order_index: 2 },
    ]
    const r = runTracks(rows, new Map([['r1', []], ['r2', ['r1']], ['r3', ['r1']]]))
    expect(Object.fromEntries(r.labels)).toEqual({ r1: '1', r2: '2', r3: 'B1' })
    expect(r.tracks.map((t) => t.label)).toEqual(['Main path', 'Path B'])
  })
})

describe('redundant merges (“Also waits for” a step it already waits for)', () => {
  const s = (key: string, track = 'main', merges: string[] = []) => ({ key, title: key.toUpperCase(), track_key: track, merge_step_keys: merges })

  it('drops quietly a merge on the split point or anything before it — no problem, not kept', () => {
    // Main 1 → 2; path B splits after 2: B1 → B2. B1 also waits for 2 (its split point)
    // and 1 (before it); B2 also waits for 1 (upstream through B1).
    const { plan, problem } = planTracks(
      [{ key: 'main' }, { key: 'B', split_from_step_key: 'k2' }],
      [s('k1'), s('k2'), s('b1', 'B', ['k2', 'k1']), s('b2', 'B', ['k1'])],
    )
    expect(problem).toBeNull()
    expect(plan.merges.get('b1')).toEqual([])
    expect(plan.merges.get('b2')).toEqual([])
    expect(plan.deps.get('b1')).toEqual(['k2'])
    expect(plan.deps.get('b2')).toEqual(['b1'])
  })

  it('keeps a merge that adds a real wait, and counts other steps’ merges as upstream', () => {
    // Main 1 → 2 → 3 → 4; path B starts with the run: B1 → B2. Step 3 also waits for B2,
    // so step 4 already waits for B1 (through 3) — its merge on B1 is dropped; step 2's
    // merge on B1 is real.
    const { plan, problem } = planTracks(
      [{ key: 'main' }, { key: 'B', split_from_step_key: null }],
      [s('k1'), s('k2', 'main', ['b1']), s('k3', 'main', ['b2']), s('k4', 'main', ['b1']), s('b1', 'B'), s('b2', 'B')],
    )
    expect(problem).toBeNull()
    expect(plan.merges.get('k2')).toEqual(['b1'])
    expect(plan.merges.get('k3')).toEqual(['b2'])
    expect(plan.merges.get('k4')).toEqual([])
    expect(plan.deps.get('k4')).toEqual(['k3'])
  })

  it('redundantMerges never counts the step’s own merges as its path', () => {
    const tracks = [
      { key: 'main', split_from_step_id: null },
      { key: 'B', split_from_step_id: 'k1' },
      { key: 'C', split_from_step_id: null },
    ]
    const groups = new Map([
      ['main', [{ id: 'k1' }, { id: 'k2' }]],
      ['B', [{ id: 'b1' }]],
      ['C', [{ id: 'c1' }]],
    ])
    // B1 waits for 1 (its split point) — "also waits for 1" is redundant; C1 is not
    // upstream of B1 even though B1 also waits for it.
    const merges = new Map([['b1', ['k1', 'c1']]])
    expect(Object.fromEntries(redundantMerges(tracks, groups, merges))).toEqual({ b1: ['k1'] })
  })
})
