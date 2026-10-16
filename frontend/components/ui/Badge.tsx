import React from 'react'

type BadgeStatus = 'active' | 'inactive' | 'pending' | 'info'

interface BadgeProps {
  status: BadgeStatus
  label?: string
}

const statusConfig: Record<
  BadgeStatus,
  { bg: string; text: string; defaultLabel: string }
> = {
  active: {
    bg: 'bg-success-bg',
    text: 'text-success',
    defaultLabel: 'Active',
  },
  inactive: {
    bg: 'bg-danger-bg',
    text: 'text-danger',
    defaultLabel: 'Inactive',
  },
  pending: {
    bg: 'bg-warning-bg',
    text: 'text-warning',
    defaultLabel: 'Pending',
  },
  info: {
    bg: 'bg-primary-subtle',
    text: 'text-primary-text',
    defaultLabel: 'Info',
  },
}

export default function Badge({ status, label }: BadgeProps) {
  const config = statusConfig[status]

  return (
    <span
      className={[
        'inline-flex items-center rounded-[999px] px-[10px] py-[2px] text-[12px] font-medium',
        config.bg,
        config.text,
      ].join(' ')}
    >
      {label ?? config.defaultLabel}
    </span>
  )
}
