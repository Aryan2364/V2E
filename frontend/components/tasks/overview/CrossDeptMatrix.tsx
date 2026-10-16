'use client'

import React, { useMemo } from 'react'
import type { FlowMatrix } from '@/lib/types/tasks'
import Tooltip from '@/components/ui/Tooltip'

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
    <div className="bg-white border border-border-light rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-4 flex flex-col h-[460px]">
      <div className="flex items-center justify-between mb-3 gap-2 shrink-0">
        <h3 className="text-[15px] font-semibold text-text-primary">Cross-department work flow</h3>
        <span className="text-xs text-text-muted">rows give → columns receive</span>
      </div>
      {!hasAny ? (
        <p className="text-sm text-text-secondary flex-1 grid place-items-center">No cross-department work in this view.</p>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="text-xs border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 bg-white z-10" />
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
                    <td className="sticky left-0 bg-white z-10 pr-2 py-0.5 font-medium text-right whitespace-nowrap text-text-secondary">{from?.name ?? '—'}</td>
                    {row.cells.map((v, ci) => {
                      const to = matrix.depts[ci]
                      const within = row.from === to.id
                      const a = v / max
                      const bg = v === 0 ? '#F8FAFC' : within ? `rgba(37,99,235,${0.12 + a * 0.7})` : `rgba(220,38,38,${0.12 + a * 0.7})`
                      const color = a > 0.5 ? '#FFFFFF' : '#475569'
                      return (
                        <td key={ci} className="p-0.5">
                          <Tooltip label={`${from?.name} → ${to.name}: ${v}`}>
                            <button
                              type="button"
                              disabled={v === 0}
                              onClick={() => v && onCell(row.from, from?.name ?? '', to.id, to.name, v)}
                              className={`w-7 h-7 rounded-[4px] grid place-items-center font-semibold tabular-nums ${v ? 'cursor-pointer' : 'cursor-default'}`}
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
      <p className="text-xs text-text-muted mt-2 shrink-0">
        <span className="inline-block w-2.5 h-2.5 rounded-xs align-middle mr-1" style={{ background: 'rgba(37,99,235,0.6)' }} /> within a department ·
        <span className="inline-block w-2.5 h-2.5 rounded-xs align-middle mx-1" style={{ background: 'rgba(220,38,38,0.6)' }} /> handed across departments
      </p>
    </div>
  )
}
