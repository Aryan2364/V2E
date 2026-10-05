'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

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

  if (label === null || label === undefined || label === false || label === '') return children

  const childProps = children.props as Record<string, ((e: unknown) => void) | undefined>
  const trigger = React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
    ref: setRef,
    onMouseEnter: (e: unknown) => { show(); childProps.onMouseEnter?.(e) },
    onMouseLeave: (e: unknown) => { hide(); childProps.onMouseLeave?.(e) },
    onFocus: (e: unknown) => { show(); childProps.onFocus?.(e) },
    onBlur: (e: unknown) => { hide(); childProps.onBlur?.(e) },
    ...(openOnTap ? { onClick: (e: unknown) => { show(); childProps.onClick?.(e) } } : {}),
  } as Record<string, unknown>)

  return (
    <>
      {trigger}
      {pos &&
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
