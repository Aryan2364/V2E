/**
 * Workflow TRACKS — the structured way a workflow's step graph is authored. Pure.
 *
 *  - Steps live in tracks. The Main track (`main`) always exists; other tracks are
 *    keyed B, C, D… (assigned in creation order, stable once saved).
 *  - Within a track the order is fixed: step N+1 waits for step N of the same track.
 *  - A track other than main starts after its split point (`split_from_step_id`, a step
 *    in another track) — or, when that is null, when the workflow starts.
 *  - A step may ALSO wait for steps in other tracks (`merge_step_ids` = a merge).
 *
 * `depends_on_step_ids` (what the engine, snapshots, planning and the preview read) is
 * DERIVED from this on every save: the previous step in the track, or for a track's
 * first step its split point, plus the merges. Numbering: main 1, 2, 3…; track B's
 * steps B1, B2…
 *
 * `convertDagToTracks` turns an existing free-form step graph into tracks (the
 * migration `20261010120000_workflow_tracks` runs the same algorithm in SQL; legacy
 * run snapshots without track info are labelled with it too).
 */


export const MAIN_TRACK = 'main'
/** 'main', or 1–3 capital letters (B … Z, AA …). */
export const TRACK_KEY_RE = /^(main|[A-Z]{1,3})$/
export const TRACK_NAME_MAX = 40
export const MAX_TRACKS = 100

export interface TrackDef {
  key: string
  name: string | null
  split_from_step_id: string | null
}

// ═══ Keys, labels ══════════════════════════════════════════════════════════════

/** The key of the n-th extra track (1 → 'B', 25 → 'Z', 26 → 'AA', …). */
export function trackKeyAt(n: number): string {
  let x = Math.max(1, Math.trunc(n)) + 1 // bijective base 26, A = 1
  let out = ''
  while (x > 0) {
    const r = (x - 1) % 26
    out = String.fromCharCode(65 + r) + out
    x = Math.floor((x - 1) / 26)
  }
  return out
}

/** Inverse of trackKeyAt (main → 0; invalid → -1). */
export function trackIndexOf(key: string): number {
  if (key === MAIN_TRACK) return 0
  if (!/^[A-Z]{1,3}$/.test(key)) return -1
  let x = 0
  for (const ch of key) x = x * 26 + (ch.charCodeAt(0) - 64)
  return x - 1
}

/** The key for a new track: one past the highest in use. */
export function nextTrackKey(keys: Iterable<string>): string {
  let max = 0
  for (const k of keys) max = Math.max(max, trackIndexOf(k))
  return trackKeyAt(max + 1)
}

/** The main track's old default names — shown as the plain base label, never as a name. */
const MAIN_DEFAULT_NAMES = new Set(['Main track', 'Main path'])

/** A track's name, unless it is just the main track's default name. */
function shownName(t: { key: string; name?: string | null }): string | null {
  const name = t.name?.trim()
  return name && !(t.key === MAIN_TRACK && MAIN_DEFAULT_NAMES.has(name)) ? name : null
}

/** How people see a track: "Main path", its name, or "Path B". */
export function trackLabel(t: { key: string; name?: string | null }): string {
  return shownName(t) ?? (t.key === MAIN_TRACK ? 'Main path' : `Path ${t.key}`)
}

/** How errors name a track: "Main path", "Path B", "Path B “Finance”". */
export function trackErrorLabel(t: { key: string; name?: string | null }): string {
  const base = t.key === MAIN_TRACK ? 'Main path' : `Path ${t.key}`
  const name = shownName(t)
  return name ? `${base} “${name}”` : base
}

/** "1", "2" on the main track; "B1", "B2" on track B. `position` is 0-based. */
export function numberLabel(trackKey: string, position: number): string {
  return trackKey === MAIN_TRACK ? `${position + 1}` : `${trackKey}${position + 1}`
}

/** "Step B2 “Sign-off”" (or "Step B2" while it has no title) — how errors name a step. */
export function stepErrorLabel(label: string, title: string | null | undefined): string {
  const t = (title ?? '').trim()
  return t ? `Step ${label} “${t}”` : `Step ${label}`
}

function cleanName(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim().slice(0, TRACK_NAME_MAX)
  return t || null
}

/** Stored `WorkflowTemplate.tracks` → a clean list: main first, keys unique. */
export function readTracks(raw: unknown): TrackDef[] {
  const out: TrackDef[] = []
  const seen = new Set<string>()
  if (Array.isArray(raw)) {
    for (const t of raw) {
      if (!t || typeof t !== 'object') continue
      const x = t as { key?: unknown; name?: unknown; split_from_step_id?: unknown }
      if (typeof x.key !== 'string' || !TRACK_KEY_RE.test(x.key) || seen.has(x.key)) continue
      seen.add(x.key)
      out.push({
        key: x.key,
        name: cleanName(x.name),
        split_from_step_id:
          x.key !== MAIN_TRACK && typeof x.split_from_step_id === 'string' && x.split_from_step_id ? x.split_from_step_id : null,
      })
    }
  }
  const main = out.find((t) => t.key === MAIN_TRACK) ?? { key: MAIN_TRACK, name: null, split_from_step_id: null }
  return [main, ...out.filter((t) => t.key !== MAIN_TRACK)]
}

function stringIds(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const x of v) if (typeof x === 'string' && x && !out.includes(x)) out.push(x)
  return out
}

/**
 * The first loop found (walking `order`), as ids where each one waits for the next
 * (and the last waits for the first); null when there is none.
 */
export function findCycle(deps: Map<string, string[]>, order: string[]): string[] | null {
  const state = new Map<string, 1 | 2>()
  const path: string[] = []
  const visit = (id: string): string[] | null => {
    const st = state.get(id)
    if (st === 2) return null
    if (st === 1) return path.slice(path.indexOf(id))
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
  for (const id of order) {
    const c = visit(id)
    if (c) return c
  }
  return null
}

// ═══ DAG → tracks (migration + legacy runs) ════════════════════════════════════

export interface DagStep {
  id: string
  order_index: number
  created_at?: Date | string | null
  /** Ids this step starts after (unknown ids are ignored). */
  depends_on: string[]
}

export interface ConvertedStep {
  track_key: string
  /** Position within its track, 0-based. */
  order_index: number
  merge_step_ids: string[]
}

export interface ConvertedTracks {
  tracks: TrackDef[]
  steps: Map<string, ConvertedStep>
  /** Step ids in display order (tracks in order, each in its own order). */
  order: string[]
}

const timeOf = (v: Date | string | null | undefined): number => {
  if (!v) return 0
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime()
  return Number.isFinite(t) ? t : 0
}

/**
 * Convert a free-form step graph into tracks:
 *  - walk the steps in topological order (ties: order_index, then created_at, then id);
 *  - a step's primary predecessor is its dependency that comes first in that order;
 *  - if the primary's track has no step after it yet, the step is appended to that
 *    track; otherwise it starts a new track split from the primary;
 *  - a step with no dependencies: the first one starts the main track, later ones each
 *    start a new track that starts when the workflow starts (split from nothing);
 *  - its other dependencies become merges (one in its own track is already implied by
 *    the track order and is dropped).
 * The derived dependencies are exactly the original ones minus those implied ones, so
 * the flow runs the same. A loop (never saved) is broken at the step that closes it.
 */
export function convertDagToTracks(steps: DagStep[]): ConvertedTracks {
  const byId = new Map(steps.map((s) => [s.id, s]))
  const deps = new Map<string, string[]>()
  for (const s of steps) deps.set(s.id, stringIds(s.depends_on).filter((d) => d !== s.id && byId.has(d)))
  const tie = (a: DagStep, b: DagStep) =>
    a.order_index - b.order_index || timeOf(a.created_at) - timeOf(b.created_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

  const topo = new Map<string, number>()
  const tracks: TrackDef[] = [{ key: MAIN_TRACK, name: null, split_from_step_id: null }]
  const members = new Map<string, string[]>([[MAIN_TRACK, []]])
  const out = new Map<string, ConvertedStep>()
  const remaining = new Set(steps.map((s) => s.id))

  while (remaining.size) {
    const pool = [...remaining].map((id) => byId.get(id)!)
    const ready = pool.filter((s) => deps.get(s.id)!.every((d) => topo.has(d)))
    // A loop (never saved by the server): break it at the earliest remaining step.
    const pick = (ready.length ? ready : pool).sort(tie)[0]
    remaining.delete(pick.id)
    topo.set(pick.id, topo.size)

    const placed = deps
      .get(pick.id)!
      .filter((d) => topo.has(d) && d !== pick.id)
      .sort((a, b) => topo.get(a)! - topo.get(b)!)
    const primary = placed[0] ?? null
    let track: string
    if (!primary) {
      if (members.get(MAIN_TRACK)!.length === 0) track = MAIN_TRACK
      else {
        track = trackKeyAt(tracks.length)
        tracks.push({ key: track, name: null, split_from_step_id: null })
        members.set(track, [])
      }
    } else {
      const pt = out.get(primary)!.track_key
      const list = members.get(pt)!
      if (list[list.length - 1] === primary) track = pt
      else {
        track = trackKeyAt(tracks.length)
        tracks.push({ key: track, name: null, split_from_step_id: primary })
        members.set(track, [])
      }
    }
    const list = members.get(track)!
    const merges = placed.slice(1).filter((d) => out.get(d)!.track_key !== track)
    out.set(pick.id, { track_key: track, order_index: list.length, merge_step_ids: merges })
    list.push(pick.id)
  }

  return { tracks, steps: out, order: tracks.flatMap((t) => members.get(t.key) ?? []) }
}

// ═══ Stored template steps → tracks ════════════════════════════════════════════

export interface StoredStepLike {
  id: string
  order_index: number
  created_at?: Date | string | null
  track_key?: string | null
  merge_step_ids?: unknown
  depends_on_step_ids?: unknown
}

export interface ResolvedTracks<T extends StoredStepLike> {
  /** Main first, then the tracks in display order (empty extra tracks left out). */
  tracks: TrackDef[]
  /** Steps in display order. */
  display: T[]
  trackOf: Map<string, string>
  /** 0-based position within the track. */
  position: Map<string, number>
  merges: Map<string, string[]>
  labels: Map<string, string>
  /** Derived dependencies (previous in track / split point, plus merges). */
  deps: Map<string, string[]>
  /** True when the template had no tracks stored and they were converted from its graph. */
  converted: boolean
}

/**
 * The tracks of a template as stored. A template whose `tracks` was never written
 * (empty) while it has steps is converted from its `depends_on_step_ids` on the fly.
 * Steps in a track that isn't listed fall into the main track (after its own steps).
 */
export function resolveStoredTracks<T extends StoredStepLike>(rawTracks: unknown, steps: T[]): ResolvedTracks<T> {
  const stored = Array.isArray(rawTracks) && rawTracks.length > 0
  let tracks: TrackDef[]
  const trackOf = new Map<string, string>()
  const merges = new Map<string, string[]>()
  const rank = new Map<string, number>()
  let converted = false

  if (!stored && steps.length) {
    const conv = convertDagToTracks(
      steps.map((s) => ({ id: s.id, order_index: s.order_index, created_at: s.created_at, depends_on: stringIds(s.depends_on_step_ids) })),
    )
    tracks = conv.tracks
    for (const [id, c] of conv.steps) {
      trackOf.set(id, c.track_key)
      merges.set(id, c.merge_step_ids)
      rank.set(id, c.order_index)
    }
    converted = true
  } else {
    tracks = readTracks(rawTracks)
    const known = new Set(tracks.map((t) => t.key))
    for (const s of steps) {
      const k = typeof s.track_key === 'string' && known.has(s.track_key) ? s.track_key : MAIN_TRACK
      trackOf.set(s.id, k)
      merges.set(s.id, stringIds(s.merge_step_ids))
      // A step moved into main from an unknown track goes after main's own steps.
      rank.set(s.id, s.track_key === k ? s.order_index : 1_000_000 + s.order_index)
    }
  }

  const ids = new Set(steps.map((s) => s.id))
  const groups = new Map<string, T[]>(tracks.map((t) => [t.key, []]))
  for (const s of steps) groups.get(trackOf.get(s.id)!)!.push(s)
  const byRank = (a: T, b: T) =>
    rank.get(a.id)! - rank.get(b.id)! || timeOf(a.created_at) - timeOf(b.created_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  for (const list of groups.values()) list.sort(byRank)

  const kept = tracks.filter((t) => t.key === MAIN_TRACK || (groups.get(t.key)?.length ?? 0) > 0)
  const display: T[] = []
  const position = new Map<string, number>()
  const labels = new Map<string, string>()
  for (const t of kept) {
    groups.get(t.key)!.forEach((s, i) => {
      display.push(s)
      position.set(s.id, i)
      labels.set(s.id, numberLabel(t.key, i))
    })
  }
  for (const [id, list] of merges) {
    merges.set(
      id,
      list.filter((m) => ids.has(m) && m !== id && trackOf.get(m) !== trackOf.get(id)),
    )
  }
  const cleanTracks = kept.map((t) => ({
    ...t,
    split_from_step_id:
      t.split_from_step_id && ids.has(t.split_from_step_id) && trackOf.get(t.split_from_step_id) !== t.key ? t.split_from_step_id : null,
  }))
  const deps = deriveDependencies(cleanTracks, groups, merges)
  return { tracks: cleanTracks, display, trackOf, position, merges, labels, deps, converted }
}

/**
 * depends_on for every step: the previous step in its track, or — for a track's first
 * step — the track's split point (none for main, or a track that starts with the
 * workflow), plus its merges. No duplicates, never itself.
 */
export function deriveDependencies<T extends { id: string }>(
  tracks: { key: string; split_from_step_id: string | null }[],
  groups: Map<string, T[]>,
  merges: Map<string, string[]>,
): Map<string, string[]> {
  const deps = new Map<string, string[]>()
  for (const t of tracks) {
    const list = groups.get(t.key) ?? []
    list.forEach((s, i) => {
      const first = i === 0 ? (t.key === MAIN_TRACK ? null : t.split_from_step_id) : list[i - 1].id
      const out: string[] = []
      if (first && first !== s.id) out.push(first)
      for (const m of merges.get(s.id) ?? []) if (m !== s.id && !out.includes(m)) out.push(m)
      deps.set(s.id, out)
    })
  }
  return deps
}

// ═══ A definition save / preview request → tracks ══════════════════════════════

export interface TrackRequest {
  key: string
  name?: string | null
  split_from_step_key?: string | null
}

export interface StepRequest {
  key: string
  title?: string | null
  track_key?: string | null
  merge_step_keys?: string[] | null
}

export type TrackProblem =
  | { kind: 'track'; track_key: string; message: string }
  | { kind: 'step'; step_key: string; message: string }
  | { kind: 'request'; message: string }

export interface PlannedTracks {
  /** Main first, then the tracks with steps, in request order. Split points are step KEYS. */
  tracks: { key: string; name: string | null; split_from: string | null }[]
  trackOf: Map<string, string>
  /** 0-based position within the track (= the step's order_index). */
  position: Map<string, number>
  merges: Map<string, string[]>
  deps: Map<string, string[]>
  labels: Map<string, string>
  /** Step keys in display order. */
  display: string[]
}

/**
 * Lay out a definition request's tracks and derive every step's dependencies. Invalid
 * references are sanitised (unknown track → main, bad split point → starts with the
 * workflow, bad merges dropped) so a preview always works; the FIRST problem found is
 * returned too, so a save can refuse it. Order of checks = order the builder reads.
 */
export function planTracks(reqTracks: TrackRequest[] | null | undefined, reqSteps: StepRequest[]): {
  plan: PlannedTracks
  problem: TrackProblem | null
} {
  let problem: TrackProblem | null = null
  const fail = (p: TrackProblem) => {
    if (!problem) problem = p
  }

  // Tracks: valid unique keys, main first.
  const defs: { key: string; name: string | null; split: string | null }[] = []
  const seen = new Set<string>()
  for (const t of reqTracks ?? []) {
    if (!t || typeof t.key !== 'string' || !TRACK_KEY_RE.test(t.key)) {
      fail({ kind: 'request', message: 'One of the paths is not valid. Reload and try again.' })
      continue
    }
    if (seen.has(t.key)) {
      fail({ kind: 'request', message: 'Each path can be listed only once.' })
      continue
    }
    seen.add(t.key)
    defs.push({
      key: t.key,
      name: cleanName(t.name),
      split: t.key !== MAIN_TRACK && typeof t.split_from_step_key === 'string' && t.split_from_step_key ? t.split_from_step_key : null,
    })
  }
  if (!seen.has(MAIN_TRACK)) defs.unshift({ key: MAIN_TRACK, name: null, split: null })
  const ordered = [defs.find((d) => d.key === MAIN_TRACK)!, ...defs.filter((d) => d.key !== MAIN_TRACK)]
  const known = new Set(ordered.map((d) => d.key))

  // Steps per track, in request order.
  const keys = new Set(reqSteps.map((s) => s.key))
  const titleOf = new Map(reqSteps.map((s) => [s.key, (s.title ?? '').trim()]))
  const trackOf = new Map<string, string>()
  const groups = new Map<string, { id: string }[]>(ordered.map((d) => [d.key, []]))
  const badTrack: string[] = []
  for (const s of reqSteps) {
    const k = s.track_key ?? MAIN_TRACK
    const tk = known.has(k) ? k : MAIN_TRACK
    if (!known.has(k)) badTrack.push(s.key)
    trackOf.set(s.key, tk)
    groups.get(tk)!.push({ id: s.key })
  }
  const kept = ordered.filter((d) => d.key === MAIN_TRACK || groups.get(d.key)!.length > 0)
  const position = new Map<string, number>()
  const labels = new Map<string, string>()
  const display: string[] = []
  for (const d of kept) {
    groups.get(d.key)!.forEach((s, i) => {
      position.set(s.id, i)
      labels.set(s.id, numberLabel(d.key, i))
      display.push(s.id)
    })
  }
  const stepName = (key: string) => stepErrorLabel(labels.get(key) ?? '?', titleOf.get(key))
  for (const k of badTrack) {
    fail({ kind: 'step', step_key: k, message: `${stepName(k)} is on a path that no longer exists. Reload and try again.` })
  }

  // Split points.
  const tracks = kept.map((d) => {
    let split = d.split
    if (split !== null) {
      const tl = trackErrorLabel({ key: d.key, name: d.name })
      if (!keys.has(split)) {
        fail({ kind: 'track', track_key: d.key, message: `${tl} starts after a step that no longer exists. Reload and try again.` })
        split = null
      } else if (trackOf.get(split) === d.key) {
        fail({ kind: 'track', track_key: d.key, message: `${tl} can’t start after one of its own steps.` })
        split = null
      }
    }
    return { key: d.key, name: d.name, split_from: split }
  })

  // Merges ("Also wait for").
  const merges = new Map<string, string[]>()
  for (const key of display) {
    const s = reqSteps.find((x) => x.key === key)!
    const list: string[] = []
    for (const m of stringIds(s.merge_step_keys ?? [])) {
      if (m === key) {
        fail({ kind: 'step', step_key: key, message: `${stepName(key)} can’t wait for itself.` })
      } else if (!keys.has(m)) {
        fail({ kind: 'step', step_key: key, message: `${stepName(key)}: “Also waits for” lists a step that no longer exists.` })
      } else if (trackOf.get(m) === trackOf.get(key)) {
        fail({ kind: 'step', step_key: key, message: `${stepName(key)}: “Also waits for” can only list steps on other paths.` })
      } else list.push(m)
    }
    merges.set(key, list)
  }

  const deps = deriveDependencies(
    tracks.map((t) => ({ key: t.key, split_from_step_id: t.split_from })),
    groups,
    merges,
  )

  // Loops: name the merge (or split) that closes it.
  const cycle = findCycle(deps, display)
  if (cycle) {
    const edges = cycle.map((from, i) => ({ from, to: cycle[(i + 1) % cycle.length] }))
    const mergeEdge = edges.find((e) => merges.get(e.from)?.includes(e.to))
    const splitEdge = edges.find((e) => {
      const t = tracks.find((x) => x.key === trackOf.get(e.from))
      return !!t && t.key !== MAIN_TRACK && t.split_from === e.to && position.get(e.from) === 0
    })
    if (mergeEdge) {
      fail({
        kind: 'step',
        step_key: mergeEdge.from,
        message: `${stepName(mergeEdge.from)} can’t also wait for ${stepName(mergeEdge.to)}. That would make a loop.`,
      })
      merges.set(mergeEdge.from, (merges.get(mergeEdge.from) ?? []).filter((m) => m !== mergeEdge.to))
    } else if (splitEdge) {
      const t = tracks.find((x) => x.key === trackOf.get(splitEdge.from))!
      fail({
        kind: 'track',
        track_key: t.key,
        message: `${trackErrorLabel(t)} can’t start after ${stepName(splitEdge.to)}. That would make a loop.`,
      })
      t.split_from = null
    } else {
      fail({ kind: 'step', step_key: edges[0].from, message: `${stepName(edges[0].from)} is part of a loop. Change what it waits for.` })
    }
  }
  const finalDeps = cycle
    ? deriveDependencies(
        tracks.map((t) => ({ key: t.key, split_from_step_id: t.split_from })),
        groups,
        merges,
      )
    : deps

  return { plan: { tracks, trackOf, position, merges, deps: finalDeps, labels, display }, problem }
}

// ═══ Runs: labels from the snapshots (legacy runs: converted) ═════════════════

export interface RunRowLike {
  id: string
  order_index: number
  created_at?: Date | string | null
  track_key?: string | null
  track_name?: string | null
  number_label?: string | null
}

/**
 * Each row's track and number label, and the run's tracks (lanes) in order. Rows whose
 * snapshot carries them use them; a run where any row lacks them (written before
 * tracks) is converted from its row dependencies with the same converter.
 */
export function runTracks(
  rows: RunRowLike[],
  deps: Map<string, string[]>,
): { trackOf: Map<string, string>; labels: Map<string, string>; tracks: { key: string; label: string }[] } {
  const trackOf = new Map<string, string>()
  const labels = new Map<string, string>()
  const sorted = rows.slice().sort((a, b) => a.order_index - b.order_index || timeOf(a.created_at) - timeOf(b.created_at))
  const complete = sorted.length > 0 && sorted.every((r) => !!r.track_key && TRACK_KEY_RE.test(r.track_key) && !!r.number_label)
  const names = new Map<string, string | null>()
  if (complete) {
    for (const r of sorted) {
      trackOf.set(r.id, r.track_key!)
      labels.set(r.id, r.number_label!)
      if (!names.has(r.track_key!)) names.set(r.track_key!, cleanName(r.track_name))
    }
  } else {
    const conv = convertDagToTracks(
      sorted.map((r) => ({ id: r.id, order_index: r.order_index, created_at: r.created_at, depends_on: deps.get(r.id) ?? [] })),
    )
    for (const [id, c] of conv.steps) {
      trackOf.set(id, c.track_key)
      labels.set(id, numberLabel(c.track_key, c.order_index))
    }
    for (const t of conv.tracks) names.set(t.key, null)
    return {
      trackOf,
      labels,
      tracks: conv.tracks.filter((t) => t.key === MAIN_TRACK || [...trackOf.values()].includes(t.key)).map((t) => ({ key: t.key, label: trackLabel(t) })),
    }
  }
  // Lanes in the order their steps come (rows are stored in display order); main first.
  const order = [...new Set([MAIN_TRACK, ...sorted.map((r) => trackOf.get(r.id)!)])]
  return { trackOf, labels, tracks: order.map((key) => ({ key, label: trackLabel({ key, name: names.get(key) ?? null }) })) }
}
