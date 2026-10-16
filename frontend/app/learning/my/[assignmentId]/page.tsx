'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import {
  getMyAssignment, completeItem, uncompleteItem, getMyItemViewUrl, downloadMyItem, getMyItemFile,
} from '@/lib/api/learning'
import type { LearningPathAssignment } from '@/lib/types/learning'
import CourseViewer from '@/components/learning/CourseViewer'

export default function LearnPathPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>()
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''

  const [assignment, setAssignment] = useState<LearningPathAssignment | null>(null)
  const [loading, setLoading] = useState(true)
  const [notAvailable, setNotAvailable] = useState(false)

  useEffect(() => {
    if (!orgId || !assignmentId) return
    setLoading(true)
    setNotAvailable(false)
    getMyAssignment(orgId, assignmentId)
      .then(setAssignment)
      .catch(() => setNotAvailable(true)) // 404 = not assigned to this user / bad link
      .finally(() => setLoading(false))
  }, [orgId, assignmentId])

  if (loading) {
    return (
      <div className="p-6">
        <Skeleton className="h-8 w-64 mb-4" />
        <Skeleton className="h-64 rounded-card" />
      </div>
    )
  }

  if (notAvailable || !assignment) {
    return (
      <EmptyState variant="not-found" heading="This course isn't available to you" dashboardHref="/learning/my">
        It isn't assigned to you, or the link is no longer valid. Check the courses assigned to you.
      </EmptyState>
    )
  }

  const watermark = [user?.name, user?.email, new Date().toISOString().slice(0, 10)].filter(Boolean).join(' · ')

  return (
    <CourseViewer
      title={assignment.path?.title ?? 'Course'}
      items={assignment.items ?? []}
      sequential={assignment.path?.mode === 'sequential'}
      backHref="/learning/my"
      backLabel="My Learning"
      watermark={watermark}
      loadView={(id) => getMyItemViewUrl(orgId, assignmentId, id)}
      loadFile={(id) => getMyItemFile(orgId, assignmentId, id)}
      onDownload={(id) => downloadMyItem(orgId, assignmentId, id)}
      persistComplete={(id, type) => completeItem(orgId, assignmentId, id, type)}
      persistUncomplete={(id) => uncompleteItem(orgId, assignmentId, id)}
    />
  )
}
