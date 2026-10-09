/**
 * Tracks, client side — the same rules the server applies on save (backend
 * src/workflows/tracks.ts):
 *
 *  - Steps live in tracks. The Main track ('main') always exists; other tracks are keyed
 *    B, C, D… in creation order (stable once saved).
 *  - Within a track the order is fixed: each step waits for the one before it.
 *  - A track other than main starts after the step it splits from ("Split here"), or —
 *    when that is null — when the workflow starts.
 *  - A step may also wait for steps in other tracks ("Also wait for" = a merge).
 *  - Numbering: main 1, 2, 3…; track B's steps B1, B2…
 *
 * The builder works on a flat step list: a step's position in its track is its order
 * among that track's steps in the list.
 */

import type { RunTrack, WorkflowInstanceStep, WorkflowStep, WorkflowTrack } from '@/lib/types/workflows'

export const MAIN_TRACK = 'main'
export const TRACK_NAME_MAX = 40

/** A track as the builder edits it. `split_from` is a step id (or a client key). */
export interface TrackDraft {
  key: string
  name: string
  split_from: string | null
}

/** The key of the n-th extra track (1 → 'B', 25 → 'Z', 26 → 'AA', …). */
export function trackKeyAt(n: number): string {
  let x = Math.max(1, Math.trunc(n)) + 1
  let out = ''
  while (x > 0) {
    const r = (x - 1) % 26
    out = String.fromCharCode(65 + r) + out
    x = Math.floor((x - 1) / 26)
  }
  return out
}

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
  for (const k of Array.from(keys)) max = Math.max(max, trackIndexOf(k))
  return trackKeyAt(max + 1)
}

/** "Main path" / "Path B" — a track's fixed name on screen (tracks are called paths). */
export function trackBaseLabel(key: string): string {
  return key === MAIN_TRACK ? 'Main path' : `Path ${key}`
}

/** A server label frozen before tracks were called paths ("Main track", "Track B") → today's word. */
export function pathWord(label: string): string {
  if (label === 'Main track') return 'Main path'
  return label.replace(/^Track ([A-Z]{1,3})$/, 'Path $1')
}

/** "Main path", its name, or "Path B". */
export function trackLabel(t: { key: string; name?: string | null }): string {
  return t.name?.trim() || trackBaseLabel(t.key)
}

/** "1", "2" on main; "B1", "B2" on track B. `position` is 0-based. */
export function numberLabel(trackKey: string, position: number): string {
  return trackKey === MAIN_TRACK ? `${position + 1}` : `${trackKey}${position + 1}`
}

/** "Step B2 “Sign-off”" (or "Step B2"). */
export function stepName(label: string | null | undefined, title: string | null | undefined): string {
  const t = (title ?? '').trim()
  return `Step ${label ?? '?'}${t ? ` “${t}”` : ''}`
}

export const trackOfStep = (s: Pick<WorkflowStep, 'track_key'>): string => s.track_key || MAIN_TRACK

/** Server tracks → drafts (main first, always present). */
export function tracksFromServer(tracks: WorkflowTrack[] | undefined | null): TrackDraft[] {
  const out: TrackDraft[] = []
  const seen = new Set<string>()
  for (const t of tracks ?? []) {
    if (!t?.key || seen.has(t.key)) continue
    seen.add(t.key)
    out.push({ key: t.key, name: t.name ?? '', split_from: t.key === MAIN_TRACK ? null : t.split_from_step_id ?? null })
  }
  const main = out.find((t) => t.key === MAIN_TRACK) ?? { key: MAIN_TRACK, name: '', split_from: null }
  return [main, ...out.filter((t) => t.key !== MAIN_TRACK)]
}

export interface TrackLayout {
  tracks: TrackDraft[]
  /** Steps per track, in order. */
  groups: Map<string, WorkflowStep[]>
  trackOf: Map<string, string>
  /** "1", "B2". */
  labels: Map<string, string>
  /** Display index (tracks in order, each in its own order). */
  order: Map<string, number>
  /** Steps in display order. */
  display: WorkflowStep[]
  /** What each step waits for: the step before it in its track (or its track's split step), plus its merges. */
  deps: Map<string, string[]>
  /** Its valid merges (steps in other tracks that exist). */
  merges: Map<string, string[]>
  /** What each step waits for through its path alone: the step before it, or its track's split step. */
  pathDeps: Map<string, string[]>
  /**
   * Merges a step already waits for through its path order or split point (and so add
   * nothing): kept on screen with a note, left out of what is saved.
   */
  redundant: Map<string, string[]>
}

/**
 * Lay out steps in their tracks. `steps` order decides each step's position in its
 * track; a step whose track isn't listed counts as main.
 */
export function layoutTracks(tracks: TrackDraft[], steps: WorkflowStep[]): TrackLayout {
  const list = tracks.length ? tracks : [{ key: MAIN_TRACK, name: '', split_from: null }]
  const known = new Set(list.map((t) => t.key))
  const groups = new Map<string, WorkflowStep[]>(list.map((t) => [t.key, []]))
  const trackOf = new Map<string, string>()
  for (const s of steps) {
    const k = known.has(trackOfStep(s)) ? trackOfStep(s) : MAIN_TRACK
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(s)
    trackOf.set(s.id, k)
  }
  const ids = new Set(steps.map((s) => s.id))
  const labels = new Map<string, string>()
  const order = new Map<string, number>()
  const display: WorkflowStep[] = []
  for (const t of list) {
    ;(groups.get(t.key) ?? []).forEach((s, i) => {
      labels.set(s.id, numberLabel(t.key, i))
      order.set(s.id, display.length)
      display.push(s)
    })
  }
  const merges = new Map<string, string[]>()
  for (const s of steps) {
    merges.set(
      s.id,
      Array.from(new Set(s.merge_step_ids ?? [])).filter((m) => m !== s.id && ids.has(m) && trackOf.get(m) !== trackOf.get(s.id)),
    )
  }
  const deps = new Map<string, string[]>()
  const pathDeps = new Map<string, string[]>()
  for (const t of list) {
    const g = groups.get(t.key) ?? []
    g.forEach((s, i) => {
      const split = t.key !== MAIN_TRACK && t.split_from && ids.has(t.split_from) && trackOf.get(t.split_from) !== t.key ? t.split_from : null
      const first = i === 0 ? split : g[i - 1].id
      const out: string[] = []
      if (first) out.push(first)
      pathDeps.set(s.id, [...out])
      for (const m of merges.get(s.id) ?? []) if (!out.includes(m)) out.push(m)
      deps.set(s.id, out)
    })
  }
  const redundant = new Map<string, string[]>()
  merges.forEach((list, id) => {
    if (!list.length) return
    const up = upstreamOf(pathDeps.get(id) ?? [], deps, id)
    const r = list.filter((m) => up.has(m))
    if (r.length) redundant.set(id, r)
  })
  return { tracks: list, groups, trackOf, labels, order, display, deps, merges, pathDeps, redundant }
}

/**
 * Everything a step waits for, directly or not, starting from `from` (its path
 * dependency): those steps and all that is upstream of them, through every step's own
 * merges too. `selfId` (the step asking) is never included, so its own merges — and
 * any loop back to it — don't count.
 */
export function upstreamOf(from: string[], deps: Map<string, string[]>, selfId: string | null): Set<string> {
  const out = new Set<string>()
  const stack = [...from]
  while (stack.length) {
    const d = stack.pop()!
    if (d === selfId || out.has(d)) continue
    out.add(d)
    stack.push(...(deps.get(d) ?? []))
  }
  return out
}

/** A step's merges as saved: the redundant ones (see `TrackLayout.redundant`) left out. */
export function savedMerges(layout: Pick<TrackLayout, 'merges' | 'redundant'>, id: string): string[] {
  const drop = layout.redundant.get(id) ?? []
  return (layout.merges.get(id) ?? []).filter((m) => !drop.includes(m))
}

/** Server steps (each with track_key + order_index) in display order for these tracks. */
export function orderByTracks(tracks: TrackDraft[], steps: WorkflowStep[]): WorkflowStep[] {
  const rank = new Map(tracks.map((t, i) => [t.key, i]))
  return steps
    .slice()
    .sort(
      (a, b) =>
        (rank.get(trackOfStep(a)) ?? 0) - (rank.get(trackOfStep(b)) ?? 0) ||
        a.order_index - b.order_index ||
        a.created_at.localeCompare(b.created_at),
    )
}

/** Every step that (directly or not) waits for `id`. */
export function dependentsOf(id: string, deps: Map<string, string[]>): Set<string> {
  const children = new Map<string, string[]>()
  deps.forEach((ds, sid) => ds.forEach((d) => children.set(d, [...(children.get(d) ?? []), sid])))
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

/** The first loop found, as ids where each waits for the next, or null. */
export function findLoop(deps: Map<string, string[]>, order: string[]): string[] | null {
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
  for (const id of order) {
    const c = visit(id)
    if (c) return c
  }
  return null
}

// ─── Runs ─────────────────────────────────────────────────────────────────────

/**
 * A run's lanes and each row's label. Rows from the server carry `track_key` and
 * `number_label`; an older server sends neither — then everything is one lane numbered
 * in order.
 */
export function runLayout(
  rows: WorkflowInstanceStep[],
  tracks: RunTrack[] | undefined,
): { lanes: RunTrack[]; laneOf: Map<string, string>; labels: Map<string, string> } {
  const labels = new Map<string, string>()
  const laneOf = new Map<string, string>()
  const known = new Set((tracks ?? []).map((t) => t.key))
  rows.forEach((r, i) => {
    labels.set(r.id, r.number_label || `${i + 1}`)
    laneOf.set(r.id, r.track_key && (known.has(r.track_key) || !tracks?.length) ? r.track_key : MAIN_TRACK)
  })
  const lanes: RunTrack[] = tracks?.length ? tracks.map((t) => ({ ...t, label: pathWord(t.label) })) : [{ key: MAIN_TRACK, label: 'Main path' }]
  return { lanes, laneOf, labels }
}
