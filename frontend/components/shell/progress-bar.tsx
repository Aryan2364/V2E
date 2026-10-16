'use client'

import * as React from 'react'
import Link, { type LinkProps } from 'next/link'

/**
 * Minimal shim (v2e kit-alignment P3): the kit's components/shell/
 * progress-bar.tsx (section 5.6's page-loading bar, section 36.5) is part
 * of the kit's own AppShell, which v2e does not adopt this phase (locked
 * decision D4). v2e has no equivalent "navigation in progress" signal yet,
 * so this shim is a safe no-op: `useOptionalProgress` always reports no
 * progress context (satisfies components/ui/keyboard-shortcuts.tsx and the
 * kitchen sink's demo), `useProgress` is a real hook so a future page can
 * call it without a type error, and `ShellLink` is a plain next/link
 * passthrough. `ProgressBar` renders nothing. Building the real bar is
 * follow-up work for whichever phase ports the kit's AppShell.
 */
type ProgressApi = {
  start: () => void
  done: () => void
  navigate: (href: string) => void
}

function useProgress(): ProgressApi {
  return React.useMemo(
    () => ({ start: () => {}, done: () => {}, navigate: (href: string) => { window.location.href = href } }),
    []
  )
}

function useOptionalProgress(): ProgressApi | null {
  return null
}

function ProgressProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

function ProgressBar({ className }: { className?: string }) {
  return null
}

function ShellLink(props: LinkProps & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <Link {...props} />
}

export { ProgressProvider, ProgressBar, ShellLink, useProgress, useOptionalProgress }
export type { ProgressApi }
