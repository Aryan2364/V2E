/**
 * Flow layout for workflows: steps wait for other steps (the step before them in their
 * track, the step their track splits from, steps in other tracks they also wait for), so
 * the steps form a graph with no loops. Each step gets a level (0 = starts when the run
 * starts; otherwise one more than the deepest step it waits for) — the row it is drawn
 * on; its track is its lane (FlowDiagram).
 */

export interface FlowInput {
  id: string
  deps: string[]
  /** Display order, the tie-breaker inside a level. */
  order: number
}

export interface FlowLayout {
  /** Ids per level, top to bottom, each level ordered left to right. */
  levels: string[][]
  levelOf: Map<string, number>
  /** Deps that point at ids in this graph (unknown ids dropped). */
  deps: Map<string, string[]>
}

export function layoutFlow(nodes: FlowInput[]): FlowLayout {
  const ids = new Set(nodes.map((n) => n.id))
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const deps = new Map(nodes.map((n) => [n.id, Array.from(new Set(n.deps.filter((d) => ids.has(d) && d !== n.id)))]))
  const levelOf = new Map<string, number>()
  const visiting = new Set<string>()

  const level = (id: string): number => {
    const known = levelOf.get(id)
    if (known !== undefined) return known
    if (visiting.has(id)) return 0 // a loop (never saved by the server) — break it here
    visiting.add(id)
    const ds = deps.get(id) ?? []
    const l = ds.length ? Math.max(...ds.map(level)) + 1 : 0
    visiting.delete(id)
    levelOf.set(id, l)
    return l
  }
  nodes.forEach((n) => level(n.id))

  const max = Math.max(-1, ...Array.from(levelOf.values()))
  const levels: string[][] = Array.from({ length: max + 1 }, () => [])
  nodes
    .slice()
    .sort((a, b) => a.order - b.order)
    .forEach((n) => levels[levelOf.get(n.id) ?? 0].push(n.id))

  // Fewer crossing lines: order each level by the average position of what it waits for.
  const pos = new Map<string, number>()
  levels.forEach((row, li) => {
    if (li > 0) {
      const score = (id: string) => {
        const ps = (deps.get(id) ?? []).map((d) => pos.get(d)).filter((p): p is number => p !== undefined)
        return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : Number.MAX_SAFE_INTEGER
      }
      row.sort((a, b) => score(a) - score(b) || (byId.get(a)!.order - byId.get(b)!.order))
    }
    row.forEach((id, i) => pos.set(id, row.length === 1 ? 0.5 : i / (row.length - 1)))
  })

  return { levels, levelOf, deps }
}
