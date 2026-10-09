'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Whether the focus that just landed came from the keyboard moving it (Tab / Shift+Tab).
 * Focus that a script puts back — a dialog or menu returning focus to the control that
 * opened it — or that a click causes is not a request to read a label, so it never opens
 * a tooltip. Installed once for the whole app, on first use.
 */
let tabNavigation = false
let navListening = false
function listenForTabNavigation() {
  if (navListening || typeof document === 'undefined') return
  navListening = true
  document.addEventListener('keydown', (e) => { tabNavigation = e.key === 'Tab' }, true)
  document.addEventListener('pointerdown', () => { tabNavigation = false }, true)
  // One Tab moves focus once. This bubble-phase listener runs after React's own focus
  // handling (React listens on its root — the document at most), so the tooltip has read
  // the flag before it is cleared.
  window.addEventListener('focusin', () => { tabNavigation = false })
}

interface TooltipProps {
  /** Tooltip content. When empty/false, the child renders with no tooltip behaviour. */
  label: React.ReactNode
  /** A single element to attach the tooltip to (must accept a ref + DOM event handlers). */
  children: React.ReactElement
  /** Preferred side; flips automatically when there isn't room. */
  placement?: 'top' | 'bottom'
  /**
   * Also open on a tap/click, and stay open until a press elsewhere, Escape or a scroll.
   * For text a touch user must be able to read — the reason a control is disabled
   * (kit §19, §26) — since a tablet can neither hover nor Tab. Used by PermissionTooltip.
   */
  openOnTap?: boolean
}

/**
 * Styled hover/focus tooltip that REPLACES the native `title=""` OS bubble (banned by
 * DESIGN_RULES). The bubble is rendered through a portal to <body> with `position: fixed`
 * and a high z-index, so it is never clipped by an `overflow-auto` ancestor and never
 * painted behind the sidebar/top-nav (both of which sit in lower stacking contexts).
 *
 * It attaches to its child via cloneElement — no extra wrapper DOM node — so it can wrap
 * an existing element without changing layout. Keep `aria-label` on the child for screen
 * readers; this only adds the visual bubble.
 */
export default function Tooltip({ label, children, placement = 'top', openOnTap = false }: TooltipProps) {
  const [pos, setPos] = useState<{ x: number; y: number; place: 'top' | 'bottom' } | null>(null)
  const elRef = useRef<HTMLElement | null>(null)
  const enabled = !(label === null || label === undefined || label === false || label === '')

  useEffect(listenForTabNavigation, [])

  const show = useCallback(() => {
    const el = elRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    // Flip below when too close to the top of the viewport to draw above.
    const place: 'top' | 'bottom' = placement === 'top' && r.top < 48 ? 'bottom' : placement
    setPos({
      x: Math.min(Math.max(r.left + r.width / 2, 10), window.innerWidth - 10),
      y: place === 'top' ? r.top - 8 : r.bottom + 8,
      place,
    })
  }, [placement])

  const hide = useCallback(() => setPos(null), [])

  // Turned off while open (e.g. a menu trigger whose menu is showing): close it, so it
  // cannot come back at a stale position when the label returns.
  useEffect(() => {
    if (!enabled) setPos(null)
  }, [enabled])

  // A tapped-open bubble has no hover to end it: close on a press elsewhere, Escape or scroll.
  const isOpen = pos !== null
  useEffect(() => {
    if (!openOnTap || !isOpen) return
    const onDown = (e: PointerEvent) => {
      if (elRef.current && !elRef.current.contains(e.target as Node)) hide()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide() }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', hide, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', hide, true)
    }
  }, [openOnTap, isOpen, hide])

  // Merge our ref with any ref the child already carries.
  const setRef = useCallback(
    (node: HTMLElement | null) => {
      elRef.current = node
      const { ref } = children as unknown as { ref?: React.Ref<HTMLElement> }
      if (typeof ref === 'function') ref(node)
      else if (ref && typeof ref === 'object') (ref as React.MutableRefObject<HTMLElement | null>).current = node
    },
    [children],
  )

  // Same element tree whether or not the tooltip is on, so turning it off and on (a menu
  // opening and closing) never remounts the trigger and never drops its focus.
  const childProps = children.props as Record<string, ((e: unknown) => void) | undefined>
  const trigger = enabled
    ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        ref: setRef,
        onMouseEnter: (e: unknown) => { show(); childProps.onMouseEnter?.(e) },
        onMouseLeave: (e: unknown) => { hide(); childProps.onMouseLeave?.(e) },
        // Only focus moved by Tab opens it — not focus a dialog or menu hands back.
        onFocus: (e: unknown) => { if (tabNavigation) show(); childProps.onFocus?.(e) },
        onBlur: (e: unknown) => { hide(); childProps.onBlur?.(e) },
        // Pressing the control acts on it: the label has done its job. A tap-to-read
        // tooltip (openOnTap) opens instead.
        onClick: (e: unknown) => { if (openOnTap) show(); else hide(); childProps.onClick?.(e) },
        onKeyDown: (e: unknown) => {
          const k = (e as { key?: string }).key
          if (!openOnTap && (k === 'Enter' || k === ' ')) hide()
          childProps.onKeyDown?.(e)
        },
      } as Record<string, unknown>)
    : children

  return (
    <>
      {trigger}
      {enabled &&
        pos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="tooltip"
            style={{
              position: 'fixed',
              left: pos.x,
              top: pos.y,
              transform: `translate(-50%, ${pos.place === 'top' ? '-100%' : '0'})`,
            }}
            className="pointer-events-none z-[80] max-w-[260px] rounded-[6px] bg-[#0F172A] px-2 py-1 text-[11px] font-medium leading-snug text-white shadow-[0_4px_16px_rgba(0,0,0,0.28)]"
          >
            {label}
          </div>,
          document.body,
        )}
    </>
  )
}
