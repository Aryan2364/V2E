'use client'

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { CheckCircle, XCircle, AlertTriangle, Info, X, type LucideIcon } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type ToastType = 'success' | 'error' | 'warning' | 'info'

interface Toast {
  id: string
  type: ToastType
  message: string
}

interface ToastContextValue {
  addToast: (message: string, type?: ToastType) => void
}

// ─── Config ───────────────────────────────────────────────────────────────────

const toastConfig: Record<
  ToastType,
  { bg: string; Icon: LucideIcon }
> = {
  success: { bg: 'bg-[#16A34A]', Icon: CheckCircle },
  error: { bg: 'bg-[#DC2626]', Icon: XCircle },
  warning: { bg: 'bg-[#D97706]', Icon: AlertTriangle },
  info: { bg: 'bg-[#0891B2]', Icon: Info },
}

const AUTO_DISMISS_MS = 3000

// ─── Context ──────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null)

// ─── Individual Toast Item ────────────────────────────────────────────────────

function ToastItem({
  toast,
  onRemove,
}: {
  toast: Toast
  onRemove: (id: string) => void
}) {
  const { bg, Icon } = toastConfig[toast.type]
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    timerRef.current = setTimeout(() => onRemove(toast.id), AUTO_DISMISS_MS)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [toast.id, onRemove])

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={[
        'flex items-center gap-3 min-w-[280px] max-w-sm w-full px-4 py-3 rounded-[10px] shadow-lg text-white text-sm font-medium',
        bg,
      ].join(' ')}
    >
      <Icon size={18} className="shrink-0" aria-hidden="true" />
      <span className="flex-1 leading-snug">{toast.message}</span>
      <button
        onClick={() => onRemove(toast.id)}
        className="shrink-0 text-white/80 hover:text-white transition-colors focus:outline-hidden"
        aria-label="Dismiss notification"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  )
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const addToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`
    setToasts((prev) => [...prev, { id, type, message }])
  }, [])

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      {/* Portal-like fixed container. data-slot lets the phone layout move it to
          the bottom, above the tab bar (globals.css, FRONTEND_RULES_PHONE.md 41.8
          rule 12); desktop keeps this top-right stack. */}
      <div
        aria-label="Notifications"
        data-slot="toast-region"
        className="fixed top-4 right-4 z-9999 flex flex-col gap-2 pointer-events-none"
      >
        {toasts.map((toast) => (
          <div key={toast.id} className="pointer-events-auto">
            <ToastItem toast={toast} onRemove={removeToast} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return ctx
}

// ─── Default export (standalone, no provider needed for simple usage) ─────────

export default function ToastContainer() {
  return null // ToastProvider renders the container — this export is a no-op placeholder
}
