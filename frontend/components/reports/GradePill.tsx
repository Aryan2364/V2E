import React from 'react'
import type { ScorecardGrade } from '@/lib/types/reports'

// One shared look for the compliance grade so the roster, the person card, and the
// Excel export all read the same. Colour carries the meaning: strong green = ahead,
// amber = watch, red = act, blue = "closing but late", grey = not enough data.
const STYLE: Record<ScorecardGrade, { bg: string; fg: string; border: string }> = {
  'Very Good': { bg: 'var(--success)', fg: 'var(--surface)', border: 'var(--success)' },
  'Good': { bg: 'var(--success-bg)', fg: 'var(--success)', border: 'var(--success-border)' },
  'Average': { bg: 'var(--warning-bg)', fg: 'var(--warning)', border: 'var(--warning-border)' },
  'Late but Closing': { bg: 'var(--primary-subtle)', fg: 'var(--primary-text)', border: 'var(--primary-border)' },
  'Needs Attention': { bg: 'var(--danger-bg)', fg: 'var(--danger)', border: 'var(--danger-border)' },
  'Too Few Tasks to Judge': { bg: 'var(--surface-control)', fg: 'var(--text-muted)', border: 'var(--border-light)' },
}

export function GradePill({ grade, className = '' }: { grade: ScorecardGrade; className?: string }) {
  const s = STYLE[grade] ?? STYLE['Too Few Tasks to Judge']
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-medium whitespace-nowrap ${className}`}
      style={{ backgroundColor: s.bg, color: s.fg, border: `1px solid ${s.border}` }}
    >
      {grade}
    </span>
  )
}
