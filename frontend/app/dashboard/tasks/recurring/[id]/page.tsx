'use client'

import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { tasksApi } from '@/lib/api/tasks'
import { goalsApi } from '@/lib/api/goals'
import type {
  RecurringTemplate, RecurringScheduleEntry, Task, TaskAttachment,
  TaskCategory, TaskPriority, TaskStatus, EligibleAssigneeUser,
  RecurringStats, RecurringInstanceTiming, ReminderSpec, RecurringInstanceAttachment,
} from '@/lib/types/tasks'
import TaskCard from '@/components/tasks/TaskCard'
import { formatDate as fmtDate } from '@/lib/format'
import EditRecurringModal from '@/components/tasks/EditRecurringModal'
import ManageAccessModal from '@/components/tasks/ManageAccessModal'
import type { EmployeePickerOption } from '@/components/ui/EmployeePicker'
import StyledSelect from '@/components/ui/StyledSelect'
import Tooltip from '@/components/ui/tooltip'
import { FILE_TYPE_GROUPS, groupsFromExtensions } from '@/lib/attachments'
import {
  RotateCcw, Play, Pause, Edit2, Zap,
  CheckCircle2, Clock, ListChecks, BarChart2, Filter, Users,
  Calendar, Shield, CheckSquare, Flame, Target, TrendingUp, Bell, Paperclip, Download, Tag,
} from 'lucide-react'
import TagChip from '@/components/ui/TagChip'
import { PageHeader } from '@/components/shell/page-header'

// ─── Schedule helpers (mirrors recurring/page.tsx) ────────────────────────────

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function entryLabel(entry: RecurringScheduleEntry): string {
  switch (entry.schedule_type) {
    case 'daily':
      return `Every ${entry.every > 1 ? `${entry.every} days` : 'day'}`
    case 'weekly': {
      const days = Array.isArray(entry.days) ? (entry.days as number[]).map((d) => DOW[d]).join(', ') : ''
      return `Every ${entry.every > 1 ? `${entry.every} weeks` : 'week'}${days ? ` on ${days}` : ''}`
    }
    case 'monthly': {
      const md = Array.isArray(entry.month_days) ? (entry.month_days as number[]) : []
      const dayStr = md.length === 0 ? '?' : md.length <= 3 ? md.join(', ') : `${md.slice(0, 3).join(', ')}…`
      return `Day${md.length !== 1 ? 's' : ''} ${dayStr} every ${entry.every > 1 ? `${entry.every} months` : 'month'}`
    }
    case 'yearly': {
      const dates = Array.isArray(entry.yearly_dates) ? (entry.yearly_dates as { month: number; day: number }[]) : []
      if (dates.length === 0) return 'Yearly'
      if (dates.length === 1) return `${MONTHS_SHORT[dates[0].month - 1]} ${dates[0].day} each year`
      return `${dates.length} dates each year`
    }
    default:
      return entry.schedule_type
  }
}

function formatDate(str: string): string {
  return fmtDate(str)
}

function getInitials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
}

const avatarColors = ['bg-primary', 'bg-text-secondary', 'bg-success', 'bg-warning', 'bg-danger', 'bg-text-secondary', 'bg-text-secondary']
function avatarColor(str: string): string {
  let h = 0; for (let i = 0; i < str.length; i++) h += str.charCodeAt(i)
  return avatarColors[h % avatarColors.length]
}

// ─── Timing taxonomy (mirrors the Work Overview colors) ───────────────────────

const TIMING_META: Record<RecurringInstanceTiming, { label: string; color: string; bg: string }> = {
  early: { label: 'Early', color: 'var(--text-secondary)', bg: 'var(--surface-control)' },
  on_time: { label: 'On time', color: 'var(--success)', bg: 'var(--success-bg)' },
  late: { label: 'Late', color: 'var(--warning)', bg: 'var(--warning-bg)' },
  partial: { label: 'Partly done', color: 'var(--text-secondary)', bg: 'var(--surface-control)' },
  incomplete: { label: 'Not done', color: 'var(--danger)', bg: 'var(--danger-bg)' },
  overdue: { label: 'Overdue (open)', color: 'var(--danger)', bg: 'var(--danger-bg)' },
  pending: { label: 'Open', color: 'var(--text-muted)', bg: 'var(--surface-control)' },
}

function reminderSpecLabel(s: ReminderSpec): string {
  const extras = (s.recipients ?? []).filter((r) => r !== 'assignee')
  const who = extras.length ? ` → +${extras.join(' + ')}` : ''
  if (s.kind === 'relative') {
    const d = (s.offset_days ?? 0) === 0 ? 'On the day' : `${s.offset_days} day${s.offset_days !== 1 ? 's' : ''} before`
    return `${d} · ${s.time ?? '09:00'}${who}`
  }
  const at = s.remind_at ? fmtDate(s.remind_at) : '?'
  return `On ${at}${who}`
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon, color, hint }: { label: string; value: number | string; icon: React.ReactNode; color: string; hint?: string }) {
  return (
    <div className="bg-surface border border-border-light rounded-card shadow-card p-4 flex items-start gap-3">
      <div className="w-9 h-9 rounded-control flex items-center justify-center shrink-0" style={{ backgroundColor: color + '18', color }}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-medium text-text-primary leading-tight tabular-nums">{value}</p>
        <p className="text-sm text-text-secondary mt-0.5">{label}</p>
        {hint && <p className="text-[11px] text-text-muted mt-0.5">{hint}</p>}
      </div>
    </div>
  )
}

// ─── Performance card ─────────────────────────────────────────────────────────

function PerformanceCard({ stats, onOpenInstance }: { stats: RecurringStats; onOpenInstance: (taskId: string) => void }) {
  const closed = stats.completed + stats.missed
  const trendMax = Math.max(1, ...stats.trend_monthly.map((m) => m.total))
  const shownTimings: RecurringInstanceTiming[] = ['early', 'on_time', 'late', 'partial', 'incomplete', 'overdue', 'pending']

  return (
    <div className="bg-surface border border-border-light rounded-card shadow-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <TrendingUp size={16} className="text-primary-text" />
        <h3 className="text-[16px] font-medium text-text-primary">Performance</h3>
      </div>

      {closed === 0 ? (
        <p className="text-sm text-text-secondary">
          No finished instances yet — the track record builds up as scheduled tasks get completed (or missed).
        </p>
      ) : (
        <>
          {/* Outcome strip — the last 10 instances at a glance */}
          <div>
            <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">Last {stats.recent.length} outcomes</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {stats.recent.map((r) => {
                const meta = TIMING_META[r.timing]
                return (
                  <Tooltip key={r.task_id} label={`${formatDate(r.date)} — ${meta.label}`}>
                    <button
                      type="button"
                      onClick={() => onOpenInstance(r.task_id)}
                      className="w-7 h-7 rounded-control border transition-transform hover:scale-110"
                      style={{ backgroundColor: meta.bg, borderColor: meta.color }}
                      aria-label={`${formatDate(r.date)} — ${meta.label}`}
                    />
                  </Tooltip>
                )
              })}
            </div>
            <div className="flex items-center gap-3 flex-wrap mt-2">
              {shownTimings
                .filter((t) => stats.timing[t === 'overdue' ? 'overdue' : t] > 0 || stats.recent.some((r) => r.timing === t))
                .map((t) => (
                  <span key={t} className="inline-flex items-center gap-1.5 text-[11px] text-text-secondary">
                    <span className="w-2.5 h-2.5 rounded-[3px] border" style={{ backgroundColor: TIMING_META[t].bg, borderColor: TIMING_META[t].color }} />
                    {TIMING_META[t].label}
                  </span>
                ))}
            </div>
          </div>

          {/* Monthly trend — stacked bars, last 6 months */}
          <div>
            <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">Monthly trend</p>
            <div className="flex items-end gap-2 h-28">
              {stats.trend_monthly.map((m) => {
                const [y, mo] = m.month.split('-').map(Number)
                const label = MONTHS_SHORT[(mo ?? 1) - 1]
                const seg = (n: number) => `${(n / trendMax) * 100}%`
                return (
                  <div key={m.month} className="flex-1 flex flex-col items-center gap-1 h-full">
                    <Tooltip label={`${label} ${y}: ${m.total} task${m.total !== 1 ? 's' : ''} — ${m.on_time} on time, ${m.late} late, ${m.missed} missed, ${m.open} open`}>
                    <div
                      className="w-full max-w-[44px] flex-1 flex flex-col-reverse rounded-[4px] overflow-hidden bg-surface-sunken border border-border-light"
                    >
                      <div style={{ height: seg(m.on_time), backgroundColor: 'var(--success)' }} />
                      <div style={{ height: seg(m.late), backgroundColor: 'var(--warning)' }} />
                      <div style={{ height: seg(m.missed), backgroundColor: 'var(--danger)' }} />
                      <div style={{ height: seg(m.open), backgroundColor: 'var(--surface-control-pressed)' }} />
                    </div>
                    </Tooltip>
                    <span className="text-[10px] text-text-muted">{label}</span>
                    <span className="text-[10px] font-medium text-text-primary tabular-nums -mt-1">{m.total > 0 ? m.total : ''}</span>
                  </div>
                )
              })}
            </div>
            <div className="flex items-center gap-3 flex-wrap mt-2">
              {([['On time', 'var(--success)'], ['Late', 'var(--warning)'], ['Missed', 'var(--danger)'], ['Still open', 'var(--border)']] as const).map(([l, c]) => (
                <span key={l} className="inline-flex items-center gap-1.5 text-[11px] text-text-secondary">
                  <span className="w-2.5 h-2.5 rounded-[3px]" style={{ backgroundColor: c }} />
                  {l}
                </span>
              ))}
            </div>
          </div>

          {/* Per-person record */}
          {stats.by_assignee.length > 0 && (
            <div>
              <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">By person</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] font-medium text-text-muted uppercase tracking-wide border-b border-border-light">
                      <th className="py-1.5 pr-2">Person</th>
                      <th className="py-1.5 px-2 text-right">Assigned</th>
                      <th className="py-1.5 px-2 text-right">Done</th>
                      <th className="py-1.5 px-2 text-right">Late</th>
                      <th className="py-1.5 pl-2 text-right">Missed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.by_assignee.map((a) => (
                      <tr key={a.user_id} className="border-b border-border-light last:border-0">
                        <td className="py-2 pr-2">
                          <span className="inline-flex items-center gap-2 min-w-0">
                            <span className={`w-6 h-6 rounded-full ${avatarColor(a.name)} flex items-center justify-center text-white text-[9px] font-medium shrink-0`}>
                              {getInitials(a.name)}
                            </span>
                            <span className="text-text-primary truncate">{a.name}</span>
                          </span>
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums text-text-secondary">{a.assigned}</td>
                        <td className="py-2 px-2 text-right tabular-nums font-medium text-success">{a.done}</td>
                        <td className={`py-2 px-2 text-right tabular-nums font-medium ${a.late > 0 ? 'text-warning' : 'text-text-muted'}`}>{a.late}</td>
                        <td className={`py-2 pl-2 text-right tabular-nums font-medium ${a.missed > 0 ? 'text-danger' : 'text-text-muted'}`}>{a.missed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {stats.completion_mode === 'any_can_complete' && (
                <p className="text-[11px] text-text-muted mt-1.5">
                  “Done” credits whoever actually completed each day's task (anyone-can-complete mode).
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RecurringDetailPage() {
  const { user } = useAuth()
  const router = useRouter()
  const params = useParams()
  const templateId = params.id as string
  const orgId = user?.organizationId ?? ''

  const [template, setTemplate] = useState<RecurringTemplate | null>(null)
  const [instances, setInstances] = useState<Task[]>([])
  const [stats, setStats] = useState<RecurringStats | null>(null)
  const [attachments, setAttachments] = useState<TaskAttachment[]>([])
  const [goalTitle, setGoalTitle] = useState<string | null>(null)
  const [categories, setCategories] = useState<TaskCategory[]>([])
  const [priorities, setPriorities] = useState<TaskPriority[]>([])
  const [statuses, setStatuses] = useState<TaskStatus[]>([])
  const [userMap, setUserMap] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)

  const [activeTab, setActiveTab] = useState<'instances' | 'documents'>('instances')
  const [instanceAttachments, setInstanceAttachments] = useState<RecurringInstanceAttachment[]>([])

  const [filterStatus, setFilterStatus] = useState('all')
  const [showEditModal, setShowEditModal] = useState(false)
  const [showManageAccess, setShowManageAccess] = useState(false)
  const [employees, setEmployees] = useState<EmployeePickerOption[]>([])
  const [toggling, setToggling] = useState(false)


  const loadData = useCallback(() => {
    if (!orgId || !templateId) { setLoading(false); return }
    setLoading(true)
    Promise.all([
      tasksApi.getRecurringTemplates(orgId).catch(() => [] as RecurringTemplate[]),
      tasksApi.getRecurringInstances(orgId, templateId).catch(() => [] as Task[]),
      tasksApi.getRecurringStats(orgId, templateId).catch(() => null),
      tasksApi.listRecurringAttachments(orgId, templateId).catch(() => [] as TaskAttachment[]),
      tasksApi.getCategories(orgId).catch(() => []),
      tasksApi.getPriorities(orgId).catch(() => []),
      tasksApi.getStatuses(orgId).catch(() => []),
      tasksApi.getEligibleAssignees(orgId).catch(() => ({ departments: [], total: 0 })),
      tasksApi.listRecurringInstanceAttachments(orgId, templateId).catch(() => [] as RecurringInstanceAttachment[]),
    ]).then(([templates, inst, s, atts, cats, prios, statuses, eligible, instAtts]) => {
      const found = (templates as RecurringTemplate[]).find((t) => t.id === templateId) ?? null
      setTemplate(found)
      setInstances(inst as Task[])
      setStats(s as RecurringStats | null)
      setAttachments(atts as TaskAttachment[])
      setCategories(cats)
      setPriorities(prios)
      setStatuses(statuses)
      const map = new Map<string, string>()
      const opts: EmployeePickerOption[] = []
      ;(eligible as { departments: { users: EligibleAssigneeUser[] }[] }).departments.forEach((dept) =>
        dept.users.forEach((u) => {
          map.set(u.user_id, u.name)
          opts.push({ user_id: u.user_id, name: u.name, role_title: u.role_title, department_name: u.department_name })
        })
      )
      setUserMap(map)
      setEmployees(opts)
      setInstanceAttachments(instAtts as RecurringInstanceAttachment[])
    }).finally(() => setLoading(false))
  }, [orgId, templateId])


  useEffect(() => { loadData() }, [loadData])

  // Resolve the linked goal's title (if any) for the Settings card.
  useEffect(() => {
    const gid = template?.linked_goal_id
    if (!gid || !orgId) { setGoalTitle(null); return }
    let cancelled = false
    goalsApi.get(orgId, gid)
      .then((g) => { if (!cancelled) setGoalTitle(g?.title ?? 'Goal unavailable') })
      // Deleted goal or no read access — show a fallback, not an eternal spinner.
      .catch(() => { if (!cancelled) setGoalTitle('Goal unavailable') })
    return () => { cancelled = true }
  }, [template?.linked_goal_id, orgId])

  const filtered = useMemo(() => instances.filter((t) => {
    if (filterStatus !== 'all' && t.status_id !== filterStatus) return false
    return true
  }), [instances, filterStatus])

  const isFiltered = filterStatus !== 'all'

  const groupedAttachments = useMemo(() => {
    const groups: {
      task_id: string
      task_title: string
      task_date: string
      attachments: RecurringInstanceAttachment[]
    }[] = []

    const map = new Map<string, RecurringInstanceAttachment[]>()
    instanceAttachments.forEach((att) => {
      const list = map.get(att.task_id!) ?? []
      list.push(att)
      map.set(att.task_id!, list)
    })

    map.forEach((atts, taskId) => {
      if (atts.length > 0) {
        groups.push({
          task_id: taskId,
          task_title: atts[0].task_title,
          task_date: atts[0].task_date,
          attachments: atts,
        })
      }
    })

    return groups.sort((a, b) => new Date(b.task_date).getTime() - new Date(a.task_date).getTime())
  }, [instanceAttachments])


  async function handleToggle() {
    if (!template) return
    setToggling(true)
    try {
      if (template.is_active) {
        await tasksApi.pauseRecurring(orgId, templateId)
        setTemplate((t) => t ? { ...t, is_active: false } : t)
      } else {
        await tasksApi.resumeRecurring(orgId, templateId)
        setTemplate((t) => t ? { ...t, is_active: true } : t)
        tasksApi.spawnTodayRecurring(orgId, templateId).then(() => loadData()).catch(() => null)
      }
    } finally {
      setToggling(false)
    }
  }


  if (!orgId) return null

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!template) {
    return (
      <div className="space-y-4">
        <PageHeader title="Template not found" trail={[{ label: 'Tasks', href: '/dashboard/tasks' }, { label: 'Recurring', href: '/dashboard/tasks/recurring' }]} />
      </div>
    )
  }

  const entries = template.schedule_entries ?? []
  const frequencyLabel = entries.length === 0
    ? 'No schedule'
    : entries.length === 1
      ? entryLabel(entries[0])
      : `${entries.length} schedules`
  const proofGroups = groupsFromExtensions(template.proof_allowed_extensions ?? [])
  const proofTypesLabel = proofGroups.size === FILE_TYPE_GROUPS.length
    ? 'Any file type'
    : FILE_TYPE_GROUPS.filter((g) => proofGroups.has(g.key)).map((g) => g.label).join(', ')
  const escalationIds = template.escalation_user_ids ?? []
  const checklistItems = template.checklist_items ?? []
  const reminderSpecs = template.reminder_specs ?? []

  return (
    <div className="space-y-6 lg:h-full lg:flex lg:flex-col lg:overflow-hidden">
      <PageHeader
        title={template.title}
        trail={[{ label: 'Tasks', href: '/dashboard/tasks' }, { label: 'Recurring', href: '/dashboard/tasks/recurring' }]}
        meta={
          <>
            <span className="inline-flex items-center gap-2">
              <RotateCcw size={11} className="shrink-0" />
              {frequencyLabel} · Created by {template?.created_by_name ?? 'Unknown'} · Created {formatDate(template.created_at)}
            </span>
            {template.description && <span className="block mt-1 text-[15px]">{template.description}</span>}
          </>
        }
        actions={
          <div className="flex items-center gap-1 shrink-0">
            {template.can_edit && (
              <Tooltip label="Edit template">
                <button
                  onClick={() => setShowEditModal(true)}
                  aria-label="Edit template"
                  className="w-7 h-7 rounded-control flex items-center justify-center text-text-muted hover:text-primary-text hover:bg-primary-subtle transition-colors shrink-0"
                >
                  <Edit2 size={14} />
                </button>
              </Tooltip>
            )}
            {template.can_manage && (
              <Tooltip label="Manage who can see this">
                <button
                  onClick={() => setShowManageAccess(true)}
                  aria-label="Manage access"
                  className="w-7 h-7 rounded-control flex items-center justify-center text-text-muted hover:text-primary-text hover:bg-primary-subtle transition-colors shrink-0"
                >
                  <Shield size={14} />
                </button>
              </Tooltip>
            )}
          </div>
        }
      />


      {/* Body */}
      <div className="flex flex-col lg:flex-row gap-6 lg:flex-1 lg:min-h-0">

        {/* ── Main: Performance + instances list ─────────────────────────── */}
         <div className="flex-1 min-w-0 space-y-4 lg:min-h-0 lg:overflow-y-auto lg:pr-3">
          {stats && (stats.completed + stats.missed > 0) && (
            <PerformanceCard stats={stats} onOpenInstance={(id) => router.push(`/dashboard/tasks/${id}`)} />
          )}

          {/* Tab bar with inline controls */}
          <div className="flex items-center justify-between border-b border-border-light mb-4 flex-wrap gap-2">
            <div className="flex gap-4">
              <button
                onClick={() => setActiveTab('instances')}
                className={`px-1 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${activeTab === 'instances' ? 'border-primary text-primary-text' : 'border-transparent text-text-secondary hover:text-text-primary'}`}
              >
                Task Instances
              </button>
              <button
                onClick={() => setActiveTab('documents')}
                className={`px-1 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${activeTab === 'documents' ? 'border-primary text-primary-text' : 'border-transparent text-text-secondary hover:text-text-primary'}`}
              >
                Instance Documents
              </button>
            </div>

            {/* Right side controls: filter & count */}
            {activeTab === 'instances' && (
              <div className="flex items-center gap-3 pb-1.5">
                {/* Filter Selector */}
                <div className="flex items-center gap-1.5">
                  <StyledSelect
                    value={filterStatus}
                    onChange={(v) => setFilterStatus(v)}
                    placeholder="All Statuses"
                    size="sm"
                    wrapperClassName="w-32"
                    options={[
                      { value: 'all', label: 'All Statuses' },
                      ...statuses.map((s) => ({ value: s.id, label: s.label, color: s.color })),
                    ]}
                  />
                  {isFiltered && (
                    <button
                      onClick={() => setFilterStatus('all')}
                      className="px-2.5 py-[5px] text-xs font-medium text-danger border border-danger-border bg-danger-bg rounded-control hover:bg-danger-bg transition-colors"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Count */}
                <p className="text-xs text-text-secondary font-medium">
                  {filtered.length} instance{filtered.length !== 1 ? 's' : ''}
                  {isFiltered && ` (filtered)`}
                </p>
              </div>
            )}
          </div>

          {activeTab === 'instances' ? (
            <>

              {/* List */}
              {filtered.length === 0 ? (
                <div className="bg-surface border border-border-light rounded-card shadow-card flex flex-col items-center justify-center py-12">
                  <div className="w-12 h-12 rounded-full bg-surface-control flex items-center justify-center mb-3">
                    <CheckSquare size={20} className="text-text-muted" />
                  </div>
                  <p className="font-medium text-text-primary text-sm">
                    {isFiltered ? 'No instances match your filters' : 'No task instances yet'}
                  </p>
                  <p className="text-text-secondary text-sm mt-1">
                    {isFiltered ? 'Try adjusting your filters.' : 'Tasks will appear here once the schedule fires.'}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {filtered.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onClick={() => router.push(`/dashboard/tasks/${task.id}`)}
                      priorities={priorities}
                      statuses={statuses}
                      categories={categories}
                      currentUserId={user?.id}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              {/* Grouped Attachments List */}
              {groupedAttachments.length === 0 ? (
                <div className="bg-surface border border-border-light rounded-card shadow-card flex flex-col items-center justify-center py-12">
                  <div className="w-12 h-12 rounded-full bg-surface-control flex items-center justify-center mb-3">
                    <Paperclip size={20} className="text-text-muted" />
                  </div>
                  <p className="font-medium text-text-primary text-sm">No instance documents yet</p>
                  <p className="text-text-secondary text-sm mt-1">
                    Documents uploaded to spawned tasks will appear here.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {groupedAttachments.map((group) => (
                    <div key={group.task_id} className="bg-surface border border-border-light rounded-card shadow-card overflow-hidden">
                      {/* Header: Link to instance page */}
                      <div className="flex items-center justify-between px-4 py-3 bg-surface-sunken border-b border-border-light">
                        <div className="min-w-0">
                          <button
                            onClick={() => router.push(`/dashboard/tasks/${group.task_id}`)}
                            className="text-sm font-medium text-primary-text hover:underline text-left wrap-break-word"
                          >
                            {group.task_title}
                          </button>
                          <p className="text-xs text-text-muted mt-0.5">
                            {formatDate(group.task_date)}
                          </p>
                        </div>
                        <button
                          onClick={() => router.push(`/dashboard/tasks/${group.task_id}`)}
                          className="text-xs font-medium text-text-secondary bg-surface border border-border rounded-control px-2.5 py-1.5 hover:bg-surface-control transition-colors"
                        >
                          View Task
                        </button>
                      </div>
                      {/* Attachments List */}
                      <div className="p-4 divide-y divide-surface-control">
                        {group.attachments.map((att) => (
                          <div key={att.id} className="flex items-center justify-between py-2 first:pt-0 last:pb-0 gap-4">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <Paperclip size={14} className="text-text-muted shrink-0" />
                              <div className="min-w-0">
                                <button
                                  onClick={() => {
                                    if (att.is_proof) {
                                      tasksApi.downloadProof(orgId, group.task_id, att.id)
                                    } else {
                                      tasksApi.downloadAttachment(orgId, group.task_id, att.id)
                                    }
                                  }}
                                  className="text-sm font-medium text-text-primary hover:text-primary-text text-left truncate block max-w-md"
                                >
                                  {att.file_name}
                                </button>
                                <p className="text-xs text-text-muted">
                                  {att.is_proof ? (
                                    <span className="text-danger font-medium bg-danger-bg px-1 py-0.5 rounded-xs text-[10px] mr-1.5">Proof</span>
                                  ) : null}
                                  {att.comment_id ? (
                                    <span className="text-text-secondary text-[10px] bg-surface-control px-1 py-0.5 rounded-xs mr-1.5">In Comment</span>
                                  ) : null}
                                  Uploaded by {att.uploaded_by_name} · {(att.size_bytes / 1024).toFixed(1)} KB
                                </p>
                              </div>
                            </div>
                            <button
                              onClick={() => {
                                if (att.is_proof) {
                                  tasksApi.downloadProof(orgId, group.task_id, att.id)
                                } else {
                                  tasksApi.downloadAttachment(orgId, group.task_id, att.id)
                                }
                              }}
                              className="text-xs text-primary-text hover:underline font-medium shrink-0"
                            >
                              Download
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>


        {/* ── Sidebar: Template info ─────────────────────────────────────── */}
         <div className="w-full lg:w-80 shrink-0 space-y-4 lg:min-h-0 lg:overflow-y-auto lg:pr-3">

          {/* Status Card */}
          <div className="bg-surface border border-border-light rounded-card shadow-card overflow-hidden">
            <div className={`flex items-center justify-between px-4 py-2.5 border-b ${template.is_active ? 'bg-success-bg border-success-border' : 'bg-danger-bg border-danger-border'}`}>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${template.is_active ? 'bg-success' : 'bg-danger'}`} />
                <p className={`text-[11px] font-medium uppercase tracking-widest ${template.is_active ? 'text-success' : 'text-danger'}`}>
                  Status
                </p>
              </div>
            </div>
            <div className="p-4 flex items-center justify-between gap-4">
              <span className={`text-sm font-medium ${template.is_active ? 'text-success' : 'text-danger'}`}>
                {template.is_active ? 'Active' : 'Paused'}
              </span>
              {template.can_edit && (
                <button
                  onClick={handleToggle}
                  disabled={toggling}
                  className={[
                    'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-control disabled:opacity-60 transition-colors',
                    template.is_active
                      ? 'text-warning bg-warning-bg border border-warning-border hover:bg-warning-bg'
                      : 'text-success bg-success-bg border border-success-border hover:bg-success-bg',
                  ].join(' ')}
                >
                  {template.is_active ? <Pause size={12} /> : <Play size={12} />}
                  {toggling ? '...' : template.is_active ? 'Pause' : 'Resume'}
                </button>
              )}
            </div>
          </div>

          {/* Overview Stats */}
          <div className="bg-surface border border-border-light rounded-card shadow-card overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-primary-subtle border-b border-primary-border">
              <span className="w-2 h-2 rounded-full bg-primary" />
              <p className="text-[11px] font-medium text-primary-text uppercase tracking-widest">Overview</p>
            </div>
            <div className="p-4 space-y-4">
              {/* Total Instances */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ListChecks size={15} className="text-primary-text" />
                  <span className="text-sm font-medium text-text-secondary">Total Instances</span>
                </div>
                <span className="text-sm font-medium text-text-primary tabular-nums">
                  {stats?.total_instances ?? 0}
                </span>
              </div>
              
              {/* Completed */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={15} className="text-success" />
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-text-secondary block">Completed</span>
                    {stats && stats.missed > 0 && (
                      <span className="text-[10px] text-text-muted block">{stats.missed} missed</span>
                    )}
                  </div>
                </div>
                <span className="text-sm font-medium text-text-primary tabular-nums">
                  {stats?.completed ?? 0}
                </span>
              </div>

              {/* On-time rate */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock size={15} className="text-text-secondary" />
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-text-secondary block">On-time Rate</span>
                    <span className="text-[10px] text-text-muted block">of finished instances</span>
                  </div>
                </div>
                <span className="text-sm font-medium text-text-primary tabular-nums">
                  {stats?.on_time_rate_percent ?? 0}%
                </span>
              </div>

              {/* Current streak */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Flame size={15} className="text-warning" />
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-text-secondary block">Current Streak</span>
                    {stats && (
                      <span className="text-[10px] text-text-muted block">best: {stats.best_streak} in a row</span>
                    )}
                  </div>
                </div>
                <span className="text-sm font-medium text-text-primary tabular-nums">
                  {stats?.current_streak ?? 0}
                </span>
              </div>

              {/* Performance placeholder if no finished instances */}
              {(!stats || (stats.completed + stats.missed === 0)) && (
                <>
                  <div className="border-t border-border-light my-3 pt-3" />
                  <div>
                    <p className="text-xs font-medium text-text-secondary uppercase tracking-wider mb-1">Performance</p>
                    <p className="text-xs text-text-secondary leading-relaxed">
                      No finished instances yet — the track record builds up as scheduled tasks get completed (or missed).
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Schedule entries */}
          <div className="bg-surface border border-border-light rounded-card shadow-card overflow-hidden">

            <div className="flex items-center gap-2 px-4 py-2.5 bg-primary-subtle border-b border-primary-border">
              <span className="w-2 h-2 rounded-full bg-primary" />
              <p className="text-[11px] font-medium text-primary-text uppercase tracking-widest">Schedule</p>
            </div>
            <div className="p-4">
              {entries.length === 0 ? (
                <p className="text-sm text-text-muted">No schedule configured</p>
              ) : (
                <div className="space-y-3">
                  {entries.map((entry, i) => (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-sm font-medium text-text-primary">
                          <RotateCcw size={13} className="text-primary-text shrink-0" />
                          {entryLabel(entry)}
                        </div>
                        {!entry.is_active && (
                          <span className="text-[10px] font-medium text-danger bg-danger-bg border border-danger-border rounded-[999px] px-1.5 py-0.5">Ended</span>
                        )}
                      </div>
                      <div className="text-xs text-text-secondary pl-4 space-y-0.5">
                        <p>From {formatDate(entry.start_date)}</p>
                        {entry.end_condition === 'on_date' && entry.end_date && (
                          <p>Until {formatDate(entry.end_date)}</p>
                        )}
                        {entry.end_condition === 'after_n' && entry.end_after && (
                          <p>After {entry.end_after} occurrences</p>
                        )}
                        <p className="text-text-muted">{entry.occurrence_count} spawned · at {entry.time}</p>
                      </div>
                      {i < entries.length - 1 && <div className="border-t border-border-light mt-2" />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Assignees */}
          {(template.assignee_user_ids?.length ?? 0) > 0 && (
            <div className="bg-surface border border-border-light rounded-card shadow-card overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 bg-success-bg border-b border-success-border">
                <span className="w-2 h-2 rounded-full bg-success" />
                <p className="text-[11px] font-medium text-success uppercase tracking-widest">Assignees</p>
              </div>
              <div className="p-4">
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {template.assignee_user_ids.map((uid) => {
                    const name = userMap.get(uid) ?? uid.slice(0, 8)
                    return (
                      <div key={uid} className="flex items-center gap-2.5">
                        <div className={`w-7 h-7 rounded-full ${avatarColor(name)} flex items-center justify-center text-white text-[10px] font-medium shrink-0`}>
                          {getInitials(name)}
                        </div>
                        <span className="text-sm text-text-primary wrap-break-word">{name}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* CC — informational recipients; hidden when nobody is CC'd */}
          {(template.cc_user_ids?.length ?? 0) > 0 && (
            <div className="bg-surface border border-border-light rounded-card shadow-card overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 bg-primary-subtle border-b border-primary-border">
                <span className="w-2 h-2 rounded-full bg-primary" />
                <p className="text-[11px] font-medium text-primary-text uppercase tracking-widest">CC</p>
              </div>
              <div className="p-4">
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {template.cc_user_ids.map((uid, i) => {
                    // Prefer the server-resolved name — a CC'd person needn't be in the
                    // eligible-assignee list that feeds userMap.
                    const name = template.cc_names?.[i] ?? userMap.get(uid) ?? uid.slice(0, 8)
                    return (
                      <div key={uid} className="flex items-center gap-2.5">
                        <div className={`w-7 h-7 rounded-full ${avatarColor(name)} flex items-center justify-center text-white text-[10px] font-medium shrink-0`}>
                          {getInitials(name)}
                        </div>
                        <span className="text-sm text-text-primary wrap-break-word">{name}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

           {/* Completion Mode */}
           <div className="bg-surface border border-border-light rounded-card shadow-card overflow-hidden">
             <div className="flex items-center gap-2 px-4 py-2.5 bg-warning-bg border-b border-warning-border">
               <span className="w-2 h-2 rounded-full bg-warning" />
               <p className="text-[11px] font-medium text-warning uppercase tracking-widest">Completion Mode</p>
             </div>
             <div className="p-4">
               <p className="text-sm font-medium text-text-primary">
                 {template.completion_mode === 'any_can_complete' ? 'Any assignee can complete' : 'All assignees must complete'}
               </p>
             </div>
           </div>

           {/* Proof Required */}
           <div className="bg-surface border border-border-light rounded-card shadow-card overflow-hidden">
             <div className={`flex items-center gap-2 px-4 py-2.5 border-b ${template.proof_required ? 'bg-danger-bg border-danger-border' : 'bg-success-bg border-success-border'}`}>
               <span className={`w-2 h-2 rounded-full ${template.proof_required ? 'bg-danger' : 'bg-success'}`} />
               <p className={`text-[11px] font-medium uppercase tracking-widest ${template.proof_required ? 'text-danger' : 'text-success'}`}>
                 Proof Required
               </p>
             </div>
             <div className="p-4">
               <p className="text-sm font-medium text-text-primary">
                 {template.proof_required ? `Yes · ${proofTypesLabel}` : 'No'}
               </p>
             </div>
           </div>

           {/* Settings / Details */}
           {(template.category_id || template.priority_id || template.linked_goal_id || escalationIds.length > 0 || (template.tags?.length ?? 0) > 0) && (
             <div className="bg-surface border border-border-light rounded-card shadow-card overflow-hidden">
               <div className="flex items-center gap-2 px-4 py-2.5 bg-surface-sunken border-b border-border-light">
                 <span className="w-2 h-2 rounded-full bg-text-muted" />
                 <p className="text-[11px] font-medium text-text-muted uppercase tracking-widest">Details</p>
               </div>
               <div className="p-4">
                 <div className="space-y-3 text-sm">
                   {escalationIds.length > 0 && (
                     <div className="flex items-start gap-2">
                       <TrendingUp size={14} className="text-text-muted mt-0.5 shrink-0" />
                       <div>
                         <p className="text-text-secondary text-xs mb-0.5">Escalation (when overdue)</p>
                         <div className="space-y-0.5">
                           {escalationIds.map((uid, i) => (
                             <p key={uid} className="text-text-primary font-medium">
                               <span className="text-text-muted font-normal">L{i + 1}</span> {userMap.get(uid) ?? uid.slice(0, 8)}
                             </p>
                           ))}
                         </div>
                       </div>
                     </div>
                   )}
                   {template.linked_goal_id && (
                     <div className="flex items-start gap-2">
                       <Target size={14} className="text-text-muted mt-0.5 shrink-0" />
                       <div>
                         <p className="text-text-secondary text-xs mb-0.5">Linked Goal</p>
                         <p className="text-text-primary font-medium wrap-break-word">{goalTitle ?? 'Loading…'}</p>
                       </div>
                     </div>
                   )}
                   {template.category_id && categories.find((c) => c.id === template.category_id) && (
                     <div className="flex items-center gap-2">
                       <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: categories.find((c) => c.id === template.category_id)?.color }} />
                       <span className="text-sm text-text-primary">{categories.find((c) => c.id === template.category_id)?.name}</span>
                     </div>
                   )}
                   {/* Tags copied onto every new occurrence — read-only here; edit via Edit. */}
                   {(template.tags?.length ?? 0) > 0 && (
                     <div className="flex items-start gap-2">
                       <Tag size={14} className="text-text-muted mt-0.5 shrink-0" />
                       <div className="min-w-0">
                         <p className="text-text-secondary text-xs mb-1">Tags</p>
                         <div className="flex flex-wrap gap-1">
                           {template.tags!.map((t) => (
                             <TagChip key={t.id} tag={t} size="sm" />
                           ))}
                         </div>
                       </div>
                     </div>
                   )}
                   {template.priority_id && priorities.find((p) => p.id === template.priority_id) && (
                     <div className="flex items-center gap-2">
                       <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: priorities.find((p) => p.id === template.priority_id)?.color }} />
                       <span className="text-sm text-text-primary">{priorities.find((p) => p.id === template.priority_id)?.label}</span>
                     </div>
                   )}
                 </div>
               </div>
             </div>
           )}


          {/* Checklist carried onto every instance */}
          {checklistItems.length > 0 && (
            <div className="bg-surface border border-border-light rounded-card shadow-card overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-surface-control border-b border-border-light">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-text-secondary" />
                  <p className="text-[11px] font-medium text-text-secondary uppercase tracking-widest">Checklist</p>
                </div>
                <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-text-secondary text-white text-[11px] font-medium">
                  {checklistItems.length}
                </span>
              </div>
              <div className="p-4">
                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                  {[...checklistItems].sort((a, b) => a.order_index - b.order_index).map((item, i, arr) => {
                    const showHeading = !!item.group_title && (i === 0 || arr[i - 1].group_title !== item.group_title)
                    return (
                      <React.Fragment key={i}>
                        {showHeading && (
                          <p className={`text-[11px] font-medium text-text-muted ${i > 0 ? 'pt-2' : ''}`}>{item.group_title}</p>
                        )}
                        <div className="flex items-start gap-2">
                          <div className="w-3.5 h-3.5 mt-0.5 rounded-xs border border-border shrink-0" />
                          <span className="text-sm text-text-primary">{item.title}</span>
                        </div>
                      </React.Fragment>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Reminders applied to every instance */}
          {reminderSpecs.length > 0 && (
            <div className="bg-surface border border-border-light rounded-card shadow-card overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 bg-danger-bg border-b border-danger-border">
                <span className="w-2 h-2 rounded-full bg-danger" />
                <p className="text-[11px] font-medium text-danger uppercase tracking-widest">Reminders</p>
              </div>
              <div className="p-4">
                <div className="space-y-1.5">
                  {reminderSpecs.map((s, i) => (
                    <p key={i} className="text-sm text-text-primary">{reminderSpecLabel(s)}</p>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Attachments copied onto every instance */}
          {attachments.length > 0 && (
            <div className="bg-surface border border-border-light rounded-card shadow-card overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-surface-control border-b border-border-light">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-text-secondary" />
                  <p className="text-[11px] font-medium text-text-secondary uppercase tracking-widest">Attachments</p>
                </div>
                <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-text-secondary text-white text-[11px] font-medium">
                  {attachments.length}
                </span>
              </div>
              <div className="p-4">
                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                  {attachments.map((a) => (
                    <Tooltip key={a.id} label="Download">
                      <button
                        type="button"
                        onClick={() => tasksApi.downloadRecurringAttachment(orgId, templateId, a.id)}
                        className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-control hover:bg-surface-sunken transition-colors"
                      >
                        <Download size={13} className="text-text-muted shrink-0" />
                        <span className="text-sm text-primary-text truncate">{a.file_name}</span>
                      </button>
                    </Tooltip>
                  ))}
                </div>
                <p className="text-[11px] text-text-muted mt-2">Copied onto every new instance.</p>
              </div>
            </div>
          )}

        </div>
      </div>

      {showEditModal && (
        <EditRecurringModal
          template={template}
          orgId={orgId}
          categories={categories}
          priorities={priorities}
          onClose={() => setShowEditModal(false)}
          onUpdated={() => { setShowEditModal(false); loadData() }}
        />
      )}

      {showManageAccess && (
        <ManageAccessModal orgId={orgId} templateId={template.id} employees={employees} onClose={() => setShowManageAccess(false)} />
      )}
    </div>
  )
}
