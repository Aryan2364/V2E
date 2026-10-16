'use client'

import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

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
   */
  elevated?: boolean
}

const sizeClasses: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
}

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  closeOnEscape = true,
  elevated = false,
  bodyScroll = true,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Close on Escape key
  useEffect(() => {
    if (!isOpen || !closeOnEscape) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose, closeOnEscape])

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  if (!isOpen || !mounted) return null

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose()
  }

  return createPortal(
    <div
      className={`fixed inset-0 ${elevated ? 'z-75' : 'z-60'} flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm`}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'modal-title' : undefined}
    >
      <div
        ref={panelRef}
        className={[
          'relative w-full bg-white rounded-t-[16px] sm:rounded-[12px] shadow-[0_8px_32px_rgba(0,0,0,0.16)] border border-border-light',
          'max-h-[92vh] flex flex-col',
          sizeClasses[size],
        ].join(' ')}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-border-light shrink-0">
          {title && (
            <h2
              id="modal-title"
              className="text-[22px] font-semibold text-text-primary leading-tight"
            >
              {title}
            </h2>
          )}
          <button
            onClick={onClose}
            className="ml-auto flex items-center justify-center w-8 h-8 rounded-[6px] text-text-muted hover:text-text-primary hover:bg-surface-control transition-colors duration-150 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Close modal"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className={['px-6 py-5', bodyScroll ? 'overflow-y-auto' : 'flex-1 min-h-0 flex flex-col'].join(' ')}>{children}</div>
      </div>
    </div>,
    document.body,
  )
}
