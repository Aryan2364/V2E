'use client'

import { useEffect, useId, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface ReasonDialogProps {
  open: boolean
  /** Called for Cancel, Escape, the close button and the backdrop. Ignored while `loading`. */
  onCancel: () => void
  /** Called with the trimmed reason (empty string when optional and left blank). */
  onConfirm: (reason: string) => void
  title: string
  description?: ReactNode
  /** Field label, sentence case ("Reason for reopening"). */
  label?: string
  placeholder?: string
  /** Required reasons show the star and an inline error when left empty (kit 11.3). */
  required?: boolean
  confirmLabel: string
  loadingLabel?: string
  destructive?: boolean
  loading?: boolean
  maxLength?: number
  /** Extra fields shown above the reason (e.g. a resolver-group picker). */
  children?: ReactNode
  /** Extra condition that keeps Confirm disabled (e.g. no group chosen yet). */
  confirmDisabled?: boolean
}

/**
 * One reason prompt for the Tasks area: a kit Dialog with a labelled Textarea, the
 * required star, an inline error, Cancel on the left and the confirm on the right,
 * and a loading state on the confirm button (kit 24, 11.3, 14).
 */
export default function ReasonDialog({
  open,
  onCancel,
  onConfirm,
  title,
  description,
  label = 'Reason',
  placeholder,
  required = true,
  confirmLabel,
  loadingLabel = 'Saving',
  destructive = false,
  loading = false,
  maxLength = 1000,
  children,
  confirmDisabled = false,
}: ReasonDialogProps) {
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const fieldId = useId()

  // A fresh prompt every time it opens.
  useEffect(() => {
    if (open) {
      setReason('')
      setTouched(false)
    }
  }, [open])

  const trimmed = reason.trim()
  const error = required && touched && !trimmed ? 'Enter a reason to continue.' : undefined

  function submit() {
    if (loading) return
    if (required && !trimmed) {
      setTouched(true)
      return
    }
    onConfirm(trimmed)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !loading) onCancel() }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {children}
          <div className="flex flex-col gap-2">
            <Label htmlFor={fieldId} required={required}>{label}</Label>
            <Textarea
              id={fieldId}
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, maxLength))}
              onBlur={() => setTouched(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit() }
              }}
              placeholder={placeholder}
              rows={3}
              autoFocus
              aria-invalid={error ? true : undefined}
              aria-required={required || undefined}
            />
            <InlineFieldError className="mt-0">{error}</InlineFieldError>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>Cancel</Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            onClick={submit}
            disabled={confirmDisabled}
            loading={loading}
            loadingLabel={loadingLabel}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
