'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import TagChip from '@/components/ui/TagChip'
import TagPicker from '@/components/tasks/TagPicker'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import PermissionTooltip from '@/components/ui/PermissionTooltip'
import { toast } from 'sonner'
import { tasksApi, tagErrorMessage } from '@/lib/api/tasks'
import { useTaskTags } from '@/lib/tasks/useTaskTags'
import type { Task, TaskTagRef } from '@/lib/types/tasks'

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
const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i])

/**
 * A task's tags on its detail page or drawer, editable in place. Tagging is a triage
 * action, so it saves straight away rather than going through the Edit form:
 *
 * - "+ Add tag" opens the shared TagPicker in a small kit Popover (portalled, on
 *   the kit layers). It closes on a press outside or Escape (focus returns to the button).
 * - Each change — picking, unpicking, creating a tag, or a chip's ✕ — saves the full
 *   list via updateTask({ tag_ids }) optimistically. Saves run one at a time, and only
 *   the latest wanted list is sent, so quick clicks never race.
 * - A refused save (e.g. 403 from a scope the browser could not see) rolls back to the
 *   last saved list and shows the server's reason in a toast.
 */
export function InlineTaskTags({ orgId, taskId, tags, canEdit, onUpdated, className = '' }: InlineTaskTagsProps) {
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
          toast.error(tagErrorMessage(e, 'Couldn’t update this task’s tags. Try again.'))
          break
        }
      }
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [orgId, taskId, onUpdated])

  const change = useCallback(
    (next: string[]) => {
      if (sameIds(next, ids)) return
      setPendingIds(next)
      wantedRef.current = next
      void flush()
    },
    [ids, flush],
  )

  // ── Popover (kit Popover: portal, layers, Escape and outside press are the kit's) ──
  const [open, setOpen] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)

  // Open the picker's list straight away — "+ Add tag" means "show me the tags".
  useEffect(() => {
    if (!open) return
    const id = window.requestAnimationFrame(() => {
      const field = popRef.current?.querySelector<HTMLElement>('[aria-haspopup="listbox"]')
      if (field && field.getAttribute('aria-expanded') !== 'true') field.click()
    })
    return () => window.cancelAnimationFrame(id)
  }, [open])

  // Lost edit rights while open (e.g. permissions refreshed): close.
  useEffect(() => {
    if (canEdit !== true) setOpen(false)
  }, [canEdit])

  const editable = canEdit === true

  return (
    <div className={`flex flex-wrap items-center gap-1.5 min-w-0 ${className}`} aria-busy={saving || undefined}>
      {shown.length === 0 && <span className="text-body text-helper">No tags</span>}
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
      <Popover open={open} onOpenChange={setOpen}>
        <PermissionTooltip allowed={canEdit} reason={EDIT_TAGS_REASON}>
          <PopoverTrigger
            render={
              <Button
                variant="secondary"
                size="sm"
                aria-haspopup="dialog"
                aria-expanded={open}
                disabled={!editable}
              />
            }
          >
            <Plus size={16} aria-hidden="true" />
            Add tag
          </PopoverTrigger>
        </PermissionTooltip>
        <PopoverContent ref={popRef} align="start" aria-label="Edit tags" className="w-80 max-w-[calc(100vw-1rem)]">
          <p className="text-label text-text-secondary">Tags</p>
          <TagPicker orgId={orgId} value={ids} onChange={change} knownTags={knownRefs} />
        </PopoverContent>
      </Popover>
    </div>
  )
}

export default InlineTaskTags
