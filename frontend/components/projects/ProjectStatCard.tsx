'use client'

interface ProjectStatCardProps {
  label: string
  value: number | string
  color?: string
}

export default function ProjectStatCard({ label, value, color = '#2563EB' }: ProjectStatCardProps) {
  return (
    <div className="bg-white border border-border-light rounded-[12px] px-5 py-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
      <p className="text-[28px] font-bold" style={{ color }}>{value}</p>
      <p className="text-sm text-text-secondary mt-0.5">{label}</p>
    </div>
  )
}
