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
    <div className="rounded-xl p-4 sm:p-6 bg-primary text-primary-foreground shadow-menu">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-meta font-medium mb-3 text-primary-foreground/85 hover:text-primary-foreground transition-colors">
        <ChevronLeft size={14} /> Back
      </button>
      <div className="flex items-center flex-wrap gap-1.5 mb-1.5 text-meta text-primary-foreground/75">
        <button onClick={onRoot} className="font-medium underline hover:text-primary-foreground">{rootLabel}</button>
        {crumbs.map((c, i) => (
          <span key={c.id} className="flex items-center gap-1.5">
            <span>›</span>
            {i < crumbs.length - 1 ? (
              <button onClick={() => onCrumb(c.id)} className="font-medium underline hover:text-primary-foreground">{c.name}</button>
            ) : (
              <span className="font-medium text-primary-foreground">{c.name}</span>
            )}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-page-title font-medium tracking-tight text-primary-foreground">{title}</h2>
        {badge && <span className="text-meta font-medium rounded-full px-2 py-0.5 bg-surface/20 text-primary-foreground">{badge}</span>}
      </div>
      {stats && <p className="text-body mt-1.5 text-primary-foreground/90">{stats}</p>}
    </div>
  )
}
