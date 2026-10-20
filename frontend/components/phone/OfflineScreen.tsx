'use client'

import React from 'react'
import { RefreshCw, WifiOff } from 'lucide-react'

/*
 * The offline screen - FRONTEND_RULES_PHONE.md 41.14 rule 9, 41.20 check 20.
 *
 * What the installed app shows when it is opened, or moves to a page, with no
 * connection: the service worker (public/sw.js) answers the failed navigation
 * with this page, cached ahead of time. A static app bar with the product
 * name (no back arrow and no tab bar: each needs the network), the offline
 * banner (41.14 rule 6), and the failed state with "Try again", which reloads
 * the address the person asked for.
 *
 * COLOURS ARE V2E'S OWN VALUES WRITTEN OUT, not the phone tokens, on purpose:
 * the page is prerendered at build time, when there is no request to guess
 * the layout from, so its HTML says data-layout="desktop" until the browser
 * corrects it. Written out, it paints right from the first frame either way.
 * The values are the phone brand block's (app/globals.css).
 */
export default function OfflineScreen() {
  return (
    <div className="flex min-h-dvh flex-col bg-surface-sunken text-text-primary">
      <header className="bg-primary pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] text-white">
        <div className="flex h-[56px] items-center px-[16px]">
          <h1 className="truncate text-[20px] font-medium leading-[1.3]">V2E</h1>
        </div>
      </header>

      <div
        role="status"
        className="flex items-start gap-[12px] border-b border-border-light bg-surface-control px-[16px] py-[12px] text-[1rem] text-text-primary"
      >
        <WifiOff aria-hidden className="mt-[2px] size-[20px] shrink-0 text-text-secondary" />
        <p>You are offline. Changes cannot be saved until you are back online.</p>
      </div>

      <main className="flex flex-1 flex-col items-center px-[24px] py-[48px] text-center">
        <span
          aria-hidden
          className="mb-[16px] flex size-[56px] items-center justify-center rounded-full bg-primary-subtle text-primary-text"
        >
          <WifiOff className="size-[26px]" />
        </span>
        <h2 className="text-[1.125rem] font-medium text-text-primary">This screen needs a connection</h2>
        <p className="mt-[8px] max-w-[420px] text-[1rem] text-text-secondary">
          Check your mobile data or Wi-Fi, then try again.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-[24px] inline-flex min-h-11 w-full max-w-[420px] items-center justify-center gap-[8px] rounded-[8px] border-2 border-primary bg-primary px-[16px] py-[8px] text-[1rem] font-medium text-white active:bg-primary-pressed outline-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-ring"
        >
          <RefreshCw aria-hidden className="size-[18px]" />
          Try again
        </button>
      </main>
    </div>
  )
}
