'use client'

import React from 'react'
import Tooltip from '@/components/ui/Tooltip'

export interface AvatarPerson {
  id: string
  name: string
  department?: string | null
  role?: string | null
  isCC?: boolean
}

const AVATAR_COLORS = [
  'bg-primary', 'bg-text-secondary', 'bg-success',
  'bg-warning', 'bg-danger', 'bg-text-secondary', 'bg-text-secondary',
]

function avatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash += name.charCodeAt(i)
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

function getInitials(name: string): string {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
  return initials || '?'
}

const SIZES = {
  sm: { circle: 'w-5 h-5 text-[8px]', overlap: '-space-x-1.5' },
  md: { circle: 'w-7 h-7 text-[10px]', overlap: '-space-x-2' },
} as const

/**
 * Overlapping initials avatars with a rich hover tooltip (full name, role · department,
 * Assignee/CC). The tooltip is portaled (see Tooltip) so it renders above the sidebar and
 * is never clipped by the scrolling task list. CC avatars render muted.
 */
export default function AssigneeAvatars({
  people,
  max = 3,
  size = 'md',
}: {
  people: AvatarPerson[]
  max?: number
  size?: keyof typeof SIZES
}) {
  if (people.length === 0) return null
  const s = SIZES[size]
  const visible = people.slice(0, max)
  const extra = people.length - visible.length

  return (
    <div className={`flex ${s.overlap}`}>
      {visible.map((p) => (
        <Tooltip
          key={p.id}
          label={
            <span className="block text-left">
              <span className="flex items-center gap-2">
                <span className="font-semibold text-white whitespace-nowrap">{p.name}</span>
                <span
                  className={[
                    'inline-flex items-center rounded-[999px] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
                    p.isCC ? 'bg-[#334155] text-[#CBD5E1]' : 'bg-primary text-white',
                  ].join(' ')}
                >
                  {p.isCC ? 'CC' : 'Assignee'}
                </span>
              </span>
              {(p.role || p.department) && (
                <span className="mt-0.5 block text-[10px] text-text-muted whitespace-nowrap">
                  {[p.role, p.department].filter(Boolean).join(' · ')}
                </span>
              )}
            </span>
          }
        >
          <div
            className={[
              `${s.circle} rounded-full flex items-center justify-center font-bold border-2 border-white cursor-default`,
              p.isCC ? 'bg-surface-control text-text-muted ring-1 ring-border' : `${avatarColor(p.name)} text-white`,
            ].join(' ')}
          >
            {getInitials(p.name)}
          </div>
        </Tooltip>
      ))}
      {extra > 0 && (
        <Tooltip label={people.slice(max).map((p) => p.name).join(', ')}>
          <div
            className={`${s.circle} rounded-full bg-surface-control-pressed flex items-center justify-center text-text-secondary font-bold border-2 border-white cursor-default`}
          >
            +{extra}
          </div>
        </Tooltip>
      )}
    </div>
  )
}
