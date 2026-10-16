'use client'

import React from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cx } from './primitives'

/*
 * The phone's bottom sheet - FRONTEND_RULES_PHONE.md 41.8 rules 1 to 7 and 19.
 *
 *   - Portalled to <body>, over a backdrop, above the app bar and tab bar.
 *   - Slides up from the bottom, full width, 12px radius on its top corners,
 *     the dialog shadow (rule 2). A 32 x 4px drag handle at the top (rule 3).
 *   - Grows with its content up to 90% of the screen less the top safe area,
 *     then the body scrolls with the header and footer fixed (rule 4). It
 *     sits above the on-screen keyboard (--keyboard-inset, 41.13 rule 6).
 *   - Closes on a swipe down that starts on the handle or the header (never
 *     in the scrolling body), a tap on the backdrop, Android back, Escape or
 *     its close button (rule 5).
 *   - ANDROID BACK (41.4 rule 9): opening pushes a same-address history entry
 *     marked kitLayer (the mark lib/back.ts already skips), so the phone's back
 *     button closes the sheet instead of leaving the screen. Closing any other
 *     way takes that entry off again.
 *   - The sheet takes focus itself when it opens, never a field inside it, so
 *     the keyboard stays closed until the person taps a field (rule 19). Focus
 *     returns to what opened it on close.
 */

/** A swipe that moves the sheet down by this share of its height closes it. */
const CLOSE_SHARE = 0.25
/** ...or a flick faster than this, in px per ms. */
const FLICK_SPEED = 0.5

type SheetEntry = { kitLayer: true; kitStep: 0; phoneSheet: string }

function topEntryIs(id: string): boolean {
  const state = window.history.state as Partial<SheetEntry> | null
  return state?.phoneSheet === id
}

export function PhoneSheet({
  open,
  onOpenChange,
  title,
  children,
  footer,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: React.ReactNode
  /** The sheet's buttons; they share the footer's width, primary on the right (rule 6). */
  footer?: React.ReactNode
}) {
  const id = React.useId()
  const titleId = `${id}-title`
  const panelRef = React.useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = React.useState(false)
  const onOpenChangeRef = React.useRef(onOpenChange)
  onOpenChangeRef.current = onOpenChange

  React.useEffect(() => setMounted(true), [])

  // Android back: one history entry while open (41.4 rule 9).
  React.useEffect(() => {
    if (!open) return
    const entry: SheetEntry = { kitLayer: true, kitStep: 0, phoneSheet: id }
    window.history.pushState({ ...(window.history.state ?? {}), ...entry }, '', window.location.href)
    let closedByBack = false
    const onPop = () => {
      if (topEntryIs(id)) return
      closedByBack = true
      onOpenChangeRef.current(false)
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      // Closed by a button, the backdrop or a swipe: take our entry off, so
      // the next Android back leaves the screen as expected. If something
      // else was pushed since (a link in the sheet navigated), leave it.
      if (!closedByBack && topEntryIs(id)) window.history.back()
    }
  }, [open, id])

  // Escape, focus in and out, and no page scroll behind the sheet.
  React.useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    panelRef.current?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChangeRef.current(false)
    }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      opener?.focus?.({ preventScroll: true })
    }
  }, [open])

  // Swipe down from the handle or the header (rule 5).
  const drag = React.useRef<{ startY: number; startT: number; dy: number } | null>(null)
  const onPointerDown = (event: React.PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    // 41.4 rule 10: swipes starting within 24px of a side edge belong to the phone.
    if (event.clientX < 24 || event.clientX > window.innerWidth - 24) return
    drag.current = { startY: event.clientY, startT: performance.now(), dy: 0 }
    ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  }
  const onPointerMove = (event: React.PointerEvent) => {
    const d = drag.current
    const panel = panelRef.current
    if (!d || !panel) return
    d.dy = Math.max(0, event.clientY - d.startY)
    panel.style.transform = `translateY(${d.dy}px)`
    panel.style.transition = 'none'
  }
  const onPointerUp = () => {
    const d = drag.current
    const panel = panelRef.current
    drag.current = null
    if (!d || !panel) return
    const speed = d.dy / Math.max(1, performance.now() - d.startT)
    const close = d.dy > panel.offsetHeight * CLOSE_SHARE || (d.dy > 24 && speed > FLICK_SPEED)
    panel.style.transition = 'transform var(--duration-slow) cubic-bezier(0.2, 0, 0, 1)'
    panel.style.transform = close ? 'translateY(100%)' : ''
    if (close) window.setTimeout(() => onOpenChangeRef.current(false), 200)
  }

  if (!open || !mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-70">
      <div
        data-slot="phone-sheet-backdrop"
        aria-hidden
        className="absolute inset-0 bg-backdrop"
        onClick={() => onOpenChange(false)}
      />
      <div
        ref={panelRef}
        data-slot="phone-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(
          'absolute inset-x-0 flex flex-col rounded-t-[12px] bg-surface shadow-dialog outline-hidden',
          'bottom-(--keyboard-inset) max-h-[calc(90dvh-var(--safe-top)-var(--keyboard-inset))]',
          'pr-(--safe-right) pl-(--safe-left)',
        )}
      >
        <div
          className="shrink-0 touch-none select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="flex justify-center pt-[8px]" aria-hidden>
            <span className="h-[4px] w-[32px] rounded-full bg-border" />
          </div>
          <div className="flex items-center gap-[8px] pb-[8px] pl-[16px] pr-[4px] pt-[4px]">
            <h2 id={titleId} className="min-w-0 flex-1 text-card-heading font-semibold text-text-primary">
              {title}
            </h2>
            <button
              type="button"
              aria-label="Close"
              onClick={() => onOpenChange(false)}
              className="inline-flex size-[44px] shrink-0 items-center justify-center rounded-full text-text-secondary active:bg-surface-control outline-hidden focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-ring"
            >
              <X aria-hidden className="size-[22px]" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-[16px] pb-[16px]">{children}</div>
        {footer ? (
          <div className="flex shrink-0 gap-[8px] border-t border-border-light px-[16px] pt-[12px] pb-[calc(12px+var(--safe-bottom))] *:flex-1">
            {footer}
          </div>
        ) : (
          <div aria-hidden className="h-(--safe-bottom) shrink-0" />
        )}
      </div>
    </div>,
    document.body,
  )
}
