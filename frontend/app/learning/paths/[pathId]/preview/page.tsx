'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { BookOpen, ArrowLeft } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
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
      <div className="flex items-center justify-center min-h-[calc(100vh-56px)]">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (notAvailable || !path) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-56px)] px-4">
        <div className="text-center max-w-sm">
          <BookOpen size={40} className="text-[#CBD5E1] mx-auto mb-3" />
          <h1 className="text-lg font-bold text-text-primary mb-1">Course not found</h1>
          <p className="text-sm text-text-secondary mb-5">
            This course doesn’t exist, or you don’t have access to manage it.
          </p>
          <Link
            href="/learning/paths"
            className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-white bg-primary hover:bg-primary-hover rounded-[8px] transition-colors"
          >
            <ArrowLeft size={15} /> Back to Courses
          </Link>
        </div>
      </div>
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
