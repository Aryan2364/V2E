'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BarChart2, Users, CheckCircle, Clock, TrendingUp } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import { getOrgProgress } from '@/lib/api/learning'
import type { OrgProgressSummary } from '@/lib/types/learning'
import ProgressBar from '@/components/learning/ProgressBar'
import PathStatusBadge from '@/components/learning/PathStatusBadge'

function StatCard({ label, value, icon: Icon, color }: { label: string; value: string | number; icon: any; color: string }) {
  return (
    <div className="bg-white border border-border-light rounded-[12px] p-5">
      <div className={`w-10 h-10 rounded-[10px] ${color} flex items-center justify-center mb-3`}>
        <Icon size={18} />
      </div>
      <div className="text-2xl font-bold text-text-primary">{value}</div>
      <div className="text-sm text-text-muted mt-0.5">{label}</div>
    </div>
  )
}

export default function ProgressPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const [summary, setSummary] = useState<OrgProgressSummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orgId) return
    getOrgProgress(orgId).then(setSummary).catch(() => setSummary(null)).finally(() => setLoading(false))
  }, [orgId])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-56px)]">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!summary) return null

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-[28px] font-bold text-text-primary">Learning Progress</h1>
        <p className="text-sm text-text-secondary mt-1">Organisation-wide learning progress overview</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Total Paths"
          value={summary.total_paths}
          icon={BarChart2}
          color="bg-primary-subtle text-primary-text"
        />
        <StatCard
          label="Total Assignments"
          value={summary.total_assignments}
          icon={Users}
          color="bg-success-bg text-success"
        />
        <StatCard
          label="Completed"
          value={summary.completed_assignments}
          icon={CheckCircle}
          color="bg-success-bg text-success"
        />
        <StatCard
          label="Avg Progress"
          value={`${summary.avg_progress_percent}%`}
          icon={TrendingUp}
          color="bg-warning-bg text-warning"
        />
      </div>

      {/* Per-path breakdown */}
      {summary.paths.length === 0 ? (
        <div className="bg-white border border-border-light rounded-[12px] py-16 flex flex-col items-center text-center">
          <BarChart2 size={32} className="text-text-muted mb-3" />
          <p className="text-sm font-medium text-text-primary mb-1">No data yet</p>
          <p className="text-xs text-text-muted">Assign learning paths to employees to track progress</p>
        </div>
      ) : (
        <div className="bg-white border border-border-light rounded-[12px] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border-light bg-surface-sunken">
            <h2 className="text-sm font-semibold text-text-primary">Path Progress Breakdown</h2>
          </div>
          <div className="divide-y divide-surface-control">
            {summary.paths.map((p) => (
              <div key={p.path_id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <Link
                      href={`/learning/paths/${p.path_id}`}
                      className="text-sm font-semibold text-text-primary hover:text-primary-text transition-colors"
                    >
                      {p.title}
                    </Link>
                    <div className="flex items-center gap-2 mt-1">
                      <PathStatusBadge status={p.status} />
                      <span className="text-xs text-text-muted">{p.total_assignments} employees</span>
                    </div>
                  </div>
                  <span className="text-sm font-bold text-text-primary shrink-0">{p.avg_percent}%</span>
                </div>
                <ProgressBar percent={p.avg_percent} size="sm" className="mb-2" />
                <div className="flex items-center gap-4 text-xs text-text-muted">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-success inline-block" />
                    {p.completed} completed
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-primary inline-block" />
                    {p.in_progress} in progress
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-[#94A3B8] inline-block" />
                    {p.not_started} not started
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
