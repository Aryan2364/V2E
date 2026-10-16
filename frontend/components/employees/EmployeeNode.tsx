'use client'

import { memo } from 'react'
import { Handle, Position } from 'reactflow'
import { Zap } from 'lucide-react'
import { levelColors } from '@/lib/role-levels'
import { NODE_W } from '@/lib/employee-tree'
import Tooltip from '@/components/ui/tooltip'
import type { EmployeeStatus, RoleLevel } from '@/lib/types'

export interface EmployeeNodeData {
  name: string
  roleTitle?: string
  level?: RoleLevel
  department?: string
  status: EmployeeStatus
  color: string // department base hue
  freeRadical?: boolean
  /** This person reports to someone who is filtered out of the current view. */
  hiddenManager?: boolean
  /** This person has reports who are filtered out of the current view. */
  hiddenReports?: boolean
}

const statusDot: Record<EmployeeStatus, string> = {
  active: 'bg-success',
  inactive: 'bg-danger',
}

function initials(name: string): string {
  const p = name.trim().split(/\s+/)
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '?'
}

function EmployeeNode({ data }: { data: EmployeeNodeData }) {
  const { name, roleTitle, level, department, status, color, freeRadical, hiddenManager, hiddenReports } = data
  return (
    <div
      className={`group relative rounded-card bg-surface border shadow-card ${
        freeRadical ? 'border-dashed border-border' : 'border-border-light'
      }`}
      style={{ width: NODE_W, borderLeft: `4px solid ${color}` }}
    >
      <Handle type="target" position={Position.Top} className="bg-text-muted! w-2! h-2! border-0!" />

      {/* Hidden-neighbour markers: a dot above means this person reports to
          someone filtered out; a dot below means they have reports filtered out. */}
      {hiddenManager && (
        <Tooltip label="Reports to someone hidden by the current filter">
        <span
          className="pointer-events-none absolute top-[-7px] left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full border-2 border-white shadow-xs"
          style={{ backgroundColor: color }}
        />
        </Tooltip>
      )}
      {hiddenReports && (
        <Tooltip label="Has reports hidden by the current filter">
        <span
          className="pointer-events-none absolute bottom-[-7px] left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full border-2 border-white shadow-xs"
          style={{ backgroundColor: color }}
        />
        </Tooltip>
      )}

      {/* Hover details card */}
      <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 w-[220px] -translate-x-1/2 scale-95 rounded-xl border border-border-light bg-surface p-3 opacity-0 shadow-menu transition-all duration-150 group-hover:scale-100 group-hover:opacity-100">
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot[status]}`} />
          <p className="text-body font-medium text-text-primary">{name}</p>
        </div>
        <dl className="mt-2 space-y-1.5 text-meta">
          <div className="flex items-start gap-2">
            <dt className="w-20 shrink-0 text-text-muted">Department</dt>
            <dd className="flex-1 font-medium text-text-secondary">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                {department ?? '—'}
              </span>
            </dd>
          </div>
          <div className="flex items-start gap-2">
            <dt className="w-20 shrink-0 text-text-muted">Role</dt>
            <dd className="flex-1 font-medium text-text-secondary">{roleTitle ?? 'No role'}</dd>
          </div>
          {level && (
            <div className="flex items-start gap-2">
              <dt className="w-20 shrink-0 text-text-muted">Level</dt>
              <dd className="flex-1">
                <span
                  className={`inline-flex items-center rounded-full px-1.5 py-px text-meta font-medium capitalize ${levelColors[level]}`}
                >
                  {level}
                </span>
              </dd>
            </div>
          )}
        </dl>
      </div>

      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span
          className="w-9 h-9 shrink-0 rounded-full inline-flex items-center justify-center text-meta font-medium text-white"
          style={{ backgroundColor: color }}
        >
          {initials(name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot[status]}`} />
            <p className="text-body font-medium text-text-primary truncate">{name}</p>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <p className="text-meta text-text-muted truncate">{roleTitle ?? 'No role'}</p>
            {level && (
              <span
                className={`inline-flex items-center rounded-full px-1.5 py-px text-meta font-medium capitalize shrink-0 ${levelColors[level]}`}
              >
                {level}
              </span>
            )}
          </div>
        </div>
      </div>

      {freeRadical && (
        <span className="absolute -top-2 -right-2 inline-flex items-center gap-0.5 rounded-full bg-surface-control border border-border-light px-1.5 py-px text-meta font-medium text-text-muted">
          <Zap size={10} className="text-warning" /> unlinked
        </span>
      )}

      <Handle type="source" position={Position.Bottom} className="bg-text-muted! w-2! h-2! border-0!" />
    </div>
  )
}

export default memo(EmployeeNode)
