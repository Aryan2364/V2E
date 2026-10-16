'use client'

import { useState } from 'react'

interface GanttBarProps {
  label: string
  startOffset: number
  widthPercent: number
  color: string
  completed?: boolean
  tooltip?: string
  isDiamond?: boolean
}

export default function GanttBar({ label, startOffset, widthPercent, color, completed, tooltip, isDiamond }: GanttBarProps) {
  const [showTip, setShowTip] = useState(false)

  if (isDiamond) {
    return (
      <div
        className="absolute top-1/2 -translate-y-1/2 z-10"
        style={{ left: `${startOffset}%` }}
        onMouseEnter={() => setShowTip(true)}
        onMouseLeave={() => setShowTip(false)}
      >
        <div
          className="w-4 h-4 rotate-45 -translate-x-1/2 cursor-pointer hover:opacity-80 transition-opacity"
          style={{ backgroundColor: color }}
        />
        {showTip && tooltip && (
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-text-primary text-white text-meta rounded-[6px] whitespace-nowrap z-20 pointer-events-none">
            {tooltip}
          </div>
        )}
      </div>
    )
  }

  const w = Math.max(widthPercent, 0.5)

  return (
    <div
      className="absolute top-1/2 -translate-y-1/2 rounded-[4px] cursor-pointer group transition-opacity hover:opacity-90"
      style={{
        left: `${startOffset}%`,
        width: `${w}%`,
        backgroundColor: completed ? color : color + '80',
        border: `1px solid ${color}`,
        height: 20,
      }}
      onMouseEnter={() => setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}
    >
      <span className="absolute inset-0 flex items-center px-1.5 text-meta font-medium text-white truncate">
        {label}
      </span>
      {showTip && tooltip && (
        <div className="absolute bottom-full left-0 mb-1 px-2 py-1 bg-text-primary text-white text-meta rounded-[6px] whitespace-nowrap z-20 pointer-events-none shadow-lg">
          {tooltip}
        </div>
      )}
    </div>
  )
}
