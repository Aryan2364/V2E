'use client'

import React, { useEffect, useState } from 'react'
import StyledSelect from '@/components/ui/StyledSelect'
import { goalsApi } from '@/lib/api/goals'
import type { Goal } from '@/lib/types/goals'

interface Props {
  orgId: string
  value: string
  onChange: (goalId: string) => void
  /** Overrides the helper line — Projects reuses this field with its own wording. */
  hint?: string
}

/**
 * Optional "Link to goal" select (Create Task + recurring modals). Lists every
 * goal the viewer can see — goals are flat now, so there is no level to filter
 * by and any goal can carry work. Hidden while there are no goals at all.
 */
export default function GoalSelectField({ orgId, value, onChange, hint }: Props) {
  const [goals, setGoals] = useState<Goal[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!orgId) return
    goalsApi
      .list(orgId)
      .then((g) => setGoals(g ?? []))
      .catch(() => setGoals([]))
      .finally(() => setLoaded(true))
  }, [orgId])

  // Nothing to link to — keep the form uncluttered. (If an existing link points
  // at a goal we can't list, still render so the user can see/clear it.)
  if (loaded && goals.length === 0 && !value) return null
  if (!loaded && !value) return null

  const known = goals.some((g) => g.id === value)

  return (
    <div>
      <label className="block text-label font-medium text-text-secondary mb-1.5">Link to goal</label>
      <StyledSelect
        value={value}
        onChange={onChange}
        placeholder="No goal"
        options={[
          { value: '', label: 'No goal' },
          ...(value && !known ? [{ value, label: 'Current linked goal' }] : []),
          ...goals.map((g) => ({ value: g.id, label: g.title })),
        ]}
      />
      <p className="text-meta text-text-secondary mt-1">
        {hint ?? 'Optional — the task shows up on that goal as part of the work behind it.'}
      </p>
    </div>
  )
}
