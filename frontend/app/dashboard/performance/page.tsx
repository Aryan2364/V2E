'use client'

import { TrendingUp } from 'lucide-react'
import { PageHeader } from '@/components/shell/page-header'

export default function PerformancePage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Performance" meta="Employee performance reviews and analytics." />
      <div className="flex flex-col items-center justify-center py-12 text-center bg-surface border border-border-light rounded-xl shadow-card">
        <div className="w-14 h-14 rounded-xl bg-warning-bg flex items-center justify-center mb-4">
          <TrendingUp size={26} className="text-warning" />
        </div>
        <h2 className="text-card-heading font-medium text-text-primary">Coming soon</h2>
        <p className="text-body text-text-secondary mt-2 max-w-sm">
          Performance reviews, KPI tracking and analytics will be available here.
        </p>
      </div>
    </div>
  )
}
