'use client'

import StyledSelect from './StyledSelect'
import { COUNTRIES } from '@/lib/phone'

/**
 * Dialling-code picker built on the shared StyledSelect (never a native <select>,
 * per DESIGN_RULES). Shows "+91 India" so the code and country are both clear.
 * `dark` themes the trigger for the dark admin-login page.
 */
export default function CountryCodeSelect({
  value,
  onChange,
  disabled = false,
  dark = false,
  wrapperClassName = 'w-[132px] shrink-0',
}: {
  value: string
  onChange: (code: string) => void
  disabled?: boolean
  dark?: boolean
  wrapperClassName?: string
}) {
  const options = COUNTRIES.map((c) => ({ value: c.code, label: `${c.code} ${c.name}` }))

  return (
    <StyledSelect
      value={value}
      onChange={onChange}
      disabled={disabled}
      wrapperClassName={wrapperClassName}
      options={options}
      // For the dark admin page, force the trigger colours over StyledSelect's light default.
      triggerClassName={
        dark
          ? 'bg-[#0F172A]! border-border-strong! text-white! hover:bg-[#0F172A]! hover:border-primary!'
          : ''
      }
    />
  )
}
