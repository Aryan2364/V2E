"use client"

import * as React from "react"

/**
 * Section 41.4 rule 5 - the records a person opened lately, for the phone
 * search page: before anything is typed it lists the last 10 records the
 * person opened, newest first.
 *
 *   // On a record page, once it has loaded:
 *   useRememberRecord({ person: me.id, href, title: customer.name, kind: "Customer" })
 *   // or, from an event: rememberRecord({ person, href, title, kind })
 *
 *   // On the search page:
 *   const recent = useRecentRecords(me.id)
 *
 *   // On sign out, with the person's drafts (41.7 rule 15):
 *   clearRecentRecords(me.id)
 *
 * WHERE. The browser's localStorage, one entry per person:
 * `recent|<person>`. Never shared between people on one phone, never sent
 * anywhere. It is a convenience of this browser (the person's other phone
 * or computer has its own), so nothing depends on it being there.
 *
 * WHAT IS KEPT. The last 10, newest first, one entry per address: opening
 * a record already in the list moves it to the top, with its title as it
 * is now (a renamed record shows its new name). Only what a row needs: the
 * address, the title and the kind of record ("Customer", "Order"). No
 * amounts and no other details, which may be private (the same care as a
 * lock-screen notification, 41.12 rule 3).
 *
 * WHAT A RECORD THE PERSON CAN NO LONGER OPEN DOES. Its row stays until
 * it falls off the end; opening it shows what the address shows anyone
 * outside its scope, "Page not found" (26.6 rule 5). The list never tells
 * the browser anything the server has not already shown this person.
 *
 * STORAGE THAT FAILS NEVER BREAKS ANYTHING. Every read and write is in
 * try/catch: storage that cannot be read lists nothing, a write that
 * fails (private browsing, a full quota) is skipped, and a stored value
 * that is not what this file wrote is ignored.
 *
 * BOTH LAYOUTS. A record is remembered whichever layout opened it, so a
 * foldable folded mid-use, or a computer and phone sharing one browser
 * profile, still finds it. Only the phone shows the list.
 */

/** 41.4 rule 5: the last 10. */
const RECENT_MAX = 10

const PREFIX = "recent|"

type RecentRecord = {
  /** The record's address: also what makes two entries the same record. */
  href: string
  /** The record's name as the record shows it: "Halcyon Supplies", "ORD-2140". */
  title: string
  /** The kind of record, a singular noun in sentence case (37.1): "Customer". */
  kind: string
}

type RememberedRecord = RecentRecord & {
  /** Whose list this goes in: the signed-in person's id (the demo uses the name). */
  person: string
}

type Stored = { v: 1; items: RecentRecord[] }

const NONE: readonly RecentRecord[] = Object.freeze([])

// Encoded, as drafts are (lib/drafts.ts), so no person's key can be
// another's prefix.
function keyFor(person: string): string {
  return `${PREFIX}${encodeURIComponent(person)}`
}

function store(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is RecentRecord {
  if (!value || typeof value !== "object") return false
  const v = value as Partial<RecentRecord>
  return (
    typeof v.href === "string" &&
    v.href !== "" &&
    typeof v.title === "string" &&
    typeof v.kind === "string"
  )
}

/** The person's list as stored, or none. Never throws. */
function parse(raw: string | null): RecentRecord[] {
  if (!raw) return []
  try {
    const value = JSON.parse(raw) as Partial<Stored>
    if (value?.v !== 1 || !Array.isArray(value.items)) return []
    return value.items.filter(isRecord).slice(0, RECENT_MAX)
  } catch {
    return []
  }
}

function read(person: string): string | null {
  try {
    return store()?.getItem(keyFor(person)) ?? null
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------
   The listeners. A write in this tab tells this tab's lists at once;
   the browser's storage event tells the other tabs.
   ------------------------------------------------------------------ */

const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((listener) => listener())
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  const onStorage = (event: StorageEvent) => {
    // null: the whole storage was cleared.
    if (event.key === null || event.key.startsWith(PREFIX)) onChange()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener("storage", onStorage)
  }
}

/**
 * Puts a record at the top of the person's recent list (41.4 rule 5):
 * newest first, one entry per address, the last 10. Call it when a record
 * opens; useRememberRecord does it from a record page. Never throws.
 */
function rememberRecord({ person, href, title, kind }: RememberedRecord): void {
  const s = store()
  if (!s || href === "") return
  const key = keyFor(person)
  try {
    const before = parse(s.getItem(key))
    const items = [
      { href, title, kind },
      ...before.filter((item) => item.href !== href),
    ].slice(0, RECENT_MAX)
    const next = JSON.stringify({ v: 1, items } satisfies Stored)
    if (next === JSON.stringify({ v: 1, items: before } satisfies Stored)) return
    s.setItem(key, next)
  } catch {
    // Private browsing or a full quota: the list simply is not updated.
    return
  }
  notify()
}

/** Forgets the person's recent records: on sign out. Never throws. */
function clearRecentRecords(person: string): void {
  try {
    store()?.removeItem(keyFor(person))
  } catch {
    return
  }
  notify()
}

/**
 * Remembers a record when its page opens, and again if the address or the
 * title changes while it is open. Pass null while the record is not
 * loaded or was not found: nothing is remembered.
 */
function useRememberRecord(record: RememberedRecord | null): void {
  const person = record?.person
  const href = record?.href
  const title = record?.title
  const kind = record?.kind
  React.useEffect(() => {
    if (person === undefined || href === undefined || title === undefined || kind === undefined) {
      return
    }
    rememberRecord({ person, href, title, kind })
  }, [person, href, title, kind])
}

/**
 * One parsed list per person and stored string, so a snapshot keeps its
 * identity until the stored value actually changes: useSyncExternalStore
 * compares by reference, and re-renders for ever on a fresh array.
 */
const snapshots = new Map<string, { raw: string | null; items: readonly RecentRecord[] }>()

function snapshotFor(person: string): readonly RecentRecord[] {
  const raw = read(person)
  const last = snapshots.get(person)
  if (last && last.raw === raw) return last.items
  const items = raw === null ? NONE : parse(raw)
  snapshots.set(person, { raw, items })
  return items
}

/**
 * The person's recent records, newest first, at most 10. Empty on the
 * server and while hydrating (the server cannot read this browser's
 * storage), then the stored list: the search page shows the list's
 * heading only once it has something to show.
 */
function useRecentRecords(person: string): readonly RecentRecord[] {
  const getSnapshot = React.useCallback(() => snapshotFor(person), [person])
  return React.useSyncExternalStore(subscribe, getSnapshot, () => NONE)
}

export { rememberRecord, useRememberRecord, useRecentRecords, clearRecentRecords, RECENT_MAX }
export type { RecentRecord, RememberedRecord }
