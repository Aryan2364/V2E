'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { BookOpen, ArrowLeft } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
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
      <div className="flex items-center justify-center min-h-[calc(100vh-56px)]">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (notAvailable || !assignment) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-56px)] px-4">
        <div className="text-center max-w-sm">
          <BookOpen size={40} className="text-muted mx-auto mb-3" />
          <h1 className="text-lg font-medium text-text-primary mb-1">This course isn’t available to you</h1>
          <p className="text-sm text-text-secondary mb-4">
            It isn’t assigned to you, or the link is no longer valid. Check the courses assigned to you.
          </p>
          <Link
            href="/learning/my"
            className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-primary-foreground bg-primary hover:bg-primary-hover rounded-control transition-colors"
          >
            <ArrowLeft size={15} /> Go to My Learning
          </Link>
        </div>
      </div>
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
