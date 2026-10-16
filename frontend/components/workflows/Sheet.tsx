'use client'

import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { BTN } from './shared'

/**
 * A panel sliding in from the right, portalled to <body> above the fixed top nav. Closes
 * on Escape, the backdrop or the close button, and hands focus back where it came from.
 * Header and footer stay put; only the body scrolls. Full screen on a phone.
 */
export default function Sheet({
  open,
  onClose,
  title,
  eyebrow,
  headerExtra,
  footer,
  children,
  wide = false,
  labelId,
}: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  /** Small line above the title, e.g. "Step 2 of 5". */
  eyebrow?: React.ReactNode
  /** Badges under the title. */
  headerExtra?: React.ReactNode
  footer?: React.ReactNode
  children: React.ReactNode
  wide?: boolean
  labelId: string
}) {
  const [mounted, setMounted] = useState(false)
  const [render, setRender] = useState(open)
  const [shown, setShown] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!open) {
      setShown(false)
      const t = setTimeout(() => setRender(false), 200)
      return () => clearTimeout(t)
    }
    setRender(true)
    returnFocus.current = document.activeElement as HTMLElement
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setShown(true)
        panelRef.current?.focus()
      }),
    )
    const onKey = (e: KeyboardEvent) => {
      // A menu or dialog opened from inside the panel closes first.
      if (e.key === 'Escape' && !document.querySelector('[data-sheet-blocker="true"]')) closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
      returnFocus.current?.focus?.()
    }
  }, [open])

  if (!mounted || !render) return null

  return createPortal(
    <div className="fixed inset-0 z-(--z-dialog)" role="dialog" aria-modal="true" aria-labelledby={labelId}>
      <div className={`absolute inset-0 bg-backdrop transition-opacity duration-200 ${shown ? 'opacity-100' : 'opacity-0'}`} onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`absolute right-0 top-0 h-full w-full ${wide ? 'sm:max-w-[640px]' : 'sm:max-w-[520px]'} bg-surface shadow-dialog flex flex-col outline-hidden transition-transform ease-out motion-reduce:transition-none ${
          shown ? 'translate-x-0 duration-250' : 'translate-x-full duration-200'
        }`}
      >
        <div className="flex items-start gap-3 px-6 py-4 border-b border-border-light shrink-0">
          <div className="flex-1 min-w-0">
            {eyebrow && <p className="text-label font-medium text-text-secondary">{eyebrow}</p>}
            <h2 id={labelId} className="text-card-heading font-medium text-text-primary wrap-break-word">
              {title}
            </h2>
            {headerExtra && <div className="mt-1.5 flex items-center gap-2 flex-wrap">{headerExtra}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={BTN.icon}>
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 flex flex-col gap-6">{children}</div>
        {footer && <div className="shrink-0 border-t border-border-light px-6 py-3 flex flex-wrap items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
