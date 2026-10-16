'use client'

import React from 'react'
import { User, Users, Building2 } from 'lucide-react'
import type { WorkScope } from '@/lib/types/tasks'

const RANK: Record<WorkScope, number> = { own: 0, team: 1, department: 2, org: 3 }

const OPTIONS: { scope: WorkScope; label: string; icon: React.ReactNode }[] = [
  { scope: 'own', label: 'Mine', icon: <User size={15} /> },
  { scope: 'team', label: 'My Team', icon: <Users size={15} /> },
  { scope: 'org', label: 'Organization', icon: <Building2 size={15} /> },
]

/**
 * Living-cascade scope switcher. Only levels at or below the viewer's entitled
 * `maxScope` are shown — and when the only level is "Mine" the control hides entirely
 * (a lone option just advertises what you can't reach). Driven by the server's
 * authoritative `max_scope`, never the client.
 */
export default function ScopeSwitcher({
  maxScope,
  value,
  onChange,
}: {
  maxScope: WorkScope | null
  value: WorkScope
  onChange: (scope: WorkScope) => void
}) {
  if (!maxScope) return null
  const maxRank = RANK[maxScope]
  // "team" surfaces for anyone entitled to team OR department; "org" only for org.
  const visible = OPTIONS.filter((o) =>
    o.scope === 'own' ? true : o.scope === 'org' ? maxScope === 'org' : maxRank >= RANK.team,
  )
  if (visible.length <= 1) return null

  return (
    <div className="inline-flex items-center border border-border-light rounded-lg bg-surface p-0.5 gap-0.5">
      {visible.map(({ scope, label, icon }) => {
        const active = value === scope
        return (
          <button
            key={scope}
            type="button"
            onClick={() => onChange(scope)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] text-sm font-medium transition-colors ${
              active ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary hover:bg-surface-control'
            }`}
          >
            {icon}
            <span>{label}</span>
          </button>
        )
      })}
    </div>
  )
}
