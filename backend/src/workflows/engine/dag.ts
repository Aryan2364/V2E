import { isBranchRow, readSnapshot } from './snapshot'

/**
 * The step graph of a run (workflows v2 §B). Pure.
 *
 * Each instance row's snapshot carries `depends_on_step_ids` (template step ids);
 * they map onto rows of the same run through `workflow_step_id`. A run whose rows
 * carry no `depends_on_step_ids` (legacy snapshots) is a straight sequence by
 * (order_index, created_at). Legacy escalation rows are never part of the graph.
 */

export interface DagRow {
  id: string
  workflow_step_id: string
  order_index: number
  created_at: Date
  status: string
  step_snapshot: unknown
}

/** A row whose dependents may start. */
export const SATISFIED_STATUSES = ['completed', 'skipped', 'moved_on'] as const
/** A row that is done for the purpose of completing the run. */
export const DONE_STATUSES = ['completed', 'skipped'] as const
/** A row with a live task the run is waiting on (or paused on). */
export const OPEN_STATUSES = ['active', 'overdue', 'moved_on', 'sent_back'] as const

export function isSatisfied(status: string): boolean {
  return (SATISFIED_STATUSES as readonly string[]).includes(status)
}
export function isDone(status: string): boolean {
  return (DONE_STATUSES as readonly string[]).includes(status)
}
export function isOpen(status: string): boolean {
  return (OPEN_STATUSES as readonly string[]).includes(status)
}

function byOrder<T extends DagRow>(a: T, b: T): number {
  return a.order_index - b.order_index || a.created_at.getTime() - b.created_at.getTime() || a.id.localeCompare(b.id)
}

/** The rows that make up the flow (legacy escalation rows excluded), in display order. */
export function flowRows<T extends DagRow>(rows: T[]): T[] {
  return rows.filter((r) => !isBranchRow(r)).sort(byOrder)
}

/** True when every flow row carries a v2 dependency list (else: legacy sequence). */
export function isDagRun(rows: DagRow[]): boolean {
  const flow = flowRows(rows)
  return flow.length > 0 && flow.every((r) => readSnapshot(r.step_snapshot)?.depends_on_step_ids != null)
}

/**
 * rowId → the row ids it starts after. Unknown dependency ids (a step that is not in
 * this run) are dropped; self-references and duplicates too.
 */
export function rowDependencies(rows: DagRow[]): Map<string, string[]> {
  const flow = flowRows(rows)
  const deps = new Map<string, string[]>()
  if (!isDagRun(rows)) {
    flow.forEach((r, i) => deps.set(r.id, i > 0 ? [flow[i - 1].id] : []))
    return deps
  }
  const rowByStep = new Map<string, string>()
  for (const r of flow) if (!rowByStep.has(r.workflow_step_id)) rowByStep.set(r.workflow_step_id, r.id)
  for (const r of flow) {
    const stepIds = readSnapshot(r.step_snapshot)?.depends_on_step_ids ?? []
    const ids: string[] = []
    for (const sid of stepIds) {
      const rid = rowByStep.get(sid)
      if (rid && rid !== r.id && !ids.includes(rid)) ids.push(rid)
    }
    deps.set(r.id, ids)
  }
  return deps
}

/** Direct dependents of `rowId`. */
export function dependentsOf(deps: Map<string, string[]>, rowId: string): string[] {
  const out: string[] = []
  for (const [id, ds] of deps) if (ds.includes(rowId)) out.push(id)
  return out
}

/**
 * Every row upstream of `rowId` (transitive dependencies) with its distance
 * (1 = direct predecessor). Cycle-safe.
 */
export function upstreamOf(deps: Map<string, string[]>, rowId: string): Map<string, number> {
  const dist = new Map<string, number>()
  let frontier = deps.get(rowId) ?? []
  let d = 1
  while (frontier.length) {
    const next: string[] = []
    for (const id of frontier) {
      if (dist.has(id) || id === rowId) continue
      dist.set(id, d)
      next.push(...(deps.get(id) ?? []))
    }
    frontier = next
    d++
  }
  return dist
}

/** Pending rows whose dependencies are ALL satisfied (candidates to activate). */
export function readyRows<T extends DagRow>(rows: T[], deps: Map<string, string[]>): T[] {
  const status = new Map(rows.map((r) => [r.id, r.status]))
  return flowRows(rows).filter(
    (r) => r.status === 'pending' && (deps.get(r.id) ?? []).every((d) => isSatisfied(status.get(d) ?? 'pending')),
  )
}

/** The run is finished when every flow row is completed or skipped. */
export function runFinished(rows: DagRow[]): boolean {
  const flow = flowRows(rows)
  return flow.length > 0 && flow.every((r) => isDone(r.status))
}
