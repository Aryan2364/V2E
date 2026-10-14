'use client'

import React from 'react'
import Link from 'next/link'

/*
 * The phone tree's small shared parts (FRONTEND_RULES_PHONE.md 41.9). Phone
 * components only: every colour reads a phone token (the `phone-*` Tailwind
 * aliases), which exist only under html[data-layout="phone"].
 *
 *   - No hover styles anywhere in the phone tree: a phone has no hover, and a
 *     hover style sticks after a tap (41.9 rule 1). The pressed state
 *     (active:) is the feedback.
 *   - Every control is at least 44px tall (--h-control, 41.9 rule 2), and
 *     controls sit at least 8px apart (41.9 rule 4).
 *   - Spacing is px, not rem: on iPhone the rem follows the text-size setting
 *     and spacing must not grow with it (41.9 rule 7).
 */

/** Joins class names, skipping the empty ones. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

/** The focus ring every phone control shows on keyboard focus. */
export const FOCUS_RING =
  'outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phone-primary-ring'

type Variant = 'primary' | 'secondary'

/*
 * V2E's own button looks (DESIGN_RULES.md "Buttons"), at the phone's sizes:
 * primary filled blue with white text; secondary white with a 2px blue
 * border and blue text. Disabled uses V2E's explicit disabled colours, never
 * opacity.
 */
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-phone-primary text-phone-primary-foreground border-2 border-phone-primary active:bg-phone-primary-pressed active:border-phone-primary-pressed',
  secondary:
    'bg-phone-surface text-phone-primary-text border-2 border-phone-primary active:bg-phone-primary-subtle',
}

const BUTTON = cx(
  'inline-flex min-h-[var(--h-control)] items-center justify-center gap-[8px] rounded-[8px] px-[16px] py-[8px]',
  'text-phone-body font-semibold text-center',
  'transition-[background-color,border-color] duration-[var(--duration-fast)]',
  'disabled:bg-phone-surface-control-pressed disabled:border-phone-surface-control-pressed disabled:text-phone-text-secondary disabled:cursor-not-allowed',
  '[&_svg]:size-[18px] [&_svg]:shrink-0',
  FOCUS_RING,
)

export function PhoneButton({
  variant = 'secondary',
  fullWidth = false,
  className,
  type = 'button',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; fullWidth?: boolean }) {
  return (
    <button
      type={type}
      className={cx(BUTTON, VARIANTS[variant], fullWidth && 'w-full', className)}
      {...props}
    />
  )
}

/** A button-looking link (it goes somewhere, so it is a link). */
export function PhoneLinkButton({
  variant = 'secondary',
  fullWidth = false,
  className,
  href,
  children,
}: {
  variant?: Variant
  fullWidth?: boolean
  className?: string
  href: string
  children: React.ReactNode
}) {
  return (
    <Link href={href} className={cx(BUTTON, VARIANTS[variant], fullWidth && 'w-full', className)}>
      {children}
    </Link>
  )
}

/**
 * The edge-to-edge block of rows (41.5 rule 8): surface, a border-light line
 * between rows and above and below the block. Inside the content area it
 * bleeds out over the side padding with -mx-[16px] (PhoneContent pads 16px
 * plus the side safe areas; the safe area stays padded).
 */
export const ROW_BLOCK =
  '-mx-[16px] divide-y divide-phone-border-light border-y border-phone-border-light bg-phone-surface'

/** One tappable row, at least 48px, 16px in from the sides (41.5 rule 8, 41.8 rule 7). */
export const ROW = cx(
  'flex min-h-[48px] w-full items-center gap-[12px] px-[16px] py-[12px] text-left',
  'text-phone-body text-phone-text-primary',
  'transition-[background-color] duration-[var(--duration-fast)] active:bg-phone-surface-control',
  'outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-phone-primary-ring',
)
