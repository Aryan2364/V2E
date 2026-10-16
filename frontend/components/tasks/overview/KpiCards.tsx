'use client'

import React from 'react'
import { TrendingUp, TrendingDown, CheckCircle2, Timer, AlertTriangle, Flame, Repeat, LayoutGrid } from 'lucide-react'
import type { DashboardKpis, WorkBucket } from '@/lib/types/tasks'

type Tone = 'plain' | 'alert' | 'warn'

function Card({
  label, value, sub, delta, tone = 'plain', icon, onClick,
}: {
  label: string
  value: string | number
  sub?: string
  delta?: number | null
  tone?: Tone
  icon: React.ReactNode
  onClick?: () => void
}) {
  const bg = tone === 'alert' ? 'var(--danger-bg)' : tone === 'warn' ? 'var(--warning-bg)' : 'var(--surface)'
  const border = tone === 'alert' ? 'var(--danger-bg)' : tone === 'warn' ? 'var(--warning-bg)' : 'var(--border-light)'
  const valueColor = tone === 'alert' ? 'var(--danger)' : 'var(--text-primary)'
  const iconColor = tone === 'alert' ? 'var(--danger)' : tone === 'warn' ? 'var(--warning)' : 'var(--primary-text)'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`text-left rounded-[12px] p-4 border transition-all duration-150 ${onClick ? 'cursor-pointer hover:shadow-[0_2px_8px_rgba(0,0,0,0.10)]' : 'cursor-default'}`}
      style={{ background: bg, borderColor: border, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="w-8 h-8 rounded-[8px] flex items-center justify-center" style={{ backgroundColor: iconColor + '18', color: iconColor }}>
          {icon}
        </span>
        {onClick && <span className="text-text-muted text-sm">›</span>}
      </div>
      <p className="text-2xl font-bold leading-none tabular-nums" style={{ color: valueColor }}>{value}</p>
      <p className="text-[13px] mt-1.5 text-text-secondary">{label}</p>
      {delta != null && (
        <p className="text-[12px] mt-1 font-medium flex items-center gap-1" style={{ color: delta >= 0 ? 'var(--success)' : 'var(--danger)' }}>
          {delta >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
          {Math.abs(delta)} pts <span className="text-text-muted font-normal">vs last month</span>
        </p>
      )}
      {sub && delta == null && <p className="text-[12px] mt-1 text-text-muted">{sub}</p>}
    </button>
  )
}

/**
 * Headline KPI row for the Work dashboard. Mixes counts and rates; Overdue and
 * Critical/High get alert/warn tones. Total/Overdue are clickable bucket slicers.
 */
export default function KpiCards({
  kpis,
  onSelectBucket,
}: {
  kpis: DashboardKpis
  onSelectBucket?: (bucket: WorkBucket | null) => void
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      <Card label="Total Tasks" value={kpis.total} icon={<LayoutGrid size={18} />} onClick={onSelectBucket ? () => onSelectBucket(null) : undefined} />
      <Card label="Completion Rate" value={`${kpis.completion_rate}%`} delta={kpis.delta} icon={<CheckCircle2 size={18} />} onClick={onSelectBucket ? () => onSelectBucket('completed') : undefined} />
      <Card label="On-Time Rate" value={`${kpis.on_time_rate}%`} sub="of completed" icon={<Timer size={18} />} />
      <Card label="Overdue (Open)" value={kpis.overdue} tone={kpis.overdue > 0 ? 'alert' : 'plain'} icon={<AlertTriangle size={18} />} onClick={onSelectBucket ? () => onSelectBucket('overdue') : undefined} />
      <Card label="Critical / High Open" value={kpis.critical_high_open} tone={kpis.critical_high_open > 0 ? 'warn' : 'plain'} sub="high-priority, not done" icon={<Flame size={18} />} />
      <Card label="Recurring Share" value={`${kpis.recurring_share}%`} sub="of all tasks" icon={<Repeat size={18} />} />
    </div>
  )
}
