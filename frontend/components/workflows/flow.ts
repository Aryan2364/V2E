/**
 * Flow layout for workflows: steps start after other steps, so the steps form a graph
 * with no loops. Each step gets a level (0 = starts when the run starts; otherwise one
 * more than the deepest step it waits for). Steps on the same level run side by side.
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

/** Every step that (directly or not) starts after `id`. A step may not start after these. */
export function descendantsOf(id: string, nodes: { id: string; deps: string[] }[]): Set<string> {
  const children = new Map<string, string[]>()
  nodes.forEach((n) => n.deps.forEach((d) => children.set(d, [...(children.get(d) ?? []), n.id])))
  const out = new Set<string>()
  const stack = [...(children.get(id) ?? [])]
  while (stack.length) {
    const c = stack.pop()!
    if (out.has(c)) continue
    out.add(c)
    stack.push(...(children.get(c) ?? []))
  }
  return out
}

/** The first loop found, as a list of ids, or null. */
export function findCycle(nodes: { id: string; deps: string[] }[]): string[] | null {
  const deps = new Map(nodes.map((n) => [n.id, n.deps]))
  const state = new Map<string, 1 | 2>()
  const path: string[] = []
  const visit = (id: string): string[] | null => {
    const s = state.get(id)
    if (s === 2) return null
    if (s === 1) return path.slice(path.indexOf(id))
    state.set(id, 1)
    path.push(id)
    for (const d of deps.get(id) ?? []) {
      if (!deps.has(d)) continue
      const c = visit(d)
      if (c) return c
    }
    path.pop()
    state.set(id, 2)
    return null
  }
  for (const n of nodes) {
    const c = visit(n.id)
    if (c) return c
  }
  return null
}

/**
 * Remove `id` from the graph, handing its own "starts after" to the steps that started
 * after it (A → B → C minus B becomes A → C). Returns each remaining node's new deps.
 */
export function spliceOutStep(nodes: { id: string; deps: string[] }[], id: string): Map<string, string[]> {
  const inherited = (nodes.find((n) => n.id === id)?.deps ?? []).filter((d) => d !== id)
  const out = new Map<string, string[]>()
  for (const n of nodes) {
    if (n.id === id) continue
    if (!n.deps.includes(id)) {
      out.set(n.id, n.deps)
      continue
    }
    const next: string[] = []
    for (const d of n.deps) {
      if (d === id) {
        for (const x of inherited) if (x !== n.id && !next.includes(x)) next.push(x)
      } else if (!next.includes(d)) {
        next.push(d)
      }
    }
    out.set(n.id, next)
  }
  return out
}
