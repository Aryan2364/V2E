'use client'

import React from 'react'
import {
  Sheet as KitSheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
  SheetFooter,
} from '@/components/ui/sheet'

/**
 * Thin adapter over the kit's Sheet (components/ui/sheet.tsx), keeping the
 * workflow screens' original props so callers don't change. The kit sheet owns
 * the portal, backdrop, focus handling, Escape, the header band, the close
 * button and the scrolling body; header and footer stay put, only the body scrolls.
 * A dialog opened from inside the panel stacks above it and does not close it.
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
  /** Kept for API compatibility; the kit sheet labels itself from its title. */
  labelId: string
}) {
  return (
    <KitSheet open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <SheetContent
        side="right"
        className={wide ? 'data-[side=right]:sm:max-w-[640px]' : 'data-[side=right]:sm:max-w-[520px]'}
      >
        <SheetHeader>
          <div className="min-w-0">
            {eyebrow && <p className="text-label opacity-90">{eyebrow}</p>}
            <SheetTitle id={labelId} className="wrap-break-word">{title}</SheetTitle>
            {headerExtra && <div className="mt-1.5 flex flex-wrap items-center gap-2">{headerExtra}</div>}
          </div>
        </SheetHeader>
        <SheetBody className="flex flex-col gap-6 px-6 py-4">{children}</SheetBody>
        {footer && <SheetFooter className="flex-row flex-wrap items-center justify-end border-t border-border-light px-6 py-3">{footer}</SheetFooter>}
      </SheetContent>
    </KitSheet>
  )
}
