import type { LearningPathStatus } from '@/lib/types/learning'

const CONFIG: Record<LearningPathStatus, { label: string; classes: string }> = {
  draft: {
    label: 'Draft',
    classes: 'bg-surface-control text-text-secondary border border-border',
  },
  published: {
    label: 'Published',
    classes: 'bg-success-bg text-success border border-success-border',
  },
  archived: {
    label: 'Archived',
    classes: 'bg-danger-bg text-danger border border-danger-border',
  },
}

export default function PathStatusBadge({ status }: { status: LearningPathStatus }) {
  const { label, classes } = CONFIG[status] ?? CONFIG.draft
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${classes}`}>
      {label}
    </span>
  )
}
