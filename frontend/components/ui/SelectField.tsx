'use client'

import { ChevronDown } from 'lucide-react'

// Native <select> with a soft fill + a distinct chevron "affordance" box, so it
// reads clearly as a dropdown rather than a plain text input.
const selectClass =
  'w-full appearance-none rounded-[8px] border border-[#CBD5E1] bg-[#F8FAFC] pl-3.5 pr-11 py-2.5 text-[15px] text-[#0F172A] cursor-pointer hover:bg-white hover:border-[#94A3B8] focus:bg-white focus:outline-hidden focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] disabled:bg-[#F1F5F9] disabled:text-[#94A3B8] disabled:cursor-not-allowed transition-colors'

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
        className={`pointer-events-none absolute right-0 top-0 bottom-0 flex items-center px-2.5 border-l border-[#E2E8F0] rounded-r-[8px] ${
          disabled ? 'text-[#CBD5E1]' : 'text-[#64748B] group-hover:text-[#2563EB]'
        } transition-colors`}
      >
        <ChevronDown size={16} />
      </span>
    </div>
  )
}
