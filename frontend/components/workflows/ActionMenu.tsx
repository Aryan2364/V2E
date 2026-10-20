'use client'

import React from 'react'
import { MoreHorizontal, type LucideIcon } from 'lucide-react'
import Tooltip from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
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

/**
 * Three-dot menu on the kit DropdownMenu: portalled above dialogs and the top nav, closes
 * on a press outside, Escape or selection, and arrow keys, focus and typeahead are the
 * kit's. A refused item stays visible, disabled, with its reason on hover, focus and tap.
 */
export default function ActionMenu({ items, label = 'More actions' }: { items: ActionMenuItem[]; label?: string }) {
  const visible = items.filter((i) => !i.hidden)
  if (!visible.length) return null

  return (
    <DropdownMenu>
      <Tooltip label={label}>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label={label}
              // Never toggles the card or row this menu sits in.
              onClick={(e) => e.stopPropagation()}
            />
          }
        >
          <MoreHorizontal size={18} />
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-52">
        {visible.map((item) => {
          const allowed = item.allowed === undefined && !('allowed' in item) ? true : item.allowed
          const Icon = item.icon
          const row = (
            <DropdownMenuItem
              variant={item.danger ? 'danger' : 'default'}
              disabled={allowed !== true}
              onClick={(e) => {
                e.stopPropagation()
                item.onSelect()
              }}
            >
              <Icon size={16} className="shrink-0" />
              <span className="truncate">{item.label}</span>
            </DropdownMenuItem>
          )
          return (
            <PermissionTooltip key={item.key} allowed={allowed} reason={item.reason ?? ''} className="flex w-full">
              {allowed === true && item.tip ? <Tooltip label={item.tip}>{row}</Tooltip> : row}
            </PermissionTooltip>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
