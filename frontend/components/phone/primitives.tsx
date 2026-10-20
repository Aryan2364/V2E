'use client'

import React from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { InlineFieldError } from '@/components/ui/inline-field-error'

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
  'outline-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-ring'

type Variant = 'primary' | 'secondary'

/*
 * V2E's own button looks (DESIGN_RULES.md "Buttons"), at the phone's sizes:
 * primary filled blue with white text; secondary white with a 2px blue
 * border and blue text. Disabled uses V2E's explicit disabled colours, never
 * opacity.
 */
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-primary text-primary-foreground border-2 border-primary active:bg-primary-pressed active:border-primary-pressed',
  secondary:
    'bg-surface text-primary-text border-2 border-primary active:bg-primary-subtle',
}

const BUTTON = cx(
  'inline-flex min-h-(--h-control) items-center justify-center gap-[8px] rounded-[8px] px-[16px] py-[8px]',
  'text-body font-medium text-center',
  'transition-[background-color,border-color] duration-(--duration-fast)',
  'disabled:bg-surface-control-pressed disabled:border-surface-control-pressed disabled:text-text-secondary disabled:cursor-not-allowed',
  '[&_svg]:size-[18px] [&_svg]:shrink-0',
  FOCUS_RING,
)

export function PhoneButton({
  variant = 'secondary',
  fullWidth = false,
  loading = false,
  className,
  type = 'button',
  disabled,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; fullWidth?: boolean; loading?: boolean }) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(BUTTON, VARIANTS[variant], fullWidth && 'w-full', className)}
      {...props}
    >
      {loading ? <Loader2 aria-hidden className="animate-spin" /> : null}
      {children}
    </button>
  )
}

/** A long-text field that grows as the person types and never scrolls inside itself (41.7 rule 11). */
export const GrowTextarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function GrowTextarea({ className, onChange, value, ...props }, ref) {
    const inner = React.useRef<HTMLTextAreaElement | null>(null)
    const fit = React.useCallback(() => {
      const el = inner.current
      if (!el) return
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }, [])
    React.useLayoutEffect(fit, [value, fit])
    return (
      <textarea
        {...props}
        value={value}
        ref={(el) => {
          inner.current = el
          if (typeof ref === 'function') ref(el)
          else if (ref) ref.current = el
        }}
        onChange={(e) => {
          onChange?.(e)
          fit()
        }}
        className={cx('resize-none overflow-hidden', className)}
      />
    )
  },
)

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
 * bleeds out over the side padding with mx-[-16px] (PhoneContent pads 16px
 * plus the side safe areas; the safe area stays padded).
 */
export const ROW_BLOCK =
  'mx-[-16px] divide-y divide-border-light border-y border-border-light bg-surface'

/** One tappable row, at least 48px, 16px in from the sides (41.5 rule 8, 41.8 rule 7). */
export const ROW = cx(
  'flex min-h-[48px] w-full items-center gap-[12px] px-[16px] py-[12px] text-left',
  'text-body text-text-primary',
  'transition-[background-color] duration-(--duration-fast) active:bg-surface-control',
  'outline-hidden focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-ring',
)

/** A phone text input / textarea: 44px tall, 16px text, danger border when invalid (11.3 rule 6, 41.9). */
export const PHONE_INPUT =
  'min-h-(--h-control) w-full rounded-[8px] border border-border-strong bg-surface px-[12px] text-[16px] text-text-primary outline-hidden focus-visible:border-primary aria-[invalid=true]:border-danger'

/**
 * One labelled form field (11.3 rules 2, 3 and 6): the kit label above the
 * control, a red asterisk when `required`, the inline error below it. Pass
 * `htmlFor` so tapping the label focuses the control.
 */
export function PhoneField({
  label,
  htmlFor,
  required = false,
  error,
  children,
  className,
}: {
  label: string
  htmlFor?: string
  required?: boolean
  error?: string | null
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cx('flex flex-col gap-[6px]', className)}>
      <Label htmlFor={htmlFor} required={required}>
        {label}
      </Label>
      {children}
      <InlineFieldError className="mt-0">{error}</InlineFieldError>
    </div>
  )
}

/**
 * 41.7 rule 6: Enter in a single-line field moves to the next field, and on
 * the last one closes the keyboard. It never saves. Put on the form's onKeyDown.
 */
export function enterMovesNext(e: React.KeyboardEvent<HTMLElement>) {
  const el = e.target as HTMLElement
  if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
  if (el.tagName !== 'INPUT') return
  const type = (el as HTMLInputElement).type
  if (['checkbox', 'radio', 'button', 'submit'].includes(type)) return
  e.preventDefault()
  const form = e.currentTarget
  const fields = Array.from(
    form.querySelectorAll<HTMLElement>('input:not([type=hidden]):not([disabled]), textarea:not([disabled]), button[data-field]:not([disabled])'),
  ).filter((f) => f.offsetParent !== null && (f as HTMLInputElement).type !== 'checkbox')
  const next = fields[fields.indexOf(el) + 1]
  if (next && next.tagName !== 'TEXTAREA') next.focus()
  else el.blur()
}

/** 39.3: after a failed save, focus the first field marked aria-invalid inside `root`. */
export function focusFirstInvalid(root: ParentNode | null) {
  requestAnimationFrame(() => {
    const el = root?.querySelector<HTMLElement>('[aria-invalid="true"]')
    el?.focus()
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  })
}
