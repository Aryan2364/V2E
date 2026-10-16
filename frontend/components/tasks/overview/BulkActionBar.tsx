'use client'

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, CheckCircle2, Tag as TagIcon } from 'lucide-react'
import type { TaskStatus, TaskTagRef } from '@/lib/types/tasks'
import StyledSelect from '@/components/ui/StyledSelect'
import DatePicker from '@/components/ui/DatePicker'
import TagPicker from '@/components/tasks/TagPicker'
import TagSelect from './TagSelect'
import { Button } from '@/components/ui/button'

// useLayoutEffect warns during server rendering; measure with it only in the browser.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

export type BulkTagAction = 'add_tags' | 'remove_tags'

const PANEL_WIDTH = 360
const GAP = 8
/** The bulk endpoint takes at most this many tag ids per call. */
const MAX_BULK_TAG_IDS = 50

/**
 * Floating bulk-action bar shown while rows are selected: change status, set a deadline,
 * mark complete, add or remove tags, across the selected set (scope-gated server-side —
 * tasks the viewer cannot edit are skipped and reported by the page).
 */
export default function BulkActionBar({
  orgId,
  count,
  statuses,
  selectedTags,
  busy,
  onStatus,
  onComplete,
  onDeadline,
  onTags,
  onClear,
}: {
  orgId: string
  count: number
  statuses: TaskStatus[]
  /** Every tag carried by the selected tasks — what "Remove tags" offers. */
  selectedTags: TaskTagRef[]
  busy: boolean
  onStatus: (statusId: string) => void
  onComplete: () => void
  onDeadline: (date: string) => void
  /** Resolves true when the change went through, so the panel can close. */
  onTags: (action: BulkTagAction, tagIds: string[]) => Promise<boolean>
  onClear: () => void
}) {
  const [deadline, setDeadline] = useState('')
  const [tagOpen, setTagOpen] = useState(false)

  // Selection gone (cleared, or a bulk action finished): the panel has nothing to act on.
  useEffect(() => {
    if (count === 0) setTagOpen(false)
  }, [count])

  if (count === 0) return null

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-3xl">
      <div className="bg-text-primary text-primary-foreground rounded-xl shadow-dialog px-4 py-3 flex items-center gap-3 flex-wrap">
        <span className="text-body font-medium whitespace-nowrap">{count} selected</span>
        <div className="h-5 w-px bg-on-brand-hover hidden sm:block" />

        <div className="flex items-center gap-2 flex-wrap flex-1">
          <StyledSelect
            value=""
            disabled={busy}
            onChange={(v) => v && onStatus(v)}
            wrapperClassName="w-[150px]"
            triggerClassName="bg-text-primary! hover:bg-text-primary! focus:bg-text-primary! border-border-strong! text-primary-foreground!"
            placeholder="Set status…"
            options={[
              { value: '', label: 'Set status…' },
              // "Partially Completed" is system-derived only (never hand-set); keep it out of bulk.
              ...statuses
                .filter((s) => s.type !== 'partially_completed')
                .map((s) => ({ value: s.id, label: s.label, color: s.color })),
            ]}
          />

          <div className="w-[160px]">
            <DatePicker
              value={deadline}
              onChange={(v: string) => { setDeadline(v); if (v) onDeadline(v) }}
              placeholder="Set deadline"
            />
          </div>

          <BulkTagButton
            orgId={orgId}
            count={count}
            selectedTags={selectedTags}
            busy={busy}
            open={tagOpen}
            onOpenChange={setTagOpen}
            onApply={onTags}
          />

          <Button
            onClick={onComplete}
            disabled={busy}
            className="bg-success border-success hover:bg-success active:bg-success"
          >
            <CheckCircle2 size={15} /> Complete
          </Button>
        </div>

        <Button variant="on-brand" onClick={onClear}>
          <X size={15} /> Clear
        </Button>
      </div>
    </div>
  )
}

/**
 * The bar's "Tag" button and its small panel: Add tags (the tag picker — an existing
 * tag, or a new one for people allowed to create tags) or Remove tags (the tags the
 * selected tasks carry). The panel is portalled to <body> and opens above the button,
 * so the fixed bar never clips it; Escape or a press elsewhere closes it.
 */
function BulkTagButton({
  orgId,
  count,
  selectedTags,
  busy,
  open,
  onOpenChange,
  onApply,
}: {
  orgId: string
  count: number
  selectedTags: TaskTagRef[]
  busy: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onApply: (action: BulkTagAction, tagIds: string[]) => Promise<boolean>
}) {
  const [mode, setMode] = useState<BulkTagAction>('add_tags')
  const [ids, setIds] = useState<string[]>([])
  const [applying, setApplying] = useState(false)
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const width = Math.min(PANEL_WIDTH, window.innerWidth - 16)
    setPos({
      left: Math.min(Math.max(8, r.left), window.innerWidth - width - 8),
      bottom: window.innerHeight - r.top + GAP,
    })
  }, [])

  const close = useCallback(
    (refocus = false) => {
      onOpenChange(false)
      if (refocus) btnRef.current?.focus()
    },
    [onOpenChange],
  )

  useIsoLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      // A picker open inside the panel closes first (it handles its own Escape).
      if (e.key === 'Escape' && !panelRef.current?.querySelector('[aria-expanded="true"]')) close(true)
    }
    const onResize = () => place()
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [open, close, place])

  async function apply() {
    if (!ids.length || applying) return
    setApplying(true)
    try {
      const ok = await onApply(mode, ids)
      if (ok) close()
    } finally {
      setApplying(false)
    }
  }

  const switchMode = (m: BulkTagAction) => {
    if (m === mode) return
    setMode(m)
    setIds([])
  }

  const tasksWord = `${count} task${count === 1 ? '' : 's'}`

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => {
          if (open) return close()
          // A fresh panel each time it opens.
          setMode('add_tags')
          setIds([])
          onOpenChange(true)
        }}
        disabled={busy}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-body font-medium disabled:opacity-60 transition-colors ${
          open ? 'bg-surface text-text-primary border-white' : 'bg-text-primary text-primary-foreground border-border-strong hover:bg-text-primary/80'
        }`}
      >
        <TagIcon size={15} /> Tag
      </button>

      {open && pos && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={`Tag ${tasksWord}`}
            className="fixed z-70 w-[360px] max-w-[calc(100vw-16px)] rounded-card border border-border bg-surface p-4 shadow-menu animate-[popIn_.15s_ease-out]"
            style={{ left: pos.left, bottom: pos.bottom }}
          >
            <div className="flex items-center justify-between gap-2 mb-3">
              <p className="text-body font-medium text-heading">Tag {tasksWord}</p>
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => close(true)} aria-label="Close">
                <X size={15} />
              </Button>
            </div>

            <div role="group" aria-label="Add or remove" className="grid grid-cols-2 gap-1 p-0.5 mb-3 rounded-btn border border-border bg-surface-sunken">
              {([['add_tags', 'Add tags'], ['remove_tags', 'Remove tags']] as const).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => switchMode(m)}
                  className={`py-1.5 rounded-[6px] text-body font-medium transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary ${
                    mode === m ? 'bg-surface text-primary shadow-card' : 'text-secondary hover:text-heading'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {mode === 'add_tags' ? (
              <TagPicker orgId={orgId} value={ids} onChange={setIds} placeholder="Choose tags to add" />
            ) : (
              <TagSelect
                orgId={orgId}
                value={ids}
                onChange={setIds}
                pool={selectedTags}
                placeholder="Choose tags to remove"
                emptyText="The selected tasks have no tags."
                maxSelected={MAX_BULK_TAG_IDS}
                maxSelectedHint={`Up to ${MAX_BULK_TAG_IDS} tags at a time`}
              />
            )}
            <p className="mt-2 text-meta text-secondary">Tasks you can’t edit are skipped, and you’ll see how many.</p>

            <div className="mt-4 flex items-center justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => close(true)}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void apply()}
                disabled={!ids.length || busy}
                loading={applying}
                loadingLabel={mode === 'add_tags' ? 'Adding…' : 'Removing…'}
              >
                {mode === 'add_tags' ? `Add to ${tasksWord}` : `Remove from ${tasksWord}`}
              </Button>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
