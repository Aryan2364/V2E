'use client'

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, CheckCircle2, Tag as TagIcon } from 'lucide-react'
import type { TaskStatus, TaskTagRef } from '@/lib/types/tasks'
import StyledSelect from '@/components/ui/StyledSelect'
import DatePicker from '@/components/ui/DatePicker'
import TagPicker from '@/components/tasks/TagPicker'
import TagSelect from './TagSelect'

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
      <div className="bg-[#0F172A] text-white rounded-[12px] shadow-[0_8px_30px_rgba(0,0,0,0.25)] px-4 py-3 flex items-center gap-3 flex-wrap">
        <span className="text-sm font-semibold whitespace-nowrap">{count} selected</span>
        <div className="h-5 w-px bg-[#334155] hidden sm:block" />

        <div className="flex items-center gap-2 flex-wrap flex-1">
          <StyledSelect
            value=""
            disabled={busy}
            onChange={(v) => v && onStatus(v)}
            wrapperClassName="w-[150px]"
            triggerClassName="!bg-[#1E293B] hover:!bg-[#1E293B] focus:!bg-[#1E293B] !border-[#334155] !text-white"
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

          <button
            onClick={onComplete}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-2 rounded-[8px] bg-[#16A34A] text-white text-sm font-semibold hover:bg-[#15803D] disabled:opacity-60 transition-colors"
          >
            <CheckCircle2 size={15} /> Complete
          </button>
        </div>

        <button onClick={onClear} className="flex items-center gap-1 text-sm text-[#CBD5E1] hover:text-white transition-colors">
          <X size={15} /> Clear
        </button>
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
  const applyLabel = mode === 'add_tags'
    ? (applying ? 'Adding…' : `Add to ${tasksWord}`)
    : (applying ? 'Removing…' : `Remove from ${tasksWord}`)

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
        className={`flex items-center gap-1.5 px-3 py-2 rounded-[8px] border text-sm font-semibold disabled:opacity-60 transition-colors ${
          open ? 'bg-white text-[#0F172A] border-white' : 'bg-[#1E293B] text-white border-[#334155] hover:bg-[#334155]'
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
            className="fixed z-[70] w-[360px] max-w-[calc(100vw-16px)] rounded-card border border-border bg-white p-4 shadow-[0_8px_28px_rgba(0,0,0,0.18)] animate-[popIn_.15s_ease-out]"
            style={{ left: pos.left, bottom: pos.bottom }}
          >
            <div className="flex items-center justify-between gap-2 mb-3">
              <p className="text-sm font-semibold text-heading">Tag {tasksWord}</p>
              <button
                type="button"
                onClick={() => close(true)}
                aria-label="Close"
                className="w-7 h-7 rounded-btn flex items-center justify-center text-secondary hover:bg-[#F1F5F9] hover:text-heading focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <X size={15} />
              </button>
            </div>

            <div role="group" aria-label="Add or remove" className="grid grid-cols-2 gap-1 p-0.5 mb-3 rounded-btn border border-border bg-[#F8FAFC]">
              {([['add_tags', 'Add tags'], ['remove_tags', 'Remove tags']] as const).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => switchMode(m)}
                  className={`py-1.5 rounded-[6px] text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    mode === m ? 'bg-white text-primary shadow-card' : 'text-secondary hover:text-heading'
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
            <p className="mt-2 text-xs text-secondary">Tasks you can’t edit are skipped, and you’ll see how many.</p>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => close(true)}
                className="px-3.5 py-2 rounded-btn border border-border text-sm font-medium text-secondary hover:bg-[#F1F5F9] hover:text-heading transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void apply()}
                disabled={!ids.length || applying || busy}
                className="px-3.5 py-2 rounded-btn bg-primary text-white text-sm font-semibold hover:bg-primary-hover disabled:bg-border disabled:text-muted disabled:cursor-not-allowed transition-colors"
              >
                {applyLabel}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
