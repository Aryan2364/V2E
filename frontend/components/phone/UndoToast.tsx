'use client'

import React from 'react'
import { createPortal } from 'react-dom'
import { cx } from './primitives'

/*
 * The phone's single Undo toast - KIT-PENDING-phone-task-tick.md item 2,
 * FRONTEND_RULES.md §38.1 (10s Undo pattern), FRONTEND_RULES_PHONE.md §41.8
 * rule 13 ("one Undo toast at a time").
 *
 * Completing a second row while one Undo toast is showing REPLACES it
 * cleanly (the first task's completion stands, un-undoable through the
 * toast once replaced - it only stops showing the option, it does not
 * revert anything) rather than stacking a second toast.
 *
 * Portalled to <body>, fixed above the tab bar / keyboard, 10 second
 * auto-dismiss. Not the shared desktop <Toast> component: that one has no
 * action button and a fixed 3s auto-dismiss, neither of which fit this
 * pattern.
 */

type UndoState = {
  id: string
  message: string
  onUndo: () => void | Promise<void>
}

type UndoToastContextValue = {
  /** Shows the Undo toast, replacing any toast currently showing. */
  showUndo: (message: string, onUndo: () => void | Promise<void>) => void
  /** Dismisses the toast if it is still the one identified by `id` (no-op otherwise). */
  dismiss: (id: string) => void
}

const UNDO_WINDOW_MS = 10_000

const UndoToastContext = React.createContext<UndoToastContextValue | null>(null)

export function useUndoToast(): UndoToastContextValue {
  const ctx = React.useContext(UndoToastContext)
  if (!ctx) throw new Error('useUndoToast must be used within an UndoToastProvider')
  return ctx
}

export function UndoToastProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<UndoState | null>(null)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  const clear = React.useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const showUndo = React.useCallback(
    (message: string, onUndo: () => void | Promise<void>) => {
      clear()
      const id = `undo-${Date.now()}-${Math.random().toString(36).slice(2)}`
      setState({ id, message, onUndo })
      timerRef.current = setTimeout(() => {
        setState((cur) => (cur?.id === id ? null : cur))
      }, UNDO_WINDOW_MS)
    },
    [clear],
  )

  const dismiss = React.useCallback((id: string) => {
    setState((cur) => (cur?.id === id ? null : cur))
  }, [])

  React.useEffect(() => clear, [clear])

  const value = React.useMemo(() => ({ showUndo, dismiss }), [showUndo, dismiss])

  return (
    <UndoToastContext.Provider value={value}>
      {children}
      {mounted && state
        ? createPortal(
            <div
              role="status"
              aria-live="polite"
              data-slot="undo-toast"
              className={cx(
                'fixed inset-x-0 z-80 flex justify-center px-[16px]',
                'bottom-[calc(var(--bottom-bar)+var(--safe-bottom)+16px)]',
              )}
            >
              <div className="flex w-full max-w-[420px] items-center gap-[12px] rounded-[10px] bg-text-primary px-[16px] py-[12px] shadow-dialog">
                <span className="min-w-0 flex-1 text-body text-white">{state.message}</span>
                <button
                  type="button"
                  className="shrink-0 rounded-[6px] px-[8px] py-[4px] text-body font-medium text-primary-border active:bg-white/10"
                  onClick={() => {
                    const toUndo = state.onUndo
                    clear()
                    setState(null)
                    void toUndo()
                  }}
                >
                  Undo
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </UndoToastContext.Provider>
  )
}
