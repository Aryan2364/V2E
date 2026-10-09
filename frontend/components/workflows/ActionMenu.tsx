'use client'

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal, type LucideIcon } from 'lucide-react'
import Tooltip from '@/components/ui/Tooltip'
import PermissionTooltip from '@/components/ui/PermissionTooltip'

export interface ActionMenuItem {
  key: string
  label: string
  icon: LucideIcon
  onSelect: () => void
  danger?: boolean
  /** Tri-state like PermissionTooltip: only a definite true enables the item. Omitted = allowed. */
  allowed?: boolean | undefined
  reason?: string
  hidden?: boolean
  /** A short explanation shown on hover while the item is allowed. */
  tip?: string
}

const MENU_W = 208

/**
 * Three-dot menu. The list renders in a portal to <body> (no ancestor overflow can clip
 * it), above dialogs and the top nav, and closes on a press outside, Escape, scroll or
 * resize. Arrow keys move between items.
 */
export default function ActionMenu({ items, label = 'More actions' }: { items: ActionMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const visible = items.filter((i) => !i.hidden)

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const estH = visible.length * 44 + 12
    const up = window.innerHeight - r.bottom < estH + 8 && r.top > estH + 8
    const left = Math.min(Math.max(8, r.right - MENU_W), window.innerWidth - MENU_W - 8)
    setPos({ top: up ? r.top - 4 : r.bottom + 4, left, up })
  }, [visible.length])

  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        btnRef.current?.focus()
      }
    }
    const close = () => setOpen(false)
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    // Focus the first enabled item for keyboard users.
    requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus())
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  function onMenuKey(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const btns = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])
    const i = btns.indexOf(document.activeElement as HTMLButtonElement)
    const next = e.key === 'ArrowDown' ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length
    btns[next]?.focus()
  }

  if (!visible.length) return null

  return (
    <>
      <Tooltip label={open ? '' : label}>
        <button
          ref={btnRef}
          type="button"
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setOpen((v) => !v)
          }}
          className="relative z-10 inline-flex items-center justify-center w-11 h-11 sm:w-9 sm:h-9 rounded-[8px] text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
        >
          <MoreHorizontal size={18} />
        </button>
      </Tooltip>
      {open &&
        pos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            onKeyDown={onMenuKey}
            style={{ top: pos.top, left: pos.left, width: MENU_W, transform: pos.up ? 'translateY(-100%)' : undefined }}
            className="fixed z-[66] bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_8px_24px_rgba(15,23,42,0.14)] py-1.5"
          >
            {visible.map((item) => {
              const allowed = item.allowed === undefined && !('allowed' in item) ? true : item.allowed
              const Icon = item.icon
              const btn = (
                <button
                  type="button"
                  role="menuitem"
                  disabled={allowed !== true}
                  onClick={(e) => {
                    e.stopPropagation()
                    setOpen(false)
                    item.onSelect()
                  }}
                  className={[
                    'w-full flex items-center gap-2.5 px-3 min-h-[44px] sm:min-h-[38px] text-sm text-left transition-colors focus:outline-none',
                    allowed !== true
                      ? 'text-[#64748B] cursor-not-allowed'
                      : item.danger
                        ? 'text-[#B91C1C] hover:bg-[#FEF2F2] focus:bg-[#FEF2F2]'
                        : 'text-[#0F172A] hover:bg-[#F1F5F9] focus:bg-[#F1F5F9]',
                  ].join(' ')}
                >
                  <Icon size={16} className="shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              )
              return (
                <PermissionTooltip key={item.key} allowed={allowed} reason={item.reason ?? ''} className="flex w-full">
                  {allowed === true && item.tip ? <Tooltip label={item.tip}>{btn}</Tooltip> : btn}
                </PermissionTooltip>
              )
            })}
          </div>,
          document.body,
        )}
    </>
  )
}
