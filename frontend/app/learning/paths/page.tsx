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
          <h1 className="text-[28px] font-bold text-[#0F172A]">Learning Paths</h1>
          <p className="text-sm text-[#475569] mt-1">{paths.length} paths total</p>
        </div>
        <Link
          href="/learning/paths/builder"
          className="flex items-center gap-2 bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-semibold px-4 py-2.5 rounded-[8px] transition-colors"
        >
          <Plus size={16} />
          New Path
        </Link>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
          <input
            type="text"
            placeholder="Search paths..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-[#CBD5E1] rounded-[8px] bg-white text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-hidden focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
          />
        </div>
        {(['all', 'draft', 'published', 'archived'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={[
              'px-3 py-1.5 rounded-[6px] text-xs font-medium capitalize transition-colors',
              filter === s
                ? 'bg-[#2563EB] text-white'
                : 'bg-white text-[#475569] border border-[#E2E8F0] hover:border-[#2563EB] hover:text-[#2563EB]',
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
            <div key={i} className="h-44 bg-[#F1F5F9] rounded-[12px] animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-14 h-14 rounded-[14px] bg-[#EFF6FF] flex items-center justify-center mb-4">
            <BookOpen size={24} className="text-[#2563EB]" />
          </div>
          <h3 className="text-lg font-semibold text-[#0F172A] mb-1">No learning paths found</h3>
          <p className="text-sm text-[#475569] mb-4">
            {search || filter !== 'all' ? 'Try adjusting your filters.' : 'Create your first learning path to get started.'}
          </p>
          {!search && filter === 'all' && (
            <Link
              href="/learning/paths/builder"
              className="flex items-center gap-2 bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-semibold px-4 py-2.5 rounded-[8px] transition-colors"
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
