'use client'

import React from 'react'
import { ChevronLeft } from 'lucide-react'

export interface Crumb { id: string; name: string }

/**
 * Colored hero band shown when the user drills into a department subtree or a person.
 * Carries a breadcrumb trail (click to jump), a back affordance, an optional badge, and a
 * one-line stat summary. Brand blue per DESIGN_RULES (no off-white text on the dark bg).
 */
export default function DrillHero({
  title,
  badge,
  stats,
  crumbs,
  rootLabel,
  onCrumb,
  onRoot,
  onBack,
}: {
  title: string
  badge?: string
  stats?: string
  crumbs: Crumb[]
  rootLabel: string
  onCrumb: (id: string) => void
  onRoot: () => void
  onBack: () => void
}) {
  return (
    <div className="rounded-[12px] p-5 sm:p-6 bg-primary text-white shadow-[0_2px_8px_rgba(37,99,235,0.25)]">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-xs font-semibold mb-3 text-white/85 hover:text-white transition-colors">
        <ChevronLeft size={14} /> Back
      </button>
      <div className="flex items-center flex-wrap gap-1.5 mb-1.5 text-xs text-white/75">
        <button onClick={onRoot} className="font-medium underline hover:text-white">{rootLabel}</button>
        {crumbs.map((c, i) => (
          <span key={c.id} className="flex items-center gap-1.5">
            <span>›</span>
            {i < crumbs.length - 1 ? (
              <button onClick={() => onCrumb(c.id)} className="font-medium underline hover:text-white">{c.name}</button>
            ) : (
              <span className="font-semibold text-white">{c.name}</span>
            )}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-2xl sm:text-[26px] font-bold tracking-tight text-white">{title}</h2>
        {badge && <span className="text-xs font-semibold rounded-full px-2 py-0.5 bg-white/20 text-white">{badge}</span>}
      </div>
      {stats && <p className="text-sm mt-1.5 text-white/90">{stats}</p>}
    </div>
  )
}
