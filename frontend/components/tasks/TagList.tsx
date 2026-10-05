'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import TagChip from '@/components/ui/TagChip'
import type { TaskTagRef } from '@/lib/types/tasks'

// useLayoutEffect warns during server rendering; measure with it only in the browser.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

interface TagListProps {
  tags: TaskTagRef[] | null | undefined
  /** Chips shown before the "+N" overflow chip. Rows and cards use 2 (kit §11.6). */
  max?: number
  className?: string
}

const POPOVER_WIDTH = 280
const POPOVER_MAX_HEIGHT = 240
const GAP = 6

/**
 * A task's tags on a row or card: the first `max` chips, then a "+N" chip that opens a
 * small popover with the rest. The popover is portalled to <body> and fixed-positioned,
 * so no row, card or scrolling list can clip it; it flips above the chip when there is
 * no room below, and closes on Escape, a press elsewhere, scroll or resize.
 *
 * Rows and cards are usually clickable. A click (or Enter/Space) anywhere in the list —
 * a chip, the "+N", or inside the popover — stops there and never opens the row.
 * Renders nothing when there are no tags.
 */
export function TagList({ tags, max = 2, className = '' }: TagListProps) {
  const list = tags ?? []
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  const visible = list.slice(0, Math.max(0, max))
  const rest = list.slice(visible.length)

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const left = Math.min(Math.max(8, r.left), window.innerWidth - POPOVER_WIDTH - 8)
    const below = window.innerHeight - r.bottom
    if (below < POPOVER_MAX_HEIGHT + GAP && r.top > below) setPos({ left, bottom: window.innerHeight - r.top + GAP })
    else setPos({ left, top: r.bottom + GAP })
  }, [])

  const close = useCallback((refocus = false) => {
    setOpen(false)
    if (refocus) btnRef.current?.focus()
  }, [])

  useIsoLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(true)
    }
    // A scroll inside the popover itself is fine; any other scroll would leave it floating.
    const onScroll = (e: Event) => {
      if (popRef.current && e.target instanceof Node && popRef.current.contains(e.target)) return
      close()
    }
    const onResize = () => close()
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open, close])

  if (list.length === 0) return null

  // Keep every interaction inside the list from reaching (or navigating) the row.
  const swallow = (e: React.SyntheticEvent) => {
    e.stopPropagation()
    if (e.type === 'click') e.preventDefault()
  }

  return (
    <span
      className={`inline-flex items-center gap-1 min-w-0 max-w-full ${className}`}
      onClick={swallow}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
      }}
    >
      {visible.map((t) => (
        <TagChip key={t.id} tag={t} size="sm" className="min-w-0" />
      ))}
      {rest.length > 0 && (
        <button
          ref={btnRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`${rest.length} more ${rest.length === 1 ? 'tag' : 'tags'}`}
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            setOpen((o) => !o)
          }}
          className="shrink-0 inline-flex items-center h-5 px-2 rounded-full border border-border bg-white text-xs font-medium text-secondary hover:border-input hover:text-heading focus:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-colors"
        >
          +{rest.length}
        </button>
      )}
      {open &&
        pos &&
        typeof document !== 'undefined' &&
        createPortal(
          // z-78: above Modal and drawers (z-60 / z-75), below Tooltip (z-80) so a
          // truncated chip's full name still shows over the popover.
          <div
            ref={popRef}
            role="dialog"
            aria-label="More tags"
            onClick={swallow}
            className="fixed z-[78] w-[280px] max-h-[240px] overflow-y-auto overscroll-contain rounded-lg border border-border bg-white p-3 shadow-card animate-[popIn_.15s_ease-out]"
            style={{ left: pos.left, top: pos.top, bottom: pos.bottom }}
          >
            <div className="flex flex-wrap gap-1">
              {rest.map((t) => (
                <TagChip key={t.id} tag={t} size="sm" />
              ))}
            </div>
          </div>,
          document.body,
        )}
    </span>
  )
}

export default TagList
