'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { UserSquare2, BarChart2, ArrowRight, CalendarClock, CalendarDays } from 'lucide-react'

interface ReportTile {
  key: string
  title: string
  blurb: string
  href: string
  Icon: React.ElementType
  accent: string
  badge?: string
}

// The catalogue of Work reports. New reports get added here as tiles — the index
// scales by appending, never by growing a single mega-page.
const REPORTS: ReportTile[] = [
  {
    key: 'person-scorecard',
    title: 'Person Scorecard',
    blurb:
      'A per-person task compliance scorecard — scope, total entries, completion, on-time rate, delay and an automatic Grade. Open one person or download everyone in your scope.',
    href: '/dashboard/tasks/reports-new/person-scorecard',
    Icon: UserSquare2,
    accent: 'var(--primary-text)',
    badge: 'New',
  },
  {
    key: 'ageing',
    title: 'Pending & Overdue Ageing',
    blurb:
      'Open work only — Overdue or Ongoing — bucketed by how late it is, by person and by task. Click any number to see exactly those tasks. Download the full three-sheet report.',
    href: '/dashboard/tasks/reports-new/ageing',
    Icon: CalendarClock,
    accent: 'var(--danger)',
    badge: 'New',
  },
  {
    key: 'calendar',
    title: 'Monthly Task Compliance Calendar',
    blurb:
      'A month grid, one row per task and person — each day coloured green (on time), amber (late), red (missed) or white (not due yet). Pick any month, filter, and click a square to open the task.',
    href: '/dashboard/tasks/reports-new/calendar',
    Icon: CalendarDays,
    accent: 'var(--text-secondary)',
    badge: 'New',
  },
  {
    key: 'analytics',
    title: 'Analytics',
    blurb:
      'Organization-wide task analytics — team- and department-level completion rates and priority / category / status breakdowns.',
    href: '/dashboard/tasks/reports',
    Icon: BarChart2,
    accent: 'var(--text-secondary)',
  },
]

export default function ReportsIndexPage() {
  const router = useRouter()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] font-medium text-text-primary leading-tight">Reports</h1>
        <p className="mt-1 text-[15px] text-text-secondary">
          Pick a report. What you can see is scoped to your visibility — your own work, your team, or the whole organization.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {REPORTS.map((r) => (
          <button
            key={r.key}
            onClick={() => router.push(r.href)}
            className="group text-left bg-surface border border-border-light rounded-card shadow-card p-4 hover:border-primary hover:shadow-dialog transition-all"
          >
            <div className="flex items-start gap-4">
              <div
                className="w-11 h-11 rounded-control flex items-center justify-center shrink-0"
                style={{ backgroundColor: r.accent + '18', color: r.accent }}
              >
                <r.Icon size={22} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-[17px] font-medium text-text-primary">{r.title}</h2>
                  {r.badge && (
                    <span className="text-[10px] font-medium uppercase tracking-wide text-primary-text bg-primary-subtle border border-primary-border rounded-full px-2 py-0.5">
                      {r.badge}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-text-secondary">{r.blurb}</p>
              </div>
              <ArrowRight
                size={18}
                className="text-text-muted group-hover:text-primary-text group-hover:translate-x-0.5 transition-all shrink-0 mt-1"
              />
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
