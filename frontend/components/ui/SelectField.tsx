'use client'

import { ChevronDown } from 'lucide-react'

// Native <select> with a soft fill + a distinct chevron "affordance" box, so it
// reads clearly as a dropdown rather than a plain text input.
const selectClass =
  'w-full appearance-none rounded-[8px] border border-border bg-surface-sunken pl-3.5 pr-11 py-2.5 text-[15px] text-text-primary cursor-pointer hover:bg-white hover:border-border-strong focus:bg-white focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary disabled:bg-surface-control disabled:text-text-muted disabled:cursor-not-allowed transition-colors'

interface SelectFieldProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** Classes for the outer wrapper — use to control width (defaults to full width). */
  wrapperClassName?: string
}

/**
 * Shared dropdown styling for forms and filter bars. Keeps every <select> across
 * the app visually consistent: soft fill, hover lift to white, blue focus ring,
 * and a chevron affordance box on the right.
 */
export default function SelectField({
  children,
  disabled,
  wrapperClassName = 'w-full',
  className,
  ...props
}: SelectFieldProps) {
  return (
    <div className={`relative group ${wrapperClassName}`}>
      <select {...props} disabled={disabled} className={`${selectClass} ${className ?? ''}`}>
        {children}
      </select>
      <span
        className={`pointer-events-none absolute right-0 top-0 bottom-0 flex items-center px-2.5 border-l border-border-light rounded-r-[8px] ${
          disabled ? 'text-[#CBD5E1]' : 'text-text-muted group-hover:text-primary-text'
        } transition-colors`}
      >
        <ChevronDown size={16} />
      </span>
    </div>
  )
}
