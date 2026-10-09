// Unit tests for "Also waits for": which steps a step already waits for through its path.
// Run: npm run test:unit (Node's own test runner — no framework installed).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { WorkflowStep } from '@/lib/types/workflows'
import { layoutTracks, savedMerges, upstreamOf, type TrackDraft } from '../tracks'

const step = (id: string, track = 'main', merges: string[] = []) =>
  ({ id, title: id.toUpperCase(), track_key: track, merge_step_ids: merges }) as unknown as WorkflowStep

describe('upstreamOf / redundant merges', () => {
  // Main 1 → 2 → 3; path B splits after 1: B1 → B2.
  const tracks: TrackDraft[] = [
    { key: 'main', name: '', split_from: null },
    { key: 'B', name: '', split_from: 'k1' },
  ]

  it('a step already waits for its "After" step and everything before it', () => {
    const layout = layoutTracks(tracks, [step('k1'), step('k2'), step('k3'), step('b1', 'B'), step('b2', 'B')])
    assert.deepEqual(Array.from(upstreamOf(layout.pathDeps.get('b1') ?? [], layout.deps, 'b1')), ['k1'])
    assert.deepEqual(Array.from(upstreamOf(layout.pathDeps.get('b2') ?? [], layout.deps, 'b2')).sort(), ['b1', 'k1'])
    // So B1 may also wait for 2 or 3, never 1 (offered list = other paths minus upstream).
    const up = upstreamOf(layout.pathDeps.get('b1') ?? [], layout.deps, 'b1')
    assert.deepEqual(['k1', 'k2', 'k3'].filter((k) => !up.has(k)), ['k2', 'k3'])
  })

  it('a saved merge it already waits for is redundant: kept on screen, left out of the save', () => {
    const layout = layoutTracks(tracks, [step('k1'), step('k2'), step('b1', 'B', ['k1', 'k2']), step('b2', 'B', ['k1'])])
    assert.deepEqual(layout.redundant.get('b1'), ['k1'])
    assert.deepEqual(layout.redundant.get('b2'), ['k1'])
    assert.deepEqual(layout.merges.get('b1'), ['k1', 'k2'])
    assert.deepEqual(savedMerges(layout, 'b1'), ['k2'])
    assert.deepEqual(savedMerges(layout, 'b2'), [])
  })

  it('counts other steps’ merges as upstream, but never the step’s own', () => {
    // Path C starts with the run: C1. Step 3 also waits for C1, so step 4 (after 3) already does.
    const t: TrackDraft[] = [
      { key: 'main', name: '', split_from: null },
      { key: 'C', name: '', split_from: null },
    ]
    const layout = layoutTracks(t, [step('k1'), step('k2', 'main', ['c1']), step('k3'), step('c1', 'C')])
    assert.equal(layout.redundant.get('k2'), undefined) // its own merge is not its path
    const withK4 = layoutTracks(t, [step('k1'), step('k2', 'main', ['c1']), step('k3', 'main', ['c1']), step('c1', 'C')])
    assert.deepEqual(withK4.redundant.get('k3'), ['c1']) // through 2, which waits for C1
  })
})
