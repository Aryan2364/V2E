'use client'

import { useEffect, useState } from 'react'
import { MultiSelect } from '@/components/ui/multi-select'
import { goalsApi } from '@/lib/api/goals'
import { STATUS_META, type Goal } from '@/lib/types/goals'
import { formatDate } from '@/lib/format'
import { Label } from '@/components/ui/label'

/**
 * "Goals this project serves" — the project side of the many-to-many link.
 *
 * A project can move several goals at once (a delivery-time project serves
 * retention AND cost AND revenue), so this is a multi-select, not a single
 * picker. Hidden entirely when the org has no goals to link to.
 */
export default function GoalsMultiSelectField({
  orgId,
  value,
  onChange,
  disabled,
}: {
  orgId: string
  value: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
}) {
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

  // Nothing to link to — keep the form uncluttered. (If links already exist we
  // still render, so they can be seen and removed.)
  if (loaded && goals.length === 0 && value.length === 0) return null
  if (!loaded && value.length === 0) return null

  const fmt = (iso: string) => {
    const d = new Date(iso)
    return isNaN(d.getTime())
      ? ''
      : formatDate(d)
  }

  return (
    <div>
      <Label className="mb-2">Goals this serves</Label>
      <MultiSelect
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        placeholder="No goals"
        searchPlaceholder="Search goals…"
        emptyMessage="No goals yet."
        options={Object.fromEntries(
          goals.map((g) => [
            g.id,
            {
              label: g.title,
              hint: `${g.owner?.name ?? '—'} · due ${fmt(g.due_date)}`,
              color: STATUS_META[g.status]?.dot,
            },
          ]),
        )}
      />
      <p className="text-meta text-text-secondary mt-1">
        Optional — this project shows on each goal’s page as part of the work behind it.
      </p>
    </div>
  )
}
