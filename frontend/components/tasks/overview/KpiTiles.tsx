'use client'

import React from 'react'
import {
  AlertTriangle, Calendar, CalendarDays, Activity, CheckCircle2, Repeat, LayoutGrid,
} from 'lucide-react'
import type { DashboardKpis, WorkBucket } from '@/lib/types/tasks'

type TileDef = {
  bucket: WorkBucket | null
  label: string
  color: string
  icon: React.ReactNode
  key: keyof DashboardKpis | 'total'
}

const TILES: TileDef[] = [
  { bucket: 'overdue', label: 'Overdue', color: 'var(--danger)', icon: <AlertTriangle size={18} />, key: 'overdue' },
  { bucket: 'due_today', label: 'Due Today', color: 'var(--warning)', icon: <Calendar size={18} />, key: 'due_today' },
  { bucket: 'due_week', label: 'Due This Week', color: 'var(--primary-text)', icon: <CalendarDays size={18} />, key: 'due_week' },
  { bucket: 'ongoing', label: 'Ongoing', color: 'var(--text-secondary)', icon: <Activity size={18} />, key: 'ongoing' },
  { bucket: 'completed', label: 'Completed', color: 'var(--success)', icon: <CheckCircle2 size={18} />, key: 'completed' },
  { bucket: 'recurring', label: 'Recurring', color: 'var(--text-secondary)', icon: <Repeat size={18} />, key: 'recurring' },
  { bucket: null, label: 'All Tasks', color: 'var(--text-secondary)', icon: <LayoutGrid size={18} />, key: 'total' },
]

/**
 * Server-counted KPI tiles. Each tile is a slicer: click to filter the result surface
 * to that bucket (counts and rows share one backend definition, so they always match).
 */
export default function KpiTiles({
  kpis,
  active,
  onSelect,
}: {
  kpis: DashboardKpis
  active: WorkBucket | null
  onSelect: (bucket: WorkBucket | null) => void
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
      {TILES.map((t) => {
        const value = (t.key === 'total' ? kpis.total : kpis[t.key]) as number
        const isActive = active === t.bucket
        return (
          <button
            key={t.label}
            type="button"
            onClick={() => onSelect(isActive ? null : t.bucket)}
            className="bg-surface border rounded-xl p-3.5 flex flex-col gap-2 text-left transition-all duration-150 border-border-light shadow-card hover:border-border hover:shadow-menu"
            style={isActive ? { borderColor: t.color, boxShadow: `0 0 0 2px ${t.color}30, var(--shadow-menu)` } : undefined}
          >
            <div className="flex items-center justify-between">
              <span
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: t.color + '18', color: t.color }}
              >
                {t.icon}
              </span>
            </div>
            <div>
              <p className="text-page-title font-medium text-text-primary leading-tight tabular-nums">{value}</p>
              <p className="text-body mt-0.5" style={{ color: isActive ? t.color : 'var(--text-secondary)' }}>{t.label}</p>
            </div>
          </button>
        )
      })}
    </div>
  )
}
