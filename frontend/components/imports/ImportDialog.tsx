'use client'

import React from 'react'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Tooltip from '@/components/ui/tooltip'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from '@/components/ui/dialog'

/**
 * Shared shell for the four "Import ..." dialogs (employees, job roles,
 * departments, holidays): a kit Dialog with the header band, a scrolling body
 * and a footer with Cancel/secondary on the left of the primary (section 24).
 *
 * The caller owns the state. `onClose` is the close request (Escape, backdrop,
 * the header X): pass the guarded one (lib/use-guarded-close) so a half-done
 * import asks first. While `busy` (an import is running) every close path is
 * refused. A dialog opened from inside this one (a confirmation) is a kit
 * AlertDialog rendered as a child, so it stacks and does not close this one.
 */
export default function ImportDialog({
  title,
  onClose,
  busy = false,
  size = 'lg',
  fullScreen = false,
  back,
  headerAction,
  footer,
  children,
}: {
  title: string
  onClose: () => void
  busy?: boolean
  size?: 'sm' | 'md' | 'lg'
  /** Fills the screen (a wide review table); still a Dialog, so header, footer and Escape behave the same. */
  fullScreen?: boolean
  /** Shows a back arrow before the title (e.g. history back to upload). */
  back?: { label: string; onClick: () => void }
  /** A control placed on the header band, left of the close button (e.g. Import history). */
  headerAction?: React.ReactNode
  /** Footer buttons, Cancel first then the primary. Omit for no footer. */
  footer?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Dialog
      open
      onOpenChange={(next, eventDetails) => {
        if (next) return
        if (busy) {
          eventDetails.cancel()
          return
        }
        onClose()
      }}
    >
      <DialogContent
        size={size}
        className={fullScreen ? 'h-dvh max-h-dvh w-screen max-w-none rounded-none data-[size=lg]:max-w-none data-[size=md]:max-w-none data-[size=sm]:max-w-none' : undefined}
      >
        <DialogHeader>
          <div className="flex min-w-0 items-center gap-2">
            {back && (
              <Tooltip label={back.label}>
                <Button variant="on-brand" size="icon" onClick={back.onClick} aria-label={back.label}>
                  <ArrowLeft size={16} />
                </Button>
              </Tooltip>
            )}
            <DialogTitle className="truncate">{title}</DialogTitle>
          </div>
          {headerAction && <div className="ml-auto flex items-center gap-2">{headerAction}</div>}
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">{children}</DialogBody>
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  )
}
