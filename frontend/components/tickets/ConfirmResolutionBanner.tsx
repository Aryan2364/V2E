'use client'

import { CheckCircle2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  ticketNumber: string
  onConfirm: () => void
  onClose: () => void
  loading?: boolean
}

export default function ConfirmResolutionBanner({ ticketNumber, onConfirm, onClose, loading }: Props) {
  return (
    <div className="flex items-start gap-3 p-4 bg-primary-subtle border border-primary-border rounded-[10px]">
      <CheckCircle2 size={18} className="text-primary-text shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-body font-medium text-primary-text">Resolution Confirmation Required</p>
        <p className="text-body text-primary-text mt-0.5">
          The assignee has marked {ticketNumber} as resolved. Please confirm if your issue is resolved.
        </p>
        <div className="flex items-center gap-2 mt-3">
          <Button type="button" onClick={onConfirm} disabled={loading}>
            <CheckCircle2 size={14} /> Confirm resolved
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading} className="text-danger">
            <XCircle size={14} /> Not resolved
          </Button>
        </div>
      </div>
    </div>
  )
}
