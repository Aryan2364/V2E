'use client'

interface ProjectProgressBarProps {
  percentage: number
  showLabel?: boolean
  height?: number
}

export default function ProjectProgressBar({ percentage, showLabel = true, height = 8 }: ProjectProgressBarProps) {
  const pct = Math.min(100, Math.max(0, percentage))
  const color = pct === 100 ? 'var(--success)' : pct >= 50 ? 'var(--primary-text)' : 'var(--warning)'

  return (
    <div className="w-full">
      <div
        className="w-full rounded-full bg-surface-control overflow-hidden"
        style={{ height }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      {showLabel && (
        <p className="text-xs text-text-secondary mt-1">{Math.round(pct)}% complete</p>
      )}
    </div>
  )
}
