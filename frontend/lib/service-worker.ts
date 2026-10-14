'use client'

import * as React from 'react'

/**
 * The page's side of the service worker (public/sw.js) on a phone -
 * FRONTEND_RULES_PHONE.md 41.14 rule 9.
 *
 * Adapted from the RGB frontend kit's lib/service-worker.ts. V2E already
 * registers /sw.js for device notifications (lib/push.ts), in both layouts,
 * at the plain address /sw.js; one origin has one worker for scope "/", so
 * this registers that same address rather than the kit's /sw.js?release=...
 * form, which would replace the notification worker's registration. The
 * kit's new-version banner (41.14 rule 11) is not part of this slice.
 *
 * PHONE ONLY, PRODUCTION ONLY, SECURE CONTEXT ONLY. In development every
 * file changes on every save (the worker also refuses to cache unhashed
 * files); on a computer nothing new is registered, so desktop is unchanged.
 *
 * After registering, it asks the worker once per page load to bring its
 * cached offline screen up to this release (REFRESH_OFFLINE), so the
 * installed app opened without a connection shows the current offline
 * screen rather than the browser's error page.
 */

let started = false

function supported(): boolean {
  return (
    process.env.NODE_ENV === 'production' &&
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'serviceWorker' in navigator
  )
}

async function start() {
  if (started || !supported()) return
  started = true
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      // The browser's own update check never reads sw.js from the HTTP cache.
      updateViaCache: 'none',
    })
    const ready = await navigator.serviceWorker.ready
    ;(ready.active ?? registration.active)?.postMessage({ type: 'REFRESH_OFFLINE' })
  } catch {
    // Refused (private mode, storage full, blocked): the app works as a
    // plain website. Nothing to show.
  }
}

/** Registers the worker on a phone. Mounted by the phone shell. */
export function useServiceWorkerRegistration(phone: boolean): void {
  React.useEffect(() => {
    if (phone) void start()
  }, [phone])
}

/**
 * The installed app's icon badge (Badging API), from the unread count the
 * app already keeps. Phone only; feature-checked, and a refusal is ignored.
 */
export function useAppBadge(phone: boolean, count: number): void {
  React.useEffect(() => {
    if (!phone || typeof navigator === 'undefined') return
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>
      clearAppBadge?: () => Promise<void>
    }
    try {
      if (count > 0) void nav.setAppBadge?.(count)?.catch(() => {})
      else void nav.clearAppBadge?.()?.catch(() => {})
    } catch {
      /* not supported */
    }
  }, [phone, count])
}
