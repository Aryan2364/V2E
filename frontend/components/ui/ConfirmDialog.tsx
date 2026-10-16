'use client'

import { createPortal } from 'react-dom'
import { Loader2, AlertTriangle } from 'lucide-react'

/**
 * Shared confirmation dialog — replaces the browser's native confirm(). Portals to
 * <body> (so no ancestor transform/overflow can clip it), centered with a dimmed
 * backdrop, and follows DESIGN_RULES (danger = red button). Supports an inline
 * loading spinner and an error message so a failed action shows here, not as a
 * raw error overlay.
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
  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-70 flex items-center justify-center px-4 bg-black/50"
      onClick={() => { if (!loading) onCancel() }}
    >
      <div className="bg-white rounded-[16px] w-full max-w-sm p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-4">
          {danger && (
            <div className="w-10 h-10 rounded-full bg-danger-bg flex items-center justify-center shrink-0">
              <AlertTriangle size={20} className="text-danger" />
            </div>
          )}
          <div className="min-w-0">
            <h3 className="text-[18px] font-semibold text-text-primary">{title}</h3>
            {message && <p className="text-sm text-text-secondary mt-1">{message}</p>}
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-[8px] border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2.5 text-sm font-semibold text-text-secondary hover:text-text-primary transition-colors disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={[
              'flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white rounded-[8px] transition-colors disabled:bg-surface-control-pressed disabled:text-text-muted disabled:cursor-not-allowed',
              danger ? 'bg-danger hover:bg-danger-hover' : 'bg-primary hover:bg-primary-hover',
            ].join(' ')}
          >
            {loading && <Loader2 size={15} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
