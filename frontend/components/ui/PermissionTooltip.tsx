'use client'

import type { ReactNode } from 'react'
import Tooltip from './Tooltip'

interface PermissionTooltipProps {
  /** true: allowed. false: not allowed — show the reason. undefined: not known yet. */
  allowed: boolean | undefined
  /**
   * Who may do it, named by what they are allowed to do — never a role, never "You do
   * not have permission" (kit §26.2). E.g. "Only people allowed to create task tags
   * can do this."
   */
  reason: string
  children: ReactNode
  /**
   * Layout classes for the wrapper, used only while it exists (allowed === false).
   * Defaults to `inline-flex`; pass e.g. `flex w-full` for a full-width row.
   */
  className?: string
}

/**
 * Makes the reason a control is disabled reachable by hover, keyboard focus AND tap
 * (kit §19, §26) — ported from frontend-kit/components/ui/permission-tooltip.tsx onto
 * v2e's own portal Tooltip.
 *
 * Why a wrapper: a disabled control never receives a hover, so a tooltip on the
 * control itself can never open. The hover, focus and tap are caught by this wrapper,
 * which is NOT disabled and IS focusable (a keyboard user cannot hover). Everything
 * inside it has `pointer-events-none`, so the pointer always lands on the wrapper —
 * including on browsers that would otherwise swallow events over a disabled button.
 *
 * - `allowed === true`: children render untouched — no wrapper, no extra element.
 * - `allowed === undefined` (permissions still loading, §26.1): children render
 *   untouched and NO reason is shown. A reason shown before the answer lands is a guess.
 * - `allowed === false`: the wrapper and its reason.
 *
 * This component does not disable anything: the caller keeps its control disabled
 * with `disabled={allowed !== true}`, so "not known yet" is disabled too.
 *
 * `allowed` is required (with `undefined` accepted) so no caller can forget it and
 * silently land in "not known yet" for ever.
 */
export function PermissionTooltip({ allowed, reason, children, className = 'inline-flex' }: PermissionTooltipProps) {
  if (allowed !== false) return <>{children}</>

  return (
    <Tooltip label={reason} placement="bottom" openOnTap>
      <span
        // Focusable so the reason reaches a keyboard user, who has no pointer.
        tabIndex={0}
        role="note"
        aria-label={reason}
        className={`${className} cursor-not-allowed rounded-[8px] outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 [&_*]:pointer-events-none`}
      >
        {children}
      </span>
    </Tooltip>
  )
}

export default PermissionTooltip
