'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus } from 'lucide-react'
import TagChip from '@/components/ui/TagChip'
import TagPicker from '@/components/tasks/TagPicker'
import PermissionTooltip from '@/components/ui/PermissionTooltip'
import { useToast } from '@/components/ui/Toast'
import { tasksApi, tagErrorMessage } from '@/lib/api/tasks'
import { useTaskTags } from '@/lib/tasks/useTaskTags'
import type { Task, TaskTagRef } from '@/lib/types/tasks'

// useLayoutEffect warns during server rendering; measure with it only in the browser.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

/**
 * True while a searchable picker (MultiSelect, e.g. the Tags field) has its list open.
 * A form's or drawer's own Escape handler checks this first, so Escape inside the
 * picker closes only the picker (kit §16.4) — not the whole form.
 */
export function isListboxOpen(): boolean {
  if (typeof document === 'undefined') return false
  return !!document.querySelector('[aria-haspopup="listbox"][aria-expanded="true"]')
}

interface InlineTaskTagsProps {
  orgId: string
  taskId: string
  /** The task's tags as last loaded. */
  tags: TaskTagRef[] | null | undefined
  /**
   * true: "+ Add tag" and a ✕ on each chip. false: read-only chips ("No tags" when
   * empty) and "+ Add tag" disabled with its reason. undefined (permissions still
   * loading): chips without ✕ and "+ Add tag" disabled with no reason (kit §26.1).
   */
  canEdit: boolean | undefined
  /** Called with the saved task, so the parent can update in place (no reload, no flicker). */
  onUpdated?: (task: Task) => void
  className?: string
}

/** A rule about this record (kit §26.2): who may edit the task may change its tags. */
const EDIT_TAGS_REASON = 'Only people who can edit this task can change its tags.'
const POPOVER_WIDTH = 320
const GAP = 6
const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i])

/**
 * A task's tags on its detail page or drawer, editable in place. Tagging is a triage
 * action, so it saves straight away rather than going through the Edit form:
 *
 * - "+ Add tag" opens the shared TagPicker in a small popover (portalled to <body>, so
 *   no card or drawer clips it). It closes on a press outside, Escape (focus returns to
 *   the button), scroll or resize.
 * - Each change — picking, unpicking, creating a tag, or a chip's ✕ — saves the full
 *   list via updateTask({ tag_ids }) optimistically. Saves run one at a time, and only
 *   the latest wanted list is sent, so quick clicks never race.
 * - A refused save (e.g. 403 from a scope the browser could not see) rolls back to the
 *   last saved list and shows the server's reason in a toast.
 */
export function InlineTaskTags({ orgId, taskId, tags, canEdit, onUpdated, className = '' }: InlineTaskTagsProps) {
  const { addToast } = useToast()
  // Same cached list the picker reads, so a just-picked or just-created tag has its chip.
  const { tags: master } = useTaskTags(canEdit ? orgId : null, { includeInactive: true })

  // `confirmed`: the tags as last saved (or loaded). `pendingIds`: the list the user
  // wants while a save is in flight — rendered optimistically, null when idle.
  const [confirmed, setConfirmed] = useState<TaskTagRef[]>(tags ?? [])
  const [pendingIds, setPendingIds] = useState<string[] | null>(null)
  const confirmedRef = useRef<TaskTagRef[]>(tags ?? [])
  const wantedRef = useRef<string[] | null>(null)
  const savingRef = useRef(false)
  const [saving, setSaving] = useState(false)

  // Follow the parent's copy when it changes — but never over an edit in flight.
  useEffect(() => {
    if (savingRef.current || wantedRef.current) return
    confirmedRef.current = tags ?? []
    setConfirmed(tags ?? [])
  }, [tags])

  const ids = useMemo(() => pendingIds ?? confirmed.map((t) => t.id), [pendingIds, confirmed])
  // Resolved at render, so a tag created a moment ago gets its chip as soon as the
  // shared cache has it.
  const shown = useMemo<TaskTagRef[]>(() => {
    if (!pendingIds) return confirmed
    return pendingIds
      .map((id) => {
        const known = confirmed.find((t) => t.id === id) ?? (tags ?? []).find((t) => t.id === id)
        if (known) return known
        const m = master.find((t) => t.id === id)
        return m ? { id: m.id, name: m.name, color: m.color, is_active: m.is_active } : undefined
      })
      .filter((t): t is TaskTagRef => !!t)
  }, [pendingIds, confirmed, tags, master])
  const shownRef = useRef(shown)
  shownRef.current = shown
  // The task's own refs, so the picker can chip a tag its (cached) org list lacks.
  const knownRefs = useMemo<TaskTagRef[]>(() => {
    const m = new Map<string, TaskTagRef>()
    for (const t of tags ?? []) m.set(t.id, t)
    for (const t of confirmed) m.set(t.id, t)
    return Array.from(m.values())
  }, [tags, confirmed])

  const flush = useCallback(async () => {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      while (wantedRef.current) {
        const next = wantedRef.current
        wantedRef.current = null
        try {
          const updated = await tasksApi.updateTask(orgId, taskId, { tag_ids: next })
          // The contract returns `tags`; fall back to what is on screen if it doesn't.
          confirmedRef.current = updated.tags ?? shownRef.current
          setConfirmed(confirmedRef.current)
          // A newer change is already queued: keep showing it, send it next.
          if (!wantedRef.current) setPendingIds(null)
          // Tell the parent after EVERY confirmed save, not only the last one: if a later
          // queued save fails, the parent must already hold what the server has now.
          onUpdated?.({ ...updated, tags: confirmedRef.current })
        } catch (e) {
          // Roll back to the last saved list and drop anything queued behind it.
          wantedRef.current = null
          setConfirmed(confirmedRef.current)
          setPendingIds(null)
          addToast(tagErrorMessage(e, 'Couldn’t update this task’s tags. Try again.'), 'error')
          break
        }
      }
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [orgId, taskId, onUpdated, addToast])

  const change = useCallback(
    (next: string[]) => {
      if (sameIds(next, ids)) return
      setPendingIds(next)
      wantedRef.current = next
      void flush()
    },
    [ids, flush],
  )

  // ── Popover ──────────────────────────────────────────────────────────────────
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const width = Math.min(POPOVER_WIDTH, window.innerWidth - 16)
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8)
    setPos({ left, top: r.bottom + GAP })
  }, [])

  const close = useCallback((refocus = false) => {
    setOpen(false)
    if (refocus) btnRef.current?.focus()
  }, [])

  useIsoLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  // Open the picker's list straight away — "+ Add tag" means "show me the tags".
  useEffect(() => {
    if (!open || !pos) return
    const field = popRef.current?.querySelector<HTMLElement>('[aria-haspopup="listbox"]')
    if (field && field.getAttribute('aria-expanded') !== 'true') field.click()
  }, [open, pos])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return
      close()
    }
    // Capture on window: runs before the drawer's / page's own Escape handlers, and
    // stops them, so Escape closes only this popover.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close(true)
    }
    const onScroll = (e: Event) => {
      if (popRef.current && e.target instanceof Node && popRef.current.contains(e.target)) return
      close()
    }
    const onResize = () => close()
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open, close])

  // Lost edit rights while open (e.g. permissions refreshed): close.
  useEffect(() => {
    if (canEdit !== true) setOpen(false)
  }, [canEdit])

  const editable = canEdit === true

  return (
    <div className={`flex flex-wrap items-center gap-1.5 min-w-0 ${className}`} aria-busy={saving || undefined}>
      {shown.length === 0 && <span className="text-sm text-helper">No tags</span>}
      {shown.map((t) => (
        <TagChip
          key={t.id}
          tag={t}
          size="md"
          className="min-w-0"
          onRemove={editable ? () => change(ids.filter((id) => id !== t.id)) : undefined}
        />
      ))}
      {/* Always present, so nothing moves when the permission answer lands (kit §26.1):
          disabled with no reason while it is unknown, disabled with its reason when no. */}
      <PermissionTooltip allowed={canEdit} reason={EDIT_TAGS_REASON}>
        <button
          ref={btnRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={!editable}
          onClick={() => setOpen((o) => !o)}
          // Touch screens get a 44px tap area without the button looking any bigger (kit §9.4).
          className="relative after:absolute after:-inset-[10px] after:content-[''] [@media(pointer:fine)]:after:hidden inline-flex items-center gap-1 h-6 pl-1.5 pr-2.5 rounded-full border border-dashed border-input bg-white text-[13px] font-medium text-primary hover:border-primary hover:bg-primary-light focus:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-colors disabled:pointer-events-none disabled:text-muted disabled:border-border disabled:bg-white"
        >
          <Plus size={13} strokeWidth={2.5} aria-hidden="true" />
          Add tag
        </button>
      </PermissionTooltip>
      {open &&
        pos &&
        typeof document !== 'undefined' &&
        createPortal(
          // z-78: above modals and drawers (z-60 / z-75), below Tooltip (z-80). No
          // overflow clipping here: the picker's list hangs below the field.
          <div
            ref={popRef}
            role="dialog"
            aria-label="Edit tags"
            className="fixed z-[78] rounded-lg border border-border bg-white p-3 shadow-[0_8px_28px_rgba(0,0,0,0.14)] animate-[popIn_.15s_ease-out]"
            style={{ left: pos.left, top: pos.top, width: Math.min(POPOVER_WIDTH, window.innerWidth - 16) }}
          >
            <p className="mb-1.5 text-sm font-medium text-label">Tags</p>
            <TagPicker orgId={orgId} value={ids} onChange={change} knownTags={knownRefs} />
          </div>,
          document.body,
        )}
    </div>
  )
}

export default InlineTaskTags
