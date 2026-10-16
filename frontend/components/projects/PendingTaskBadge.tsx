'use client'

import { AlertCircle } from 'lucide-react'

interface PendingTaskBadgeProps {
  onClick: () => void
}

export default function PendingTaskBadge({ onClick }: PendingTaskBadgeProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border border-warning-border bg-warning-bg text-warning hover:bg-warning-bg transition-colors cursor-pointer"
    >
      <AlertCircle size={10} />
      Setup Required
    </button>
  )
}
