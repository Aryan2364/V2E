'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Loader2 } from 'lucide-react'

/**
 * Asks before leaving a form with unsaved changes (kit §11.3 rule 10):
 *  - a link inside the app, or the browser's Back button → the styled "Leave without
 *    saving?" dialog (Back is held by one extra history entry while there are changes);
 *  - closing or reloading the tab → the browser's own warning (the one dialog no page
 *    can style).
 * `words`: 'create' while the record doesn't exist yet, 'edit' once it does.
 * `save`: when given, the dialog also offers "Save and leave" (primary). It runs the
 * page's own save — the same one its header button runs — and leaves only when that
 * resolves true; on false the dialog closes and the page shows why it did not save.
 * Call `disarm()` right after a successful save, before the page settles.
 */
export function useUnsavedChangesGuard(
  dirty: boolean,
  words: 'create' | 'edit',
  save?: { run: () => Promise<boolean>; label: string },
) {
  const router = useRouter()
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const saveRef = useRef(save)
  saveRef.current = save
  const [pending, setPending] = useState<null | (() => void)>(null)
  const [savingToLeave, setSavingToLeave] = useState(false)
  /** A guard entry is on top of the history stack. */
  const armed = useRef(false)
  /** The next popstate is our own (disarm), not the person pressing Back. */
  const ignorePop = useRef(false)

  // Closing / reloading the tab, or typing another address.
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  // Links inside the app (sidebar, breadcrumbs, "View"…).
  useEffect(() => {
    if (!dirty) return
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return
      const url = new URL(a.href, window.location.href)
      if (url.origin !== window.location.origin) return // another site: the browser warns
      if (url.pathname === window.location.pathname && url.search === window.location.search) return
      e.preventDefault()
      e.stopPropagation()
      setPending(() => () => router.push(`${url.pathname}${url.search}${url.hash}`))
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [dirty, router])

  // The browser's Back button.
  useEffect(() => {
    if (!dirty) return
    if (!armed.current) {
      window.history.pushState({ ...(window.history.state ?? {}), wfGuard: true }, '')
      armed.current = true
    }
    const onPop = () => {
      if (ignorePop.current) {
        ignorePop.current = false
        return
      }
      if (!dirtyRef.current) return
      // Back was pressed: stay on this page (re-arm) and ask.
      window.history.pushState({ ...(window.history.state ?? {}), wfGuard: true }, '')
      setPending(() => () => {
        // Still armed (leaving without saving): step over the guard entry too. A save
        // in between has already dropped it (disarm), so one step is the page before.
        if (armed.current) {
          armed.current = false
          window.history.go(-2)
        } else window.history.go(-1)
      })
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [dirty])

  /** Drop the guard history entry (after a save), so Back works in one press again. */
  const disarm = useCallback(async () => {
    if (!armed.current) return
    armed.current = false
    if (!window.history.state?.wfGuard) return
    await new Promise<void>((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        window.removeEventListener('popstate', finish)
        resolve()
      }
      window.addEventListener('popstate', finish)
      ignorePop.current = true
      window.history.back()
      setTimeout(finish, 500)
    })
  }, [])

  /** Run `go` now, or after the person confirms they want to leave their changes. */
  const confirmLeave = useCallback((go: () => void) => {
    if (!dirtyRef.current) go()
    else setPending(() => go)
  }, [])

  const stay = useCallback(() => {
    if (!savingToLeave) setPending(null)
  }, [savingToLeave])

  const leave = () => {
    const go = pending
    setPending(null)
    dirtyRef.current = false
    go?.()
  }

  const saveAndLeave = async () => {
    const run = saveRef.current?.run
    if (!run || savingToLeave) return
    const go = pending
    setSavingToLeave(true)
    let ok = false
    try {
      ok = await run()
    } finally {
      setSavingToLeave(false)
    }
    // Not saved: stay on the page, where the save shows what stopped it.
    setPending(null)
    if (!ok) return
    dirtyRef.current = false
    go?.()
  }

  // Escape is "Stay", like the backdrop.
  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        stay()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [pending, stay])

  const canSave = !!save
  const title = words === 'create' ? 'Leave this workflow?' : 'Leave without saving?'
  const message =
    words === 'create'
      ? canSave
        ? 'What you have filled in will be lost unless you save it.'
        : 'What you have filled in will be lost.'
      : canSave
        ? 'Your changes to this workflow will be lost unless you save them.'
        : 'Your changes to this workflow will be lost.'

  const dialog =
    pending && typeof document !== 'undefined'
      ? createPortal(
          <div className="fixed inset-0 z-[70] flex items-center justify-center px-4 bg-black/50" onClick={stay}>
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="unsaved-title"
              aria-describedby="unsaved-message"
              className="bg-white rounded-[16px] w-full max-w-md sm:max-w-[540px] p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3 mb-5">
                <div className="w-10 h-10 rounded-full bg-[#FEE2E2] flex items-center justify-center shrink-0">
                  <AlertTriangle size={20} className="text-[#DC2626]" />
                </div>
                <div className="min-w-0">
                  <h3 id="unsaved-title" className="text-[18px] font-semibold text-[#0F172A]">
                    {title}
                  </h3>
                  <p id="unsaved-message" className="text-sm text-[#475569] mt-1">
                    {message}
                  </p>
                </div>
              </div>
              <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={stay}
                  disabled={savingToLeave}
                  className="min-h-[44px] sm:min-h-[40px] px-4 whitespace-nowrap text-sm font-semibold text-[#475569] hover:text-[#0F172A] rounded-[8px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] disabled:opacity-60"
                >
                  {words === 'create' ? 'Keep filling' : 'Stay'}
                </button>
                <button
                  type="button"
                  onClick={leave}
                  disabled={savingToLeave}
                  className={[
                    'min-h-[44px] sm:min-h-[40px] px-4 whitespace-nowrap text-sm font-semibold rounded-[8px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#DC2626] focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60',
                    // With a save on offer, leaving is the second choice: outlined danger.
                    canSave
                      ? 'bg-white text-[#B91C1C] border border-[#FCA5A5] hover:bg-[#FEF2F2]'
                      : 'bg-[#DC2626] text-white hover:bg-[#B91C1C]',
                  ].join(' ')}
                >
                  {words === 'create' && !canSave ? 'Leave' : 'Leave without saving'}
                </button>
                {save && (
                  <button
                    type="button"
                    // The safe choice takes the focus, so Enter keeps the work.
                    autoFocus
                    onClick={saveAndLeave}
                    disabled={savingToLeave}
                    className="inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-[40px] px-5 whitespace-nowrap text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-[8px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:bg-[#93C5FD]"
                  >
                    {savingToLeave && <Loader2 size={15} className="animate-spin" />}
                    {save.label}
                  </button>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )
      : null

  return { dialog, disarm, confirmLeave }
}

export type UnsavedGuard = ReturnType<typeof useUnsavedChangesGuard>
