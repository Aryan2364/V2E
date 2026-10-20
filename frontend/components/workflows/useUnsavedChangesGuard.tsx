'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog'

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

  const canSave = !!save
  const title = words === 'create' ? 'Leave this workflow?' : 'Leave without saving?'
  const message = words === 'create' ? 'What you have entered will be lost.' : 'Your changes will be lost.'

  // The kit AlertDialog refuses Escape and the backdrop, so "Stay" is only ever an explicit press
  // (and Android back, which the kit maps to Cancel).
  const dialog = (
    <AlertDialog
      open={!!pending}
      onOpenChange={(next) => {
        if (!next) stay()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {/* A Close: pressing it fires onOpenChange(false) above, which is "Stay". */}
          <AlertDialogCancel disabled={savingToLeave}>Stay</AlertDialogCancel>
          <Button variant="danger" onClick={leave} disabled={savingToLeave}>
            {words === 'create' && !canSave ? 'Leave' : 'Leave without saving'}
          </Button>
          {save && (
            <Button
              variant="primary"
              // The safe choice takes the focus, so Enter keeps the work.
              autoFocus
              onClick={saveAndLeave}
              loading={savingToLeave}
            >
              {save.label}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return { dialog, disarm, confirmLeave }
}

export type UnsavedGuard = ReturnType<typeof useUnsavedChangesGuard>
