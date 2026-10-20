'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { GraduationCap, Clock, CheckCircle, BookOpen } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { getMyAssignments } from '@/lib/api/learning'
import type { LearningPathAssignment } from '@/lib/types/learning'
import ProgressRing from '@/components/learning/ProgressRing'
import { PageHeader } from '@/components/shell/page-header'

const STATUS_CONFIG = {
  not_started: { label: 'Not started', classes: 'bg-surface-control text-text-muted' },
  in_progress: { label: 'In progress', classes: 'bg-primary-subtle text-primary-text' },
  completed: { label: 'Completed', classes: 'bg-success-bg text-success' },
}

export default function MyLearningPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const [assignments, setAssignments] = useState<LearningPathAssignment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orgId) return
    getMyAssignments(orgId).then(setAssignments).catch(() => setAssignments([])).finally(() => setLoading(false))
  }, [orgId])

  const inProgress = assignments.filter((a) => a.status === 'in_progress')
  const notStarted = assignments.filter((a) => a.status === 'not_started')
  const completed = assignments.filter((a) => a.status === 'completed')

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-56px)]">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="px-8 py-8 max-w-5xl mx-auto">
      <PageHeader title="My learning" meta={`${assignments.length} paths assigned to you`} />

      {assignments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-16 h-16 rounded-card bg-primary-subtle flex items-center justify-center mb-4">
            <GraduationCap size={28} className="text-primary-text" />
          </div>
          <h3 className="text-card-heading font-medium text-text-primary mb-1">No learning paths yet</h3>
          <p className="text-label text-text-secondary">Your manager will assign learning paths to you.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {inProgress.length > 0 && (
            <section>
              <h2 className="text-label font-medium text-text-secondary uppercase tracking-wider mb-3">In progress</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {inProgress.map((a) => <AssignmentCard key={a.id} assignment={a} />)}
              </div>
            </section>
          )}
          {notStarted.length > 0 && (
            <section>
              <h2 className="text-label font-medium text-text-secondary uppercase tracking-wider mb-3">Not started</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {notStarted.map((a) => <AssignmentCard key={a.id} assignment={a} />)}
              </div>
            </section>
          )}
          {completed.length > 0 && (
            <section>
              <h2 className="text-label font-medium text-text-secondary uppercase tracking-wider mb-3">Completed</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {completed.map((a) => <AssignmentCard key={a.id} assignment={a} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function AssignmentCard({ assignment }: { assignment: LearningPathAssignment }) {
  const path = assignment.path!
  const progress = assignment.path_progress
  const percent = progress?.progress_percent ?? 0
  const { label, classes } = STATUS_CONFIG[assignment.status]

  return (
    <Link
      href={`/learning/my/${assignment.id}`}
      className="bg-surface border border-border-light rounded-card p-4 flex items-start gap-4 hover:shadow-md hover:border-primary/20 transition-all duration-150 group"
    >
      <ProgressRing percent={percent} size={52} strokeWidth={4} className="shrink-0" />
      <div className="flex-1 min-w-0">
        <h3 className="text-label font-medium text-text-primary group-hover:text-primary-text transition-colors line-clamp-2 mb-1.5">
          {path.title}
        </h3>
        <div className="flex items-center gap-3 text-meta text-text-muted">
          <span className="flex items-center gap-1">
            <BookOpen size={11} />
            {path._count?.items ?? 0} items
          </span>
          {path.estimated_minutes && (
            <span className="flex items-center gap-1">
              <Clock size={11} />
              {path.estimated_minutes}m
            </span>
          )}
        </div>
        <div className="mt-2">
          <span className={`inline-flex px-2 py-0.5 rounded-full text-meta font-medium ${classes}`}>
            {label}
          </span>
        </div>
      </div>
    </Link>
  )
}
