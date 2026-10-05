'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { tasksApi, tagErrorMessage } from '@/lib/api/tasks'
import type { TaskTag } from '@/lib/types/tasks'

/**
 * The org's tag list, shared by every picker, filter and chip on the page.
 *
 * One module-level cache per org + includeInactive, so ten pickers mean one request.
 * Concurrent loads share one in-flight promise. Every mounted hook subscribes, so a
 * tag created (or reactivated, renamed, merged…) anywhere shows up everywhere.
 *
 * Freshness (stale-while-revalidate): a cached list older than STALE_MS is still served
 * at once, and a mounting hook refetches it in the background and swaps the result in
 * place — no skeleton, no flicker. So tags other people created appear on the next
 * picker that opens. Pass `ensureIds` to also refetch (once per id) when a value names a
 * tag the list doesn't have yet.
 *
 * Loading and failed are separate branches (kit §14.3): `loading` is true only while
 * there is no list yet and a request is running; a failed request with no list to fall
 * back on sets `error` and stops loading, and `reload()` retries. A failed background
 * refresh keeps the list it had, silently.
 */

type Key = string
const keyOf = (orgId: string, includeInactive: boolean): Key => `${orgId}|${includeInactive ? 'all' : 'active'}`

/** A cached list older than this is refetched (in the background) by the next hook that mounts. */
const STALE_MS = 60_000

interface Entry {
  list: TaskTag[]
  at: number
}

const cache = new Map<Key, Entry>()
const inflight = new Map<Key, Promise<TaskTag[]>>()
const listeners = new Map<Key, Set<() => void>>()
/**
 * Bumped whenever the cache is invalidated or patched while a request is in flight, so
 * that request's (older) result never lands over the newer state: it fetches again.
 */
const generation = new Map<Key, number>()
/** Ids `ensureIds` already refetched for and still didn't find — never retried. */
const ensured = new Map<Key, Set<string>>()

const genOf = (key: Key) => generation.get(key) ?? 0
const bump = (key: Key) => generation.set(key, genOf(key) + 1)

function notify(key: Key) {
  listeners.get(key)?.forEach((fn) => fn())
}

function subscribe(key: Key, fn: () => void): () => void {
  let set = listeners.get(key)
  if (!set) listeners.set(key, (set = new Set()))
  set.add(fn)
  return () => {
    set!.delete(fn)
  }
}

const byName = (a: TaskTag, b: TaskTag) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

/** Fetch the list (joining a request already in flight) and cache it. */
function fetchTags(orgId: string, includeInactive: boolean): Promise<TaskTag[]> {
  const key = keyOf(orgId, includeInactive)
  const existing = inflight.get(key)
  if (existing) return existing
  const gen = genOf(key)
  const req: Promise<TaskTag[]> = tasksApi.getTags(orgId, { includeInactive }).then(
    (tags) => {
      if (inflight.get(key) === req) inflight.delete(key)
      // Invalidated or patched while this was in flight: its list predates that change,
      // so don't cache it — fetch again (joining any newer request) and hand that back.
      if (genOf(key) !== gen) return fetchTags(orgId, includeInactive)
      const sorted = [...tags].sort(byName)
      cache.set(key, { list: sorted, at: Date.now() })
      notify(key)
      return sorted
    },
    (err) => {
      if (inflight.get(key) === req) inflight.delete(key)
      throw err
    },
  )
  inflight.set(key, req)
  return req
}

/**
 * Put a created / updated / reactivated tag into every cached list for its org (the
 * active-only list drops it if it is inactive) and refresh every subscriber.
 */
export function upsertCachedTag(orgId: string, tag: TaskTag): void {
  for (const includeInactive of [false, true]) {
    const key = keyOf(orgId, includeInactive)
    // A request in flight started before this change: don't let it overwrite it.
    if (inflight.has(key)) bump(key)
    const entry = cache.get(key)
    if (!entry) continue
    const without = entry.list.filter((t) => t.id !== tag.id)
    const next = includeInactive || tag.is_active ? [...without, tag].sort(byName) : without
    cache.set(key, { list: next, at: entry.at })
    notify(key)
  }
}

/** Drop a deleted or merged-away tag from every cached list for its org. */
export function removeCachedTag(orgId: string, tagId: string): void {
  for (const includeInactive of [false, true]) {
    const key = keyOf(orgId, includeInactive)
    if (inflight.has(key)) bump(key)
    const entry = cache.get(key)
    if (!entry) continue
    cache.set(key, { list: entry.list.filter((t) => t.id !== tagId), at: entry.at })
    notify(key)
  }
}

/**
 * Forget the org's cached tag lists and refetch for every mounted hook — call it after
 * a bulk change (e.g. a merge that also changes usage counts). A request already in
 * flight is abandoned: its result is never cached. Mounted hooks keep showing what they
 * had until the fresh list lands (no skeleton).
 */
export function invalidateTaskTags(orgId: string): void {
  for (const includeInactive of [false, true]) {
    const key = keyOf(orgId, includeInactive)
    bump(key)
    cache.delete(key)
    inflight.delete(key)
    ensured.delete(key)
    notify(key)
  }
}

export interface UseTaskTags {
  /** Sorted by name. Empty while loading or after a failed load. */
  tags: TaskTag[]
  /** True only while there is no list yet and a request is running. */
  loading: boolean
  /** The failed-load message, or null. Show "Couldn't load tags · Retry" and call reload(). */
  error: string | null
  /**
   * True while an `ensureIds` refetch is running for an id the list doesn't have — show
   * "…" rather than "unknown" for it until this settles.
   */
  resolving: boolean
  /** Refetch (also the Retry for the failed state). Keeps showing the current list meanwhile. */
  reload: () => Promise<void>
  /**
   * Create a tag (or get the existing active one with the same name) and insert it into
   * the shared cache. Resolves with the tag.
   * @throws TagConflictError (from `@/lib/api/tasks`) when the name matches a
   *   deactivated tag; it carries the existing tag's id. Other failures throw the API
   *   error — read it with `tagErrorMessage(e)`.
   */
  createTag: (name: string) => Promise<TaskTag>
}

export interface UseTaskTagsOptions {
  includeInactive?: boolean
  /**
   * Ids the caller is about to show (a field's value, the URL's filter). When the loaded
   * list lacks one — e.g. a tag someone else created after this list was cached — the
   * hook refetches once for it. An id still missing after that is not retried.
   */
  ensureIds?: readonly string[]
}

export function useTaskTags(orgId: string | null | undefined, opts: UseTaskTagsOptions = {}): UseTaskTags {
  const includeInactive = !!opts.includeInactive
  const key = orgId ? keyOf(orgId, includeInactive) : ''
  const [tags, setTags] = useState<TaskTag[]>(() => (key ? cache.get(key)?.list ?? [] : []))
  const [loading, setLoading] = useState<boolean>(() => !!key && !cache.has(key))
  const [error, setError] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)
  // Whether this hook has a list on screen — a refresh then never shows a skeleton or error.
  const hasListRef = useRef<boolean>(!!key && cache.has(key))
  const resolvingCount = useRef(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const load = useCallback(
    async (mode: 'mount' | 'force' | 'refill') => {
      if (!orgId) return
      const k = keyOf(orgId, includeInactive)
      const entry = cache.get(k)
      if (entry) {
        setTags(entry.list)
        hasListRef.current = true
        setLoading(false)
        setError(null)
        // Fresh enough, and not asked to refetch: done.
        if (mode !== 'force' && Date.now() - entry.at < STALE_MS) return
      }
      if (!hasListRef.current) setLoading(true)
      try {
        const list = await fetchTags(orgId, includeInactive)
        // Other subscribers learn through fetchTags' notify; this one sets directly.
        setTags(list)
        hasListRef.current = true
        setError(null)
      } catch (e) {
        if (!hasListRef.current) setError(tagErrorMessage(e, "Couldn't load tags"))
      } finally {
        setLoading(false)
      }
    },
    [orgId, includeInactive],
  )

  // Initial load (or background refresh of a stale list), and follow org changes.
  useEffect(() => {
    if (!key) {
      setTags([])
      setLoading(false)
      setError(null)
      hasListRef.current = false
      return
    }
    const entry = cache.get(key)
    hasListRef.current = !!entry
    if (entry) setTags(entry.list)
    else setTags([])
    void load('mount')
  }, [key, load])

  // Stay in step with every other hook on the same list.
  useEffect(() => {
    if (!key) return
    return subscribe(key, () => {
      const entry = cache.get(key)
      if (entry) {
        setTags(entry.list)
        hasListRef.current = true
        setError(null)
        setLoading(false)
      } else {
        // Invalidated elsewhere: fetch again (deduped across subscribers), keeping the
        // current list on screen until the new one lands.
        void load('refill')
      }
    })
  }, [key, load])

  const reload = useCallback(() => load('force'), [load])

  // Refetch once when a value names a tag the list doesn't have.
  const ensureSig = (opts.ensureIds ?? []).join(',')
  useEffect(() => {
    if (!key || !orgId || !ensureSig || loading || error) return
    const known = new Set(tags.map((t) => t.id))
    let tried = ensured.get(key)
    if (!tried) ensured.set(key, (tried = new Set()))
    const missing = ensureSig.split(',').filter((id) => id && !known.has(id) && !tried!.has(id))
    if (!missing.length) return
    missing.forEach((id) => tried!.add(id))
    resolvingCount.current += 1
    setResolving(true)
    void load('force').finally(() => {
      resolvingCount.current -= 1
      if (mounted.current && resolvingCount.current === 0) setResolving(false)
    })
    // `tags` is read for the check; re-running on its change is what we want.
  }, [key, orgId, ensureSig, tags, loading, error, load])

  const createTag = useCallback(
    async (name: string): Promise<TaskTag> => {
      if (!orgId) throw new Error('No organisation selected')
      const tag = await tasksApi.createTag(orgId, { name: name.trim() })
      upsertCachedTag(orgId, tag)
      // If this hook's list was never cached (e.g. it failed), still show the new tag here.
      if (!cache.has(keyOf(orgId, includeInactive))) {
        setTags((prev) => [...prev.filter((t) => t.id !== tag.id), tag].sort(byName))
      }
      return tag
    },
    [orgId, includeInactive],
  )

  return { tags, loading, error, resolving, reload, createTag }
}

export default useTaskTags
