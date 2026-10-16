'use client'

import React, { useMemo } from 'react'
import type { FlowMatrix } from '@/lib/types/tasks'
import Tooltip from '@/components/ui/tooltip'

/**
 * Cross-department work-flow heatmap: rows = giving department, columns = receiving department,
 * cell = task count. Within-department (diagonal) cells tint blue; cross-department cells tint
 * red; intensity scales with the count. Click a non-zero cell to open those tasks. Net-new
 * component (no matrix existed) — fixed height, horizontal scroll on small screens.
 */
export default function CrossDeptMatrix({
  matrix,
  onCell,
}: {
  matrix: FlowMatrix
  onCell: (fromId: string, fromName: string, toId: string, toName: string, count: number) => void
}) {
  const max = useMemo(() => Math.max(1, ...matrix.rows.flatMap((r) => r.cells)), [matrix])
  const hasAny = matrix.rows.some((r) => r.cells.some((c) => c > 0))

  return (
    <div className="bg-surface border border-border-light rounded-xl shadow-card p-4 flex flex-col h-[460px]">
      <div className="flex items-center justify-between mb-3 gap-2 shrink-0">
        <h3 className="text-body font-medium text-text-primary">Cross-department work flow</h3>
        <span className="text-meta text-text-muted">rows give → columns receive</span>
      </div>
      {!hasAny ? (
        <p className="text-label text-text-secondary flex-1 grid place-items-center">No cross-department work in this view.</p>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="text-meta border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 bg-surface z-10" />
                {matrix.depts.map((d) => (
                  <th key={d.id} className="px-1 py-1 font-medium text-text-muted align-bottom" style={{ height: 70 }}>
                    <div className="whitespace-nowrap" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>{d.name}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((row, ri) => {
                const from = matrix.depts.find((d) => d.id === row.from)
                return (
                  <tr key={row.from}>
                    <td className="sticky left-0 bg-surface z-10 pr-2 py-0.5 font-medium text-right whitespace-nowrap text-text-secondary">{from?.name ?? '—'}</td>
                    {row.cells.map((v, ci) => {
                      const to = matrix.depts[ci]
                      const within = row.from === to.id
                      const a = v / max
                      const intensity = Math.round((0.12 + a * 0.7) * 100)
                      const bg = v === 0
                        ? 'var(--surface-sunken)'
                        : within
                          ? `color-mix(in srgb, var(--primary) ${intensity}%, transparent)`
                          : `color-mix(in srgb, var(--danger) ${intensity}%, transparent)`
                      const color = a > 0.5 ? 'var(--surface)' : 'var(--text-secondary)'
                      return (
                        <td key={ci} className="p-0.5">
                          <Tooltip label={`${from?.name} → ${to.name}: ${v}`}>
                            <button
                              type="button"
                              disabled={v === 0}
                              onClick={() => v && onCell(row.from, from?.name ?? '', to.id, to.name, v)}
                              className={`w-7 h-7 rounded-tick grid place-items-center font-medium tabular-nums ${v ? 'cursor-pointer' : 'cursor-default'}`}
                              style={{ background: bg, color }}
                            >
                              {v || ''}
                            </button>
                          </Tooltip>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-meta text-text-muted mt-2 shrink-0">
        <span className="inline-block w-2.5 h-2.5 rounded-xs align-middle mr-1" style={{ background: 'color-mix(in srgb, var(--primary) 60%, transparent)' }} /> within a department ·
        <span className="inline-block w-2.5 h-2.5 rounded-xs align-middle mx-1" style={{ background: 'color-mix(in srgb, var(--danger) 60%, transparent)' }} /> handed across departments
      </p>
    </div>
  )
}
