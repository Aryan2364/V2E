'use client'

interface ProjectStatCardProps {
  label: string
  value: number | string
  color?: string
}

export default function ProjectStatCard({ label, value, color = 'var(--primary-text)' }: ProjectStatCardProps) {
  return (
    <div className="bg-surface border border-border-light rounded-card px-6 py-4 shadow-card">
      <p className="text-[28px] font-medium" style={{ color }}>{value}</p>
      <p className="text-sm text-text-secondary mt-0.5">{label}</p>
    </div>
  )
}
