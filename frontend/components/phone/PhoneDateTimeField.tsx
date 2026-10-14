'use client'

import { fmtDate as formatDate, fmtTime as formatTime } from '@/lib/phone-format'
import React from 'react'
import { cx } from './primitives'

/*
 * Date and time fields that open the phone's own picker - kit §41.9 rule 10:
 * a native <input type="date"|"time"> laid transparent ON TOP of the
 * styled display field (the only arrangement that reliably opens the
 * picker on both iPhone and Android), while the display reads DD Mon YYYY
 * / h:mm A, never the phone's own format.
 */

const FIELD = cx(
  'relative flex min-h-[var(--h-control)] w-full items-center rounded-[8px] border border-phone-border bg-phone-surface px-[12px]',
)

function fmtDate(value: string): string {
  if (!value) return ''
  const [y, m, d] = value.split('-').map(Number)
  if (!y || !m || !d) return ''
  const dt = new Date(y, m - 1, d)
  return formatDate(dt)
}

function fmtTime(value: string): string {
  if (!value) return ''
  const [h, m] = value.split(':').map(Number)
  if (h === undefined || m === undefined) return ''
  const dt = new Date()
  dt.setHours(h, m, 0, 0)
  return formatTime(dt)
}

export function PhoneDateField({
  id,
  label,
  value,
  onChange,
  required,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  required?: boolean
}) {
  return (
    <div className="flex flex-col gap-[6px]">
      <label htmlFor={id} className="text-phone-label font-medium text-phone-text-secondary">
        {label} {required ? <span aria-hidden>*</span> : null}
      </label>
      <div className={FIELD}>
        <span className={cx('text-phone-body', value ? 'text-phone-text-primary' : 'text-phone-text-muted')}>
          {value ? fmtDate(value) : 'DD Mon YYYY'}
        </span>
        <input
          id={id}
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label={label}
        />
      </div>
    </div>
  )
}

export function PhoneTimeField({
  id,
  label,
  value,
  onChange,
  required,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  required?: boolean
}) {
  return (
    <div className="flex flex-col gap-[6px]">
      <label htmlFor={id} className="text-phone-label font-medium text-phone-text-secondary">
        {label} {required ? <span aria-hidden>*</span> : null}
      </label>
      <div className={FIELD}>
        <span className={cx('text-phone-body', value ? 'text-phone-text-primary' : 'text-phone-text-muted')}>
          {value ? fmtTime(value) : 'h:mm A'}
        </span>
        <input
          id={id}
          type="time"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label={label}
        />
      </div>
    </div>
  )
}
