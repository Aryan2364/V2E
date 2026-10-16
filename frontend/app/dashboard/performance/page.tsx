'use client'

import { TrendingUp } from 'lucide-react'

export default function PerformancePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] font-medium text-text-primary leading-tight">Performance</h1>
        <p className="mt-1 text-[15px] text-text-secondary">Employee performance reviews and analytics.</p>
      </div>
      <div className="flex flex-col items-center justify-center py-12 text-center bg-surface border border-border-light rounded-xl shadow-card">
        <div className="w-14 h-14 rounded-xl bg-warning-bg flex items-center justify-center mb-4">
          <TrendingUp size={26} className="text-warning" />
        </div>
        <h2 className="text-[18px] font-medium text-text-primary">Coming Soon</h2>
        <p className="text-[14px] text-text-secondary mt-2 max-w-sm">
          Performance reviews, KPI tracking and analytics will be available here.
        </p>
      </div>
    </div>
  )
}
