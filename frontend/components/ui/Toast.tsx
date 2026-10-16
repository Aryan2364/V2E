'use client'

/**
 * Legacy adapter (v2e kit-alignment P3): the pre-kit Toast was a
 * self-hosted ToastProvider/useToast pair rendering its own fixed top-right
 * stack. ~323 call sites use `useToast().addToast(message, type)`; that is
 * far too many to migrate by hand this phase (fan-out rule,
 * components/ui/ADAPTERS.md), so this file keeps the `useToast` name and
 * `addToast` signature but delegates to the kit's sonner.tsx (section 25).
 * `<Toaster />` is mounted once in app/layout.tsx; this file renders no DOM
 * of its own. `ToastProvider` is kept as a no-op passthrough so the single
 * existing wrapping call site in app/layout.tsx does not need to change.
 */
import React, { createContext, useCallback, useContext } from 'react'
import { toast } from '@/components/ui/sonner'

type ToastType = 'success' | 'error' | 'warning' | 'info'

interface ToastContextValue {
  addToast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextValue>({
  addToast: (message, type = 'info') => {
    if (type === 'success') toast.success(message)
    else if (type === 'error') toast.error(message)
    else if (type === 'warning') toast.warning(message)
    else toast.message(message)
  },
})

export function ToastProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

export function useToast() {
  return useContext(ToastContext)
}

export default function ToastContainer() {
  return null
}
