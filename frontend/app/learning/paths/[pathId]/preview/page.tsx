'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import {
  getPath, getAdminItemViewUrl, getAdminItemFile, downloadAdminItem,
} from '@/lib/api/learning'
import type { LearningPath } from '@/lib/types/learning'
import CourseViewer from '@/components/learning/CourseViewer'

/**
 * Creator "Preview" — the EXACT learner screen (same CourseViewer component), fed from
 * the path instead of an assignment. Uses the admin loaders, which record no views and
 * touch no analytics; completion stays local. Edit (top-right) jumps to the builder,
 * Back returns to the course's manage page.
 */
export default function CoursePreviewPage() {
  const { pathId } = useParams<{ pathId: string }>()
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''

  const [path, setPath] = useState<LearningPath | null>(null)
  const [loading, setLoading] = useState(true)
  const [notAvailable, setNotAvailable] = useState(false)

  useEffect(() => {
    if (!orgId || !pathId) return
    setLoading(true)
    setNotAvailable(false)
    getPath(orgId, pathId)
      .then(setPath)
      .catch(() => setNotAvailable(true))
      .finally(() => setLoading(false))
  }, [orgId, pathId])

  if (loading) {
    return (
      <div className="p-6">
        <Skeleton className="h-8 w-64 mb-4" />
        <Skeleton className="h-64 rounded-card" />
      </div>
    )
  }

  if (notAvailable || !path) {
    return (
      <EmptyState variant="not-found" heading="Course not found" dashboardHref="/learning/paths">
        This course doesn't exist, or you don't have access to manage it.
      </EmptyState>
    )
  }

  const watermark = [user?.name, user?.email, new Date().toISOString().slice(0, 10)].filter(Boolean).join(' · ')

  return (
    <CourseViewer
      preview
      title={path.title}
      items={path.items ?? []}
      sequential={path.mode === 'sequential'}
      backHref={`/learning/paths/${pathId}`}
      backLabel="Back"
      watermark={watermark}
      editHref={`/learning/paths/builder?id=${pathId}`}
      loadView={(id) => getAdminItemViewUrl(orgId, pathId, id)}
      loadFile={(id) => getAdminItemFile(orgId, pathId, id)}
      onDownload={(id) => downloadAdminItem(orgId, pathId, id)}
    />
  )
}
