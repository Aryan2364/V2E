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
      className="outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring inline-flex items-center gap-1 text-meta font-medium px-2 py-0.5 rounded-full border border-warning-border bg-warning-bg text-warning hover:bg-warning-bg transition-colors cursor-pointer"
    >
      <AlertCircle size={10} />
      Setup required
    </button>
  )
}
