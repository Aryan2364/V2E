'use client'

import React from 'react'
import { ChevronLeft } from 'lucide-react'
import { useBack } from '@/lib/back'
import { cx } from './primitives'

/*
 * The phone's app bar - FRONTEND_RULES_PHONE.md 41.4 rules 1 to 8.
 *
 *   - Filled primary, sticky at the top, padded by the top safe area so the
 *     phone's status bar sits on primary (41.13 rule 4) and by the side safe
 *     areas (41.13 rule 2).
 *   - One row, exactly 56px, that never grows with the text-size setting:
 *     the title is a fixed 20px, weight 500, one line, truncated (rules 1
 *     and 3). It is the screen's one h1.
 *   - Left: the back arrow on screens below the top level (rules 2 and 6).
 *     Right: at most two icon buttons from the phone icon set (rule 4).
 *   - No breadcrumbs on phone (rule 8).
 */

/** Section 41.4 rule 4: at most two icon buttons on the right. */
const MAX_ACTIONS = 2

/** An icon button in the bar: 44px, on-brand, its pressed fill a white tint. */
export const APP_BAR_BUTTON = cx(
  'inline-flex size-[44px] shrink-0 items-center justify-center rounded-full text-on-brand',
  'transition-[background-color] duration-(--duration-fast) active:bg-on-brand-pressed',
  'outline-hidden focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-on-brand',
  '[&_svg]:size-[22px]',
)

export function PhoneAppBar({
  title,
  leading,
  actions,
  belowTop = false,
}: {
  title: string
  leading?: React.ReactNode
  actions?: React.ReactNode
  belowTop?: boolean
}) {
  const count = React.Children.toArray(actions).length
  if (count > MAX_ACTIONS) {
    throw new Error(
      `The phone app bar was given ${count} actions. FRONTEND_RULES_PHONE.md 41.4 rule 4 allows two icon buttons; put the rest in the three-dot menu.`,
    )
  }
  const hasLeading = React.Children.toArray(leading).length > 0

  return (
    <header
      data-slot="phone-app-bar"
      data-below-top={belowTop ? '' : undefined}
      className={cx(
        'sticky top-0 z-(--z-shell) shrink-0 bg-primary text-on-brand',
        'pt-(--safe-top) pr-(--safe-right) pl-(--safe-left)',
      )}
    >
      <div
        className={cx(
          'flex h-(--spacing-topbar) items-center gap-[8px]',
          hasLeading ? 'pl-[4px]' : 'pl-[16px]',
          count > 0 ? 'pr-[4px]' : 'pr-[16px]',
        )}
      >
        {hasLeading ? <div className="flex shrink-0 items-center">{leading}</div> : null}
        <h1 className="min-w-0 flex-1 truncate text-bar-title font-medium">{title}</h1>
        {count > 0 ? <div className="flex shrink-0 items-center gap-[8px]">{actions}</div> : null}
      </div>
    </header>
  )
}

/**
 * 41.4 rules 6 and 7: chevron-left, screen-reader label "Back". It returns to
 * the previous screen in the app, or, opened from a notification or a link
 * with nothing before it, to the screen's parent (lib/back.ts).
 */
export function BackButton({ parent }: { parent: string }) {
  const back = useBack(parent)
  return (
    <button type="button" aria-label="Back" className={APP_BAR_BUTTON} onClick={back}>
      <ChevronLeft aria-hidden />
    </button>
  )
}
