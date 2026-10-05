'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import Tooltip from './Tooltip'
import { tagChipClass } from '@/lib/tasks/tagColors'
import type { TaskTagRef } from '@/lib/types/tasks'

// useLayoutEffect warns during server rendering; measure with it only in the browser.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

export type TagChipSize = 'sm' | 'md'

interface TagChipProps {
  tag: TaskTagRef
  /** sm (20px) for rows, cards and the picker field; md (24px) for detail pages. Default sm. */
  size?: TagChipSize
  /** Shows a ✕ that removes the tag. Omit for a read-only chip. */
  onRemove?: () => void
  className?: string
}

const SIZE: Record<TagChipSize, { chip: string; pr: string; text: string; remove: string; icon: number }> = {
  sm: { chip: 'h-5 max-w-[160px] gap-0.5 pl-2 text-[12px]', pr: 'pr-2', text: 'leading-[18px]', remove: 'w-4 h-4 mr-0.5', icon: 10 },
  md: { chip: 'h-6 max-w-[220px] gap-1 pl-2.5 text-[13px]', pr: 'pr-2.5', text: 'leading-[22px]', remove: 'w-5 h-5 mr-0.5', icon: 12 },
}

/**
 * One tag, in its palette colour (classes backed by globals.css tokens — never inline
 * colour). Long names truncate, with the full name in a tooltip only when it is
 * actually cut (kit §8). A deactivated tag renders muted and dashed, and its tooltip
 * says "(inactive)".
 *
 * The ✕ is a real button. Its click stops propagating, so removing a tag inside a
 * clickable row or field never also triggers that row or opens that field.
 */
export function TagChip({ tag, size = 'sm', onRemove, className = '' }: TagChipProps) {
  const textRef = useRef<HTMLSpanElement>(null)
  const [cut, setCut] = useState(false)
  const s = SIZE[size]
  const inactive = !tag.is_active

  // Measure whether the name is truncated; re-measure when the chip's box changes.
  useIsoLayoutEffect(() => {
    const el = textRef.current
    if (!el) return
    const measure = () => setCut(el.scrollWidth > el.clientWidth + 1)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [tag.name, size])

  const tip = cut || inactive ? `${tag.name}${inactive ? ' (inactive)' : ''}` : ''
  const hasRemove = !!onRemove

  return (
    <span
      className={`inline-flex items-center min-w-0 rounded-full border font-medium ${s.chip} ${
        hasRemove ? 'pr-0' : s.pr
      } ${tagChipClass(tag.color, inactive)} ${className}`}
      data-tag-id={tag.id}
    >
      <Tooltip label={tip}>
        <span ref={textRef} className={`truncate min-w-0 ${s.text}`}>
          {tag.name}
          {inactive && <span className="sr-only"> (inactive)</span>}
        </span>
      </Tooltip>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove tag ${tag.name}`}
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            onRemove()
          }}
          onKeyDown={(e) => e.stopPropagation()}
          className={`tag-chip-remove shrink-0 inline-flex items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-current ${s.remove}`}
        >
          <X size={s.icon} strokeWidth={2.5} />
        </button>
      )}
    </span>
  )
}

export default TagChip
