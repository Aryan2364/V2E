'use client'

import { AlertTriangle } from 'lucide-react'
import type { DependencyWarning as DWType } from '@/lib/types/projects'

interface DependencyWarningProps {
  warnings: DWType[]
}

export default function DependencyWarning({ warnings }: DependencyWarningProps) {
  if (!warnings.length) return null
  return (
    <div className="flex items-start gap-1.5 text-warning mt-1">
      <AlertTriangle size={13} className="shrink-0 mt-0.5" />
      <p className="text-xs">
        Waiting on: {warnings.map((w) => w.title).join(', ')}
      </p>
    </div>
  )
}
