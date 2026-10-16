'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, BookOpen, Search } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { getPaths } from '@/lib/api/learning'
import type { LearningPath } from '@/lib/types/learning'
import LearningPathCard from '@/components/learning/LearningPathCard'
import PathStatusBadge from '@/components/learning/PathStatusBadge'

export default function LearningPathsPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const [paths, setPaths] = useState<LearningPath[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'draft' | 'published' | 'archived'>('all')

  useEffect(() => {
    if (!orgId) return
    getPaths(orgId)
      .then(setPaths)
      .catch(() => setPaths([]))
      .finally(() => setLoading(false))
  }, [orgId])

  const filtered = paths.filter((p) => {
    const matchesSearch = p.title.toLowerCase().includes(search.toLowerCase())
    const matchesFilter = filter === 'all' || p.status === filter
    return matchesSearch && matchesFilter
  })

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-page-title font-medium text-text-primary">Learning Paths</h1>
          <p className="text-label text-text-secondary mt-1">{paths.length} paths total</p>
        </div>
        <Link
          href="/learning/paths/builder"
          className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-primary-foreground text-label font-medium px-4 py-2.5 rounded-control transition-colors"
        >
          <Plus size={16} />
          New Path
        </Link>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder="Search paths..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-label border border-border rounded-control bg-surface text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </div>
        {(['all', 'draft', 'published', 'archived'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={[
              'px-3 py-1.5 rounded-control text-meta font-medium capitalize transition-colors',
              filter === s
                ? 'bg-primary text-primary-foreground'
                : 'bg-surface text-text-secondary border border-border-light hover:border-primary hover:text-primary-text',
            ].join(' ')}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-44 bg-surface-control rounded-card animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-14 h-14 rounded-card bg-primary-subtle flex items-center justify-center mb-4">
            <BookOpen size={24} className="text-primary-text" />
          </div>
          <h3 className="text-card-heading font-medium text-text-primary mb-1">No learning paths found</h3>
          <p className="text-label text-text-secondary mb-4">
            {search || filter !== 'all' ? 'Try adjusting your filters.' : 'Create your first learning path to get started.'}
          </p>
          {!search && filter === 'all' && (
            <Link
              href="/learning/paths/builder"
              className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-primary-foreground text-label font-medium px-4 py-2.5 rounded-control transition-colors"
            >
              <Plus size={16} />
              Create Learning Path
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((path) => (
            <LearningPathCard key={path.id} path={path} orgId={orgId} />
          ))}
        </div>
      )}
    </div>
  )
}
