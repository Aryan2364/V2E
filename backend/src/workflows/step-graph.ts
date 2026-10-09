/**
 * Pure graph helpers for workflows v2 (depends_on — derived from the tracks on save,
 * see tracks.ts).
 *
 * Template side: steps reference other steps of the same template by id
 * (`WorkflowStep.depends_on_step_ids`). Run side: each instance row's dependencies
 * are derived from its frozen snapshot, mapped onto the rows of the same run.
 * No I/O here — the services load rows and call these.
 */

import { DagRow, flowRows, rowDependencies, upstreamOf } from './engine/dag'
import { isBranchRow } from './engine/snapshot'

type Json = unknown

export function stringIds(v: Json): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : []
}

// ═══ Template steps ═══════════════════════════════════════════════════════════

/** Every id reachable from `start` by following dependency edges (start excluded). */
export function ancestorsOf(deps: Map<string, string[]>, start: string): Set<string> {
  const seen = new Set<string>()
  const stack = [...(deps.get(start) ?? [])]
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    for (const next of deps.get(id) ?? []) if (!seen.has(next)) stack.push(next)
  }
  return seen
}

/**
 * If giving `stepId` the dependencies in `deps` would close a loop, the dependency
 * that closes it (a step that already — directly or indirectly — starts after
 * `stepId`); otherwise null.
 */
export function loopingDependency(deps: Map<string, string[]>, stepId: string): string | null {
  for (const d of deps.get(stepId) ?? []) {
    if (d === stepId) return d
    if (ancestorsOf(deps, d).has(stepId)) return d
  }
  return null
}

/**
 * Any loop in the whole graph, as the edge that closes it: `from` starts after
 * `to`, and `to` already (indirectly) starts after `from`. `order` fixes which
 * edge is reported (display order) so the message is stable.
 */
export function findLoop(deps: Map<string, string[]>, order: string[]): { from: string; to: string } | null {
  for (const id of order) {
    const to = loopingDependency(deps, id)
    if (to) return { from: id, to }
  }
  return null
}

/**
 * Remove `deletedId` from the graph, handing its own dependencies to the steps that
 * started after it (so "A → B → C" minus B becomes "A → C"). Returns only the steps
 * whose dependency list changes.
 */
export function spliceOut(deps: Map<string, string[]>, deletedId: string): Map<string, string[]> {
  const inherited = (deps.get(deletedId) ?? []).filter((d) => d !== deletedId)
  const changed = new Map<string, string[]>()
  for (const [id, list] of deps) {
    if (id === deletedId || !list.includes(deletedId)) continue
    const next: string[] = []
    for (const d of list) {
      if (d === deletedId) {
        for (const x of inherited) if (x !== id && !next.includes(x)) next.push(x)
      } else if (!next.includes(d)) {
        next.push(d)
      }
    }
    changed.set(id, next)
  }
  return changed
}

// ═══ Run rows ═════════════════════════════════════════════════════════════════
// The run graph is the ENGINE's (engine/dag.ts) — re-exported here so the API reads
// a run exactly the way the engine advances it (legacy runs = straight sequence).

export type RowLike = DagRow

/** A legacy escalation row (old engine) — never part of the v2 step graph. */
export const isLegacyBranchRow = isBranchRow

export function byDisplayOrder<T extends { order_index: number; created_at: Date }>(a: T, b: T): number {
  return a.order_index - b.order_index || a.created_at.getTime() - b.created_at.getTime()
}

/** Each flow row's dependencies as ids of rows in the SAME run (engine rule). */
export function rowDependencyMap(rows: DagRow[]): Map<string, string[]> {
  return rowDependencies(rows)
}

/**
 * The rows a step may be sent back to: COMPLETED rows upstream of `fromRowId`
 * (direct or indirect), nearest first (direct predecessors first), then display
 * order — the same candidates the engine's sendBack accepts.
 */
export function sendBackTargets<T extends DagRow>(
  rows: T[],
  deps: Map<string, string[]>,
  fromRowId: string,
): { row: T; distance: number }[] {
  const up = upstreamOf(deps, fromRowId)
  return flowRows(rows)
    .filter((r) => up.has(r.id) && r.status === 'completed')
    .map((row) => ({ row, distance: up.get(row.id)! }))
    .sort((a, b) => a.distance - b.distance || byDisplayOrder(a.row, b.row))
}
