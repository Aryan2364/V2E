'use client'

import { useMemo } from 'react'
import { STATUS_META, formatValue, type Goal, type GoalCheckIn } from '@/lib/types/goals'

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
}

/**
 * The goal's number over time: every surviving check-in as a point, the target
 * as a dashed reference, each point coloured by the traffic light the owner
 * called that day.
 *
 * This is the one place the module turns a frozen figure into a story — and
 * there is deliberately no percentage or progress bar, because nothing here is
 * computed. It only ever plots numbers a person typed in.
 */
export default function GoalTrajectory({
  goal,
  checkIns,
}: {
  goal: Goal
  checkIns: GoalCheckIn[]
}) {
  const points = useMemo(
    () =>
      checkIns
        .filter((c) => !c.is_voided && c.recorded_value !== null && c.recorded_value !== undefined)
        .slice()
        .sort((a, b) => new Date(a.check_in_date).getTime() - new Date(b.check_in_date).getTime())
        .map((c) => ({
          value: c.recorded_value as number,
          date: c.check_in_date,
          status: c.status,
        })),
    [checkIns],
  )

  const target = goal.target_value

  if (target === null || target === undefined) {
    return (
      <p className="text-[13px] text-text-secondary">
        This goal isn’t measured by a number — its check-ins are the traffic light and the note.
      </p>
    )
  }

  if (points.length === 0) {
    return (
      <p className="text-[13px] text-text-secondary">
        No number recorded yet. The first check-in starts the trajectory.
      </p>
    )
  }

  // Chart geometry (viewBox units; non-scaling strokes stay crisp when stretched).
  const W = 600
  const H = 120
  const PAD_Y = 14
  const yMax = Math.max(target, ...points.map((p) => p.value)) * 1.12 || 1
  const yOf = (v: number) => H - PAD_Y - (v / yMax) * (H - PAD_Y * 2)
  const xOf = (i: number) => (points.length <= 1 ? W / 2 : (i / (points.length - 1)) * (W - 24) + 12)

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i)} ${yOf(p.value)}`).join(' ')
  const targetY = yOf(target)
  const latest = points[points.length - 1]

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[120px]" preserveAspectRatio="none">
        {/* Target reference */}
        <line
          x1={0}
          x2={W}
          y1={targetY}
          y2={targetY}
          stroke="#CBD5E1"
          strokeWidth={1}
          strokeDasharray="5 5"
          vectorEffect="non-scaling-stroke"
        />
        {points.length > 1 && (
          <path
            d={linePath}
            fill="none"
            stroke="#2563EB"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {points.map((p, i) => (
          <circle
            key={`${p.date}-${i}`}
            cx={xOf(i)}
            cy={yOf(p.value)}
            r={4}
            fill={STATUS_META[p.status]?.dot ?? '#2563EB'}
            stroke="#FFFFFF"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div className="flex items-center justify-between mt-1.5 gap-2">
        <span className="text-[11px] text-text-secondary">{fmtDate(points[0].date)}</span>
        <span className="text-[11px] font-medium text-text-secondary">
          Target line at {formatValue(target, goal.unit)}
        </span>
        <span className="text-[11px] text-text-secondary">{fmtDate(latest.date)}</span>
      </div>
    </div>
  )
}
