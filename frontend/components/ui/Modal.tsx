'use client'

import * as React from 'react'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type ModalSize = 'sm' | 'md' | 'lg'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  size?: ModalSize
  /** Close when Escape is pressed. Disable for data-entry modals to avoid losing input. */
  closeOnEscape?: boolean
  /**
   * When true (default) the whole body scrolls once content exceeds the panel.
   * Set false to make the body a flex column instead — the modal grows only to
   * its max height, and any inner region you mark `flex-1 min-h-0 overflow-y-auto`
   * becomes the sole scroll area, keeping headers/footers pinned.
   */
  bodyScroll?: boolean
  /**
   * Renders above another open Modal. Use for a nested "quick create" opened
   * FROM a form modal, so the parent form stays visible behind it instead of
   * being replaced (and its half-filled state stays obviously intact).
   *
   * The kit's Dialog stacks every layer at the same --z-dialog token (section
   * 24 rule 4: a dialog never opens from inside another). Base UI's portals
   * still paint in mount order, so a modal opened from within an already-open
   * one still renders on top in practice; this prop is kept only so call
   * sites compile unchanged (one call site today, components/goals/
   * QuickCreateProjectModal.tsx).
   */
  elevated?: boolean
}

/**
 * Thin adapter: same name, props and signature every call site already uses
 * (see components/ui/ADAPTERS.md), implemented on the kit's Dialog parts
 * (./dialog) instead of a hand-rolled portal/backdrop. `size` maps straight
 * onto the kit's own sm/md/lg widths (section 24). `bodyScroll={false}`
 * keeps working: it is passed straight to DialogContent's body wrapper via
 * a className override, since the kit already assembles header/body/footer
 * itself (dialog.tsx's DialogContent) rather than leaving that to the caller.
 */
export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  closeOnEscape = true,
  bodyScroll = true,
}: ModalProps) {
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open, eventDetails) => {
        if (open) return
        // Escape is handled by Base UI as a close reason; every other close
        // reason (backdrop click, the header's close button) keeps behaving
        // exactly as the old Modal: backdrop click always closed it, and
        // Escape only closed it when closeOnEscape was true.
        if (eventDetails.reason === 'escape-key' && !closeOnEscape) {
          eventDetails.cancel()
          return
        }
        onClose()
      }}
    >
      <DialogContent
        size={size}
        className={bodyScroll ? undefined : '[&_[data-slot=dialog-body]]:flex [&_[data-slot=dialog-body]]:flex-col [&_[data-slot=dialog-body]]:overflow-visible'}
      >
        {/*
         * Always rendered, title or not: the old Modal always showed the
         * close button regardless of whether a title was passed. Omitting
         * DialogHeader when title is empty would drop the close button for
         * those call sites.
         */}
        <DialogHeader>{title ? <DialogTitle>{title}</DialogTitle> : null}</DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}
