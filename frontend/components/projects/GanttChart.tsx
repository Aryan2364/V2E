'use client'

import { useState, useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import GanttBar from './GanttBar'
import type { Project, ProjectMilestone, ProjectTask } from '@/lib/types/projects'

type ZoomLevel = 'week' | 'month' | 'quarter'

const ZOOM_DAYS: Record<ZoomLevel, number> = { week: 7, month: 30, quarter: 91 }

interface GanttRow {
  id: string
  label: string
  color: string
  start?: Date
  end?: Date
  isDiamond?: boolean
  completed?: boolean
  isMilestone?: boolean
}

function dateOffset(start: Date, d: Date, total: number) {
  return ((d.getTime() - start.getTime()) / 86400000 / total) * 100
}

function dateDuration(start: Date, end: Date, total: number) {
  return ((end.getTime() - start.getTime()) / 86400000 / total) * 100
}

interface GanttChartProps {
  project: Project
  milestones: ProjectMilestone[]
  tasks: ProjectTask[]
}

export default function GanttChart({ project, milestones, tasks }: GanttChartProps) {
  const [zoom, setZoom] = useState<ZoomLevel>('month')
  const [windowStart, setWindowStart] = useState<Date>(() => {
    if (project.start_date) return new Date(project.start_date)
    const d = new Date(); d.setDate(d.getDate() - 7); return d
  })
  const containerRef = useRef<HTMLDivElement>(null)

  const totalDays = ZOOM_DAYS[zoom]
  const windowEnd = new Date(windowStart.getTime() + totalDays * 86400000)
  const today = new Date()

  function navigate(dir: -1 | 1) {
    const d = new Date(windowStart)
    d.setDate(d.getDate() + dir * Math.floor(totalDays / 2))
    setWindowStart(d)
  }

  function fmtDateLabel(d: Date) {
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  }

  // Build rows
  const rows: GanttRow[] = []

  // Project row
  if (project.start_date && project.end_date) {
    rows.push({
      id: 'project',
      label: project.name,
      color: 'var(--primary-text)',
      start: new Date(project.start_date),
      end: new Date(project.end_date),
      completed: project.completion_percentage === 100,
    })
  }

  for (const ms of milestones) {
    rows.push({
      id: `ms-${ms.id}`,
      label: ms.name,
      color: ms.status === 'achieved' ? 'var(--success)' : 'var(--warning)',
      start: ms.due_date ? new Date(ms.due_date) : undefined,
      isDiamond: true,
      isMilestone: true,
    })

    const msTasks = tasks.filter((pt) => pt.milestone_id === ms.id && pt.task)
    for (const pt of msTasks) {
      const task = pt.task!
      const start = task.status?.type === 'completed' ? undefined : undefined
      rows.push({
        id: `task-${pt.id}`,
        label: task.title ?? 'Task',
        color: task.status?.color ?? 'var(--text-muted)',
        start: undefined,
        end: task.deadline ? new Date(task.deadline) : undefined,
        completed: task.status?.type === 'completed',
      })
    }
  }

  const directTasks = tasks.filter((pt) => !pt.milestone_id && pt.task)
  for (const pt of directTasks) {
    const task = pt.task!
    rows.push({
      id: `task-${pt.id}`,
      label: task.title ?? 'Task',
      color: task.status?.color ?? 'var(--text-muted)',
      end: task.deadline ? new Date(task.deadline) : undefined,
      completed: task.status?.type === 'completed',
    })
  }

  const todayOffset = today >= windowStart && today <= windowEnd
    ? dateOffset(windowStart, today, totalDays)
    : null

  // Column header labels
  const colLabels: string[] = []
  const step = zoom === 'week' ? 1 : zoom === 'month' ? 7 : 14
  for (let i = 0; i < totalDays; i += step) {
    const d = new Date(windowStart.getTime() + i * 86400000)
    colLabels.push(fmtDateLabel(d))
  }

  return (
    <div className="bg-surface border border-border-light rounded-card shadow-card overflow-hidden">
      {/* Controls */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border-light bg-surface-sunken">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => navigate(-1)} className="p-1.5 rounded-xs hover:bg-surface-control-pressed text-text-secondary transition-colors">
            <ChevronLeft size={16} />
          </button>
          <span className="text-body font-medium text-text-primary">
            {fmtDateLabel(windowStart)} — {fmtDateLabel(windowEnd)}
          </span>
          <button type="button" onClick={() => navigate(1)} className="p-1.5 rounded-xs hover:bg-surface-control-pressed text-text-secondary transition-colors">
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="flex items-center gap-1 bg-surface-control-pressed rounded-[8px] p-0.5">
          {(['week', 'month', 'quarter'] as ZoomLevel[]).map((z) => (
            <button
              key={z}
              type="button"
              onClick={() => setZoom(z)}
              className={[
                'px-3 py-1 rounded-[6px] text-meta font-medium transition-colors capitalize',
                zoom === z ? 'bg-white text-text-primary shadow-xs' : 'text-text-secondary hover:text-text-primary',
              ].join(' ')}
            >
              {z}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div ref={containerRef} className="overflow-x-auto">
        <div style={{ minWidth: 700 }}>
          {/* Header row */}
          <div className="flex border-b border-border-light bg-surface-sunken">
            <div className="w-[200px] shrink-0 px-4 py-2 border-r border-border-light">
              <p className="text-meta font-medium text-text-secondary">Item</p>
            </div>
            <div className="flex-1 relative flex">
              {colLabels.map((lbl, i) => (
                <div
                  key={i}
                  className="flex-1 text-center text-meta text-text-muted py-2 border-r border-border-light last:border-0"
                >
                  {lbl}
                </div>
              ))}
            </div>
          </div>

          {rows.length === 0 && (
            <div className="flex items-center justify-center py-12 text-body text-text-muted">
              Add milestones and tasks with dates to see the Gantt chart.
            </div>
          )}

          {rows.map((row) => {
            let barStart: number | null = null
            let barWidth: number | null = null

            if (row.isDiamond && row.start) {
              barStart = dateOffset(windowStart, row.start, totalDays)
            } else if (!row.isDiamond && row.end) {
              const eff = row.start && row.start >= windowStart ? row.start : windowStart
              barStart = dateOffset(windowStart, eff, totalDays)
              barWidth = dateDuration(eff, row.end, totalDays)
            }

            const inWindow = barStart !== null && barStart < 100 && (barWidth === null || barStart + barWidth > 0)

            return (
              <div key={row.id} className="flex border-b border-border-light last:border-0 hover:bg-surface-sunken transition-colors" style={{ height: 40 }}>
                <div
                  className="w-[200px] shrink-0 px-4 flex items-center border-r border-border-light overflow-hidden"
                  style={{ paddingLeft: row.isMilestone ? 16 : row.id.startsWith('task') ? 28 : 16 }}
                >
                  {row.isMilestone && (
                    <div className="w-2 h-2 rotate-45 shrink-0 mr-2" style={{ backgroundColor: row.color }} />
                  )}
                  <span className="text-meta font-medium text-text-primary truncate">{row.label}</span>
                </div>
                <div className="flex-1 relative">
                  {todayOffset !== null && (
                    <div
                      className="absolute top-0 bottom-0 w-px z-10 pointer-events-none"
                      style={{ left: `${todayOffset}%`, borderLeft: '2px dashed var(--danger)', opacity: 0.6 }}
                    />
                  )}
                  {inWindow && barStart !== null && (
                    <GanttBar
                      label={row.label}
                      startOffset={Math.max(0, barStart)}
                      widthPercent={row.isDiamond ? 0 : Math.max(0, Math.min(barWidth ?? 10, 100 - Math.max(0, barStart)))}
                      color={row.color}
                      completed={row.completed}
                      isDiamond={row.isDiamond}
                      tooltip={`${row.label}${row.end ? ` · Due ${row.end.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}`}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
