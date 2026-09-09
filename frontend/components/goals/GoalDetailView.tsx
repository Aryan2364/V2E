'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  History,
  Loader2,
  Pencil,
  Plus,
  Repeat,
  Target,
  User,
} from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import AccessHiddenState from '@/components/ui/AccessHiddenState'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { goalsApi } from '@/lib/api/goals'
import {
  CADENCE_META,
  STATUS_META,
  formatValue,
  type Goal,
  type GoalDeleteImpact,
  type GoalStatus,
} from '@/lib/types/goals'
import CheckInHistory from './CheckInHistory'
import CheckInModal from './CheckInModal'
import EditGoalModal from './EditGoalModal'
import GoalTrajectory from './GoalTrajectory'
import SupportGoalsSection from './SupportGoalsSection'
import GoalProjectsSection from './GoalProjectsSection'
import AddGoalTaskModal from './AddGoalTaskModal'
import {
  CountBadge,
  DAYS_TONE,
  EmptyState,
  FocusAreaBadge,
  GoalStatusPicker,
  daysLeftLabel,
  formatDate,
  PermissionsUnavailable,
  useGoalPermissions,
  useGoalRefData,
} from './shared'

export default function GoalDetailView({ goalId }: { goalId: string }) {
  const { user } = useAuth()
  const router = useRouter()
  const { addToast } = useToast()
  const orgId = user?.organizationId ?? ''
  const {
    perms,
    loading: permsLoading,
    failed: permsFailed,
    retry: retryPerms,
  } = useGoalPermissions(orgId)
  const { employees } = useGoalRefData(orgId)

  const [goal, setGoal] = useState<Goal | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [checkInOpen, setCheckInOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [taskOpen, setTaskOpen] = useState(false)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [impact, setImpact] = useState<GoalDeleteImpact | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId || !goalId) return
    try {
      setGoal(await goalsApi.get(orgId, goalId))
      setNotFound(false)
    } catch {
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }, [orgId, goalId])

  useEffect(() => {
    void load()
  }, [load])

  // Status is changed straight from the header badge — the same values the edit
  // form offers, without making someone open a form to move a goal on hold.
  // The row is patched in place from the server's reply, so nothing re-mounts
  // and nothing flickers.
  async function changeStatus(next: GoalStatus) {
    try {
      const updated = await goalsApi.update(orgId, goalId, { status: next })
      setGoal((prev) => (prev ? { ...prev, ...updated } : updated))
      addToast(`Status set to ${STATUS_META[next].label}`, 'success')
    } catch (err: any) {
      addToast(err?.response?.data?.message ?? 'Could not change the status', 'error')
    }
  }

  async function openDelete() {
    setDeleteError(null)
    setDeleteOpen(true)
    // Load what the delete would sever so the confirm names the damage.
    setImpact(await goalsApi.deleteImpact(orgId, goalId).catch(() => null))
  }

  async function confirmDelete() {
    setDeleting(true)
    setDeleteError(null)
    try {
      await goalsApi.remove(orgId, goalId)
      addToast('Goal deleted', 'success')
      router.push('/goals')
    } catch (err: any) {
      setDeleteError(err?.response?.data?.message ?? 'Could not delete the goal')
      setDeleting(false)
    }
  }

  // A failed lookup is not a denial — offer a retry instead of claiming the
  // role lacks access.
  if (permsFailed) return <PermissionsUnavailable onRetry={retryPerms} />

  if (!permsLoading && !perms.read) {
    return <AccessHiddenState orgId={orgId} leaf="goals" moduleLabel="Goals" />
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[#475569] py-16 justify-center">
        <Loader2 size={16} className="animate-spin" /> Loading goal…
      </div>
    )
  }

  if (notFound || !goal) {
    return (
      <EmptyState
        icon={<Target size={26} />}
        title="Goal not found"
        subtitle="It may have been deleted."
        action={
          <Link href="/goals" className="mt-1 text-sm font-semibold text-[#2563EB] hover:text-[#1D4ED8]">
            Back to goals
          </Link>
        }
      />
    )
  }

  // The server decides this: false when the org isn't licensed for Projects OR
  // this person has no Projects permission. Either way the section is invisible
  // — including its "hidden projects" note, which would itself reveal that
  // projects exist here.
  const hasProjects = goal.projects_visible !== false
  const days = daysLeftLabel(goal.days_left)
  const isClosed = goal.status === 'achieved' || goal.status === 'closed'
  const checkIns = goal.check_ins ?? []
  const tasks = goal.tasks ?? []
  const openTasks = tasks.filter((t: any) => t.status && !isTerminalStatus(t.status)).length

  const deleteMessage = (() => {
    const parts: string[] = []
    if (impact?.supported_by_count) parts.push(`${impact.supported_by_count} supporting`)
    if (impact?.supports_count) parts.push(`${impact.supports_count} it supports`)
    const links = parts.length ? `It is linked to ${parts.join(' and ')} — those connections go with it. ` : ''
    const t = impact?.open_task_count
      ? `${impact.open_task_count} open task${impact.open_task_count === 1 ? '' : 's'} stay in the Tasks module but lose their goal link. `
      : ''
    const pr = impact?.project_count
      ? `${impact.project_count} linked project${impact.project_count === 1 ? '' : 's'} stay in Work but lose their goal link. `
      : ''
    const c = impact?.check_in_count
      ? `Its ${impact.check_in_count} check-in${impact.check_in_count === 1 ? '' : 's'} will no longer be visible.`
      : ''
    return (
      `${links}${t}${pr}${c}`.trim() ||
      'This goal has no links, tasks, projects or check-ins.'
    )
  })()

  return (
    <div className="space-y-6">
      {/* Sticky header: back + title + the actions, always reachable */}
      <div className="sticky top-0 z-20 bg-[#F8FAFC] -mt-2 pt-2 pb-4 border-b border-[#E2E8F0]">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[#475569] hover:text-[#0F172A] transition-colors mb-3"
        >
          <ArrowLeft size={15} /> Back
        </button>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <h1 className="text-[26px] font-bold text-[#0F172A] leading-tight">{goal.title}</h1>
            <div className="flex items-center gap-2.5 flex-wrap mt-2">
              <GoalStatusPicker status={goal.status} canEdit={perms.edit} onSelect={changeStatus} />
              <FocusAreaBadge focus={goal.focus_area} />
              <span className={`text-[13px] font-medium ${isClosed ? 'text-[#475569]' : DAYS_TONE[days.tone]}`}>
                {isClosed ? formatDate(goal.due_date) : days.text}
              </span>
            </div>
          </div>

          {/* Related actions grouped on one row, primary carrying the weight */}
          <div className="flex items-center gap-2 shrink-0">
            {perms.edit && !isClosed && (
              <button
                onClick={() => setCheckInOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-[8px] bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-semibold transition-colors"
              >
                <CheckCircle2 size={16} /> Check in
              </button>
            )}
            {perms.edit && (
              <button
                onClick={() => setEditOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-[8px] bg-white border-2 border-[#2563EB] text-[#2563EB] hover:bg-[#EFF6FF] text-sm font-semibold transition-colors"
              >
                <Pencil size={15} /> Edit
              </button>
            )}
          </div>
        </div>
      </div>

      {goal.description && (
        <p className="text-[15px] text-[#1E293B] leading-relaxed whitespace-pre-wrap max-w-3xl">
          {goal.description}
        </p>
      )}

      {/* Facts + the number */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <section className="lg:col-span-2 bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] p-5">
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <div>
              <p className="text-[13px] font-medium text-[#475569]">The number</p>
              {goal.target_value === null || goal.target_value === undefined ? (
                <p className="text-[15px] text-[#1E293B] mt-1">
                  Not measured by a number — check-ins are the traffic light and the note.
                </p>
              ) : (
                <p className="mt-1">
                  <span className="text-[30px] font-bold text-[#0F172A] tabular-nums leading-none">
                    {goal.current_value === null || goal.current_value === undefined
                      ? '—'
                      : goal.current_value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-[15px] text-[#475569] ml-2">
                    of {formatValue(goal.target_value, goal.unit)}
                  </span>
                </p>
              )}
            </div>
            <p className="text-[12px] text-[#475569] max-w-[230px]">
              Typed in by {goal.owner?.name ?? 'the owner'} at each check-in. Nothing here is
              calculated or pulled from another goal.
            </p>
          </div>

          <div className="mt-5 pt-4 border-t border-[#F1F5F9]">
            <GoalTrajectory goal={goal} checkIns={checkIns} />
          </div>
        </section>

        <section className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] p-5 space-y-3.5">
          <Meta icon={<User size={15} />} label="Owner" value={goal.owner?.name ?? '—'} />
          <Meta icon={<CalendarDays size={15} />} label="Deadline" value={formatDate(goal.due_date)} />
          <Meta
            icon={<Repeat size={15} />}
            label="Check-in rhythm"
            value={CADENCE_META[goal.review_cadence].label}
          />
          <Meta
            icon={<History size={15} />}
            label="Last check-in"
            value={goal.last_check_in_at ? formatDate(goal.last_check_in_at) : 'Never'}
          />
          <Meta
            icon={<CalendarDays size={15} />}
            label="Next check-in due"
            value={goal.next_review_date ? formatDate(goal.next_review_date) : 'No rhythm set'}
          />
        </section>
      </div>

      {/* The web — both directions, editable from here */}
      <div>
        <h2 className="text-[18px] font-semibold text-[#0F172A] mb-3">Support goals</h2>
        <SupportGoalsSection
          orgId={orgId}
          goal={goal}
          employees={employees}
          canEdit={perms.edit}
          onChanged={load}
        />
      </div>

      {/* The work behind the goal: day-to-day tasks, and projects when the firm
          has that module. Peers, so they sit on one row and read the same. */}
      <div className={hasProjects ? 'grid grid-cols-1 xl:grid-cols-2 gap-5 items-start' : ''}>
      <section className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] flex flex-col max-h-[420px]">
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[#F1F5F9] shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="flex items-center gap-2 text-[16px] font-semibold text-[#0F172A]">
                <ClipboardList size={16} className="text-[#475569]" /> Tasks
              </h2>
              <CountBadge count={tasks.length} />
            </div>
            <p className="text-[12px] text-[#475569] mt-0.5">
              {tasks.length === 0
                ? 'The work that moves this goal.'
                : `${openTasks} open · ${tasks.length - openTasks} done`}
            </p>
          </div>
          {perms.edit && (
            <button
              onClick={() => setTaskOpen(true)}
              aria-label="Add task"
              title="Add a task to this goal"
              className="w-7 h-7 shrink-0 rounded-[8px] bg-[#2563EB] hover:bg-[#1D4ED8] text-white flex items-center justify-center transition-colors"
            >
              <Plus size={16} />
            </button>
          )}
        </header>
        <div className="table-scroll flex-1 overflow-y-auto px-5 py-3">
          {tasks.length === 0 ? (
            <p className="text-[13px] text-[#475569] py-4">
              No tasks yet. Attach the actual work so this goal isn’t just a number on a screen.
            </p>
          ) : (
            <ul className="divide-y divide-[#F1F5F9]">
              {tasks.map((t: any) => (
                <li key={t.id}>
                  <Link
                    href={`/dashboard/tasks/${t.id}`}
                    className="flex items-center justify-between gap-3 py-2.5 group"
                  >
                    <span className="text-[14px] text-[#0F172A] group-hover:text-[#2563EB] transition-colors truncate">
                      {t.title}
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      {t.deadline && (
                        <span className="text-[12px] text-[#475569]">{formatDate(t.deadline)}</span>
                      )}
                      {t.status?.label && (
                        <span
                          className="text-[11px] font-medium rounded-full px-2 py-0.5 border whitespace-nowrap"
                          style={{
                            backgroundColor: '#F8FAFC',
                            borderColor: '#E2E8F0',
                            color: t.status.color ?? '#475569',
                          }}
                        >
                          {t.status.label}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {hasProjects && (
        <GoalProjectsSection
          orgId={orgId}
          goal={goal}
          canEdit={perms.edit}
          onChanged={load}
        />
      )}
      </div>

      {/* The record */}
      <section className="bg-white border border-[#E2E8F0] rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] p-5">
        <div className="flex items-center gap-2 mb-1">
          <h2 className="flex items-center gap-2 text-[16px] font-semibold text-[#0F172A]">
            <History size={16} className="text-[#475569]" /> Check-in history
          </h2>
          <CountBadge count={checkIns.filter((c) => !c.is_voided).length} />
        </div>
        <p className="text-[12px] text-[#475569] mb-4">
          The dated record, oldest at the bottom. Rows are never edited or deleted.
        </p>
        <CheckInHistory
          orgId={orgId}
          goal={goal}
          checkIns={checkIns}
          canEdit={perms.edit}
          onChanged={load}
        />
      </section>

      {/* ─── Modals ─────────────────────────────────────────────────────────── */}
      <CheckInModal
        isOpen={checkInOpen}
        onClose={() => setCheckInOpen(false)}
        orgId={orgId}
        goal={goal}
        onDone={load}
      />

      {editOpen && (
        <EditGoalModal
          isOpen
          onClose={() => setEditOpen(false)}
          orgId={orgId}
          goal={goal}
          employees={employees}
          onSaved={load}
          canDelete={perms.delete}
          onRequestDelete={() => {
            setEditOpen(false)
            void openDelete()
          }}
        />
      )}

      <AddGoalTaskModal
        isOpen={taskOpen}
        onClose={() => setTaskOpen(false)}
        orgId={orgId}
        goalId={goal.id}
        employees={employees}
        onCreated={load}
      />

      <ConfirmDialog
        open={deleteOpen}
        title={`Delete “${goal.title}”?`}
        message={deleteMessage}
        confirmLabel="Delete goal"
        danger
        loading={deleting}
        error={deleteError}
        onConfirm={confirmDelete}
        onCancel={() => {
          setDeleteOpen(false)
          setDeleteError(null)
        }}
      />
    </div>
  )
}

function Meta({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="text-[#94A3B8] mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-[12px] text-[#475569]">{label}</p>
        <p className="text-[14px] font-medium text-[#0F172A] truncate">{value}</p>
      </div>
    </div>
  )
}

/** Mirrors the Tasks module's terminal status types. */
function isTerminalStatus(status: { type?: string }): boolean {
  return ['completed', 'partially_completed', 'incomplete'].includes(status.type ?? '')
}
