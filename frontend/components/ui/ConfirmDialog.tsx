'use client'

import { Loader2 } from 'lucide-react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

/**
 * Thin adapter: same name and props every call site already uses (see
 * components/ui/ADAPTERS.md), implemented on the kit's AlertDialog (section
 * 15). Danger-by-default per the brief; Escape and the backdrop are ignored
 * by the kit's alert-dialog itself (section 24 rule 3), which is the
 * intended behaviour there, not a regression from the old hand-rolled
 * version (which also only closed via its two buttons).
 *
 * The old ConfirmDialog's own loading-spinner-on-confirm and inline error
 * message aren't modelled by alert-dialog.tsx, so they're added here, inside
 * the adapter, rather than touching the kit file.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  loading = false,
  error = null,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  loading?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {message ? <AlertDialogDescription>{message}</AlertDialogDescription> : null}
          {error ? (
            <div className="rounded-[8px] border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
              {error}
            </div>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          {/*
           * No onClick here: AlertDialogCancel is a Base UI Close, so
           * clicking it already fires onOpenChange(false) above, which
           * calls onCancel. Adding onClick too would call onCancel twice.
           */}
          <AlertDialogCancel disabled={loading}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            variant={danger ? 'danger' : 'primary'}
            disabled={loading}
            onClick={onConfirm}
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : null}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
