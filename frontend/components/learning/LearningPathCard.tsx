import Link from 'next/link'
import { Clock, Users, BookOpen, ChevronRight } from 'lucide-react'
import type { LearningPath } from '@/lib/types/learning'
import PathStatusBadge from './PathStatusBadge'

interface LearningPathCardProps {
  path: LearningPath
  orgId: string
  showProgress?: boolean
  progress?: number
}

export default function LearningPathCard({
  path,
  orgId,
  showProgress = false,
  progress,
}: LearningPathCardProps) {
  return (
    <Link
      href={`/learning/paths/${path.id}`}
      className="block bg-white border border-border-light rounded-[12px] p-5 hover:shadow-md hover:border-primary/20 transition-all duration-150 group"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="w-10 h-10 rounded-[10px] bg-primary-subtle flex items-center justify-center shrink-0">
          <BookOpen size={18} className="text-primary-text" />
        </div>
        <PathStatusBadge status={path.status} />
      </div>

      <h3 className="text-[15px] font-semibold text-text-primary mb-1 line-clamp-2 group-hover:text-primary-text transition-colors">
        {path.title}
      </h3>

      {path.description && (
        <p className="text-sm text-text-secondary line-clamp-2 mb-3">{path.description}</p>
      )}

      <div className="flex items-center gap-4 text-xs text-text-muted mt-auto">
        {path._count && (
          <span className="flex items-center gap-1">
            <BookOpen size={12} />
            {path._count.items} items
          </span>
        )}
        {path._count && (
          <span className="flex items-center gap-1">
            <Users size={12} />
            {path._count.assignments} assigned
          </span>
        )}
        {path.estimated_minutes && (
          <span className="flex items-center gap-1">
            <Clock size={12} />
            {path.estimated_minutes}m
          </span>
        )}
      </div>

      {showProgress && progress !== undefined && (
        <div className="mt-3 pt-3 border-t border-border-light">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-text-secondary">Progress</span>
            <span className="text-xs font-semibold text-text-primary">{progress}%</span>
          </div>
          <div className="h-1.5 bg-surface-control-pressed rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
    </Link>
  )
}
