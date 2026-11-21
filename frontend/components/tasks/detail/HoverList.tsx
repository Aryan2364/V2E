'use client'

import React, { useState } from 'react'

/**
 * Inline hover chip: shows a dark tooltip listing `items` above the trigger text.
 * Matches the software's tooltip convention (see components/projects/GanttBar) —
 * dark card, light text, soft shadow, pointer-events-none. Renders nothing on
 * hover when the list is empty. Uses spans only (lives inside <p>, phrasing content).
 */
export function HoverList({ trigger, heading, items, className = '' }: {
  trigger: React.ReactNode
  heading: string
  items: string[]
  className?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <span
      className={`relative inline-block ${className}`}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span className="underline decoration-dotted decoration-current/40 underline-offset-2">{trigger}</span>
      {show && items.length > 0 && (
        <span className="absolute bottom-full left-0 mb-1.5 z-40 w-max max-w-[240px] rounded-control bg-text-primary px-3 py-2 text-left shadow-dialog pointer-events-none">
          <span className="block text-meta font-medium uppercase tracking-wider text-text-muted mb-1">{heading}</span>
          {items.map((it, i) => (
            <span key={i} className="block text-meta leading-snug text-primary-foreground whitespace-pre-wrap">{it}</span>
          ))}
        </span>
      )}
    </span>
  )
}
