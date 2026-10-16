import React from 'react'
import type { TaskQuadrant } from '@/lib/types/tasks'

interface QuadrantBadgeProps {
  quadrant: TaskQuadrant
  size?: 'sm' | 'md'
}

const quadrantConfig: Record<TaskQuadrant, { bg: string; text: string; border: string; label: string; sublabel: string }> = {
  Q1: {
    bg: 'bg-danger-bg',
    text: 'text-danger',
    border: 'border border-danger-border',
    label: 'Q1',
    sublabel: 'Urgent + Important',
  },
  Q2: {
    bg: 'bg-primary-subtle',
    text: 'text-primary-text',
    border: 'border border-primary-border',
    label: 'Q2',
    sublabel: 'Not Urgent + Important',
  },
  Q3: {
    bg: 'bg-warning-bg',
    text: 'text-warning',
    border: 'border border-warning-border',
    label: 'Q3',
    sublabel: 'Urgent + Not Important',
  },
  Q4: {
    bg: 'bg-surface-control',
    text: 'text-text-muted',
    border: 'border border-border-light',
    label: 'Q4',
    sublabel: 'Not Urgent + Not Important',
  },
}

export default function QuadrantBadge({ quadrant, size = 'sm' }: QuadrantBadgeProps) {
  const cfg = quadrantConfig[quadrant]
  if (size === 'md') {
    return (
      <span
        className={[
          'inline-flex flex-col items-center rounded-lg px-3 py-1.5',
          cfg.bg,
          cfg.text,
          cfg.border,
        ].join(' ')}
      >
        <span className="text-sm font-medium leading-tight">{cfg.label}</span>
        <span className="text-meta font-medium leading-tight opacity-80">{cfg.sublabel}</span>
      </span>
    )
  }
  return (
    <span
      className={[
        'inline-flex items-center rounded-[6px] px-2 py-0.5 text-meta font-medium',
        cfg.bg,
        cfg.text,
        cfg.border,
      ].join(' ')}
    >
      {cfg.label}
    </span>
  )
}

export { quadrantConfig }
