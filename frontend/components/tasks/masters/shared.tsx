import React from 'react'
import { Label } from '@/components/ui/label'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { Skeleton } from '@/components/ui/skeleton'
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

// ─── Shared helpers ───────────────────────────────────────────────────────────

export function FormField({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: React.ReactNode }) {
  // A trailing "*" or "(optional)" in the label text is folded into the kit's required star (kit 11.3 rule 3).
  const isRequired = required ?? /\s\*$/.test(label)
  const text = label.replace(/\s*\*$/, '').replace(/\s*\(optional\)$/i, '').replace(/,\s*optional\)$/i, ')')
  return (
    <div>
      <Label className="mb-2" required={isRequired}>{text}</Label>
      {children}
      <InlineFieldError>{error}</InlineFieldError>
    </div>
  )
}

// NestJS validation errors arrive as a string or string[] under response.data.message.
export function apiError(e: unknown): string | null {
  const msg = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message
  if (Array.isArray(msg)) return msg[0] ?? null
  return msg ?? null
}

export const inputCls = 'w-full border border-border rounded-control px-3 py-[8px] text-body text-text-primary placeholder:text-text-muted focus:border-2 focus:border-primary focus:outline-hidden bg-surface'

/** Solid blue count pill beside a heading; hidden when the count is 0. */
export function CountPill({ n }: { n: number }) {
  if (!n) return null
  return (
    <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-meta font-medium leading-none">
      {n}
    </span>
  )
}

export function Spinner() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-control" />
      ))}
    </div>
  )
}

/** One confirmation dialog, reused by every master list's delete/archive action (section 15). */
export function ConfirmDeleteDialog({ open, onOpenChange, title, description, confirmLabel = 'Delete', onConfirm }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel?: string
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

