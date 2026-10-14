'use client'

import React from 'react'
import { WifiOff } from 'lucide-react'
import { BackButton, PhoneAppBar } from './PhoneAppBar'
import { cx } from './primitives'

/*
 * One phone screen: its app bar, then the content area
 * (FRONTEND_RULES_PHONE.md 41.4 rules 1 to 7 and 20, 41.13).
 *
 *   - A screen with a `parent` is below the top level: the app bar has the
 *     back arrow, and the shell shows no tab bar (41.4 rule 11).
 *   - Content: 16px at the sides plus the side safe areas, 16px above the
 *     first block, no maximum width (rule 20); held sideways it stays in a
 *     centred 600px column (41.13 rule 10). Its bottom padding clears
 *     whatever bar is at the bottom plus the bottom safe area.
 *   - The window scrolls, not a frame: heights use dvh, never 100vh (41.13
 *     rule 5).
 *   - Right under the app bar, the offline banner while the connection is
 *     down (41.14 rule 6).
 */

/* 16px plus the side safe area, or wider to centre a 600px column sideways. */
const SIDE_PADDING =
  'pl-[max(calc(16px_+_var(--safe-left)),calc((100vw_-_var(--phone-column))_/_2))] pr-[max(calc(16px_+_var(--safe-right)),calc((100vw_-_var(--phone-column))_/_2))]'

export default function PhoneScreen({
  title,
  parent,
  actions,
  children,
}: {
  title: string
  parent?: string
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <>
      <PhoneAppBar
        title={title}
        belowTop={parent !== undefined}
        leading={parent !== undefined ? <BackButton parent={parent} /> : undefined}
        actions={actions}
      />
      <ConnectionBanner />
      <main
        id="content"
        tabIndex={-1}
        data-slot="phone-content"
        className={cx(
          'w-full min-w-0 flex-1 outline-none',
          SIDE_PADDING,
          'pt-[16px] pb-[calc(var(--bottom-bar)+var(--safe-bottom)+16px)]',
        )}
      >
        {children}
      </main>
    </>
  )
}

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

/**
 * 41.14 rule 6: a neutral banner above the content while the connection is
 * down; it goes when the connection returns. The server cannot know, and
 * assumes online.
 */
function ConnectionBanner() {
  const online = React.useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  )
  if (online) return null
  return (
    <div
      role="status"
      className="flex items-start gap-[12px] border-b border-phone-border-light bg-phone-surface-control px-[16px] py-[12px] text-phone-body text-phone-text-primary"
    >
      <WifiOff aria-hidden className="mt-[2px] size-[20px] shrink-0 text-phone-text-secondary" />
      <p>You are offline. Changes cannot be saved until you are back online.</p>
    </div>
  )
}
