'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import MultiSelect from '@/components/ui/MultiSelect'
import { useToast } from '@/components/ui/Toast'
import { usePermissions } from '@/lib/auth/use-permissions'
import { goalsApi } from '@/lib/api/goals'
import { projectsApi } from '@/lib/api/projects'
import { STATUS_META, type Goal, type GoalFocusArea } from '@/lib/types/goals'
import type { Project } from '@/lib/types/projects'
import GoalFormFields, {
  labelClass,
  type EmployeeOption,
  type GoalFormState,
} from './GoalFormFields'
import QuickCreateProjectModal from './QuickCreateProjectModal'
import { formatDate } from './shared'

const EMPTY: GoalFormState = {
  title: '',
  description: '',
  ownerUserId: '',
  focusArea: '',
  dueDate: '',
  targetValue: '',
  unit: '',
  cadence: 'monthly',
  checkInDate: '',
  status: 'not_started',
}

interface Props {
  isOpen: boolean
  onClose: () => void
  orgId: string
  employees: EmployeeOption[]
  onCreated: (goal: Goal) => void
  /** Pre-fills the owner (e.g. the current user creating their own goal). */
  defaultOwnerId?: string
  /** Pre-fills the focus area (e.g. opened from a Balance Scorecard quadrant). */
  defaultFocusArea?: GoalFocusArea
  /**
   * Whether this form offers the supporting-goal and project pickers. False for
   * the nested "new supporting goal" form opened FROM those pickers — otherwise
   * the form would recurse into itself forever.
   */
  allowLinking?: boolean
}

/**
 * New goal.
 *
 * Supporting goals and projects are chosen right here, and either can be
 * created inline: the quick-create opens ON TOP of this form (never replacing
 * it), and on save the new item is selected automatically. Everything typed so
 * far survives, because this component stays mounted the whole time.
 *
 * Links are written AFTER the goal exists — a goal has no id to link to until
 * it's saved — so the submit is: create the goal, then attach.
 */
export default function CreateGoalModal({
  isOpen,
  onClose,
  orgId,
  employees,
  onCreated,
  defaultOwnerId,
  defaultFocusArea,
  allowLinking = true,
}: Props) {
  const { addToast } = useToast()
  const { can, isAdmin } = usePermissions()
  // Same combined gate the backend uses: /permissions/me already folds the org's
  // entitlement ceiling into each leaf, so this is entitlement ∩ permission.
  const canSeeProjects = isAdmin || can('projects.project.manage', 'read')

  const [form, setForm] = useState<GoalFormState>(EMPTY)
  const [saving, setSaving] = useState(false)

  // Selections + the pools they pick from.
  const [supportingIds, setSupportingIds] = useState<string[]>([])
  const [projectIds, setProjectIds] = useState<string[]>([])
  const [goalOptions, setGoalOptions] = useState<Goal[]>([])
  const [projectOptions, setProjectOptions] = useState<Project[]>([])

  // Nested quick-creates.
  const [newGoalOpen, setNewGoalOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)

  const loadPools = useCallback(() => {
    if (!orgId || !allowLinking) return
    goalsApi
      .list(orgId)
      .then(setGoalOptions)
      .catch(() => setGoalOptions([]))
    if (canSeeProjects) {
      projectsApi
        .list(orgId)
        // Every project is a candidate: one project can serve several goals, so
        // being on another goal doesn't take it out of the running.
        .then(setProjectOptions)
        .catch(() => setProjectOptions([]))
    }
  }, [orgId, allowLinking, canSeeProjects])

  // Reset only when the form is (re)opened — NOT when a nested modal opens, so
  // half-typed input is never lost behind a quick-create.
  useEffect(() => {
    if (!isOpen) return
    setForm({ ...EMPTY, ownerUserId: defaultOwnerId ?? '', focusArea: defaultFocusArea ?? '' })
    setSupportingIds([])
    setProjectIds([])
    loadPools()
  }, [isOpen, defaultOwnerId, defaultFocusArea, loadPools])

  const patch = (p: Partial<GoalFormState>) => setForm((f) => ({ ...f, ...p }))

  /** A freshly created supporting goal joins the pool and is selected. */
  function handleGoalCreated(goal: Goal) {
    setGoalOptions((prev) => [goal, ...prev.filter((g) => g.id !== goal.id)])
    setSupportingIds((prev) => (prev.includes(goal.id) ? prev : [...prev, goal.id]))
  }

  function handleProjectCreated(project: Project) {
    setProjectOptions((prev) => [project, ...prev.filter((p) => p.id !== project.id)])
    setProjectIds((prev) => (prev.includes(project.id) ? prev : [...prev, project.id]))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) return addToast('Give the goal a title', 'error')
    if (!form.ownerUserId) return addToast('Every goal needs one accountable owner', 'error')
    if (!form.dueDate) return addToast('Set a deadline', 'error')
    if (form.cadence !== 'none' && !form.checkInDate) {
      return addToast('Pick when the first check-in is due', 'error')
    }

    const target = form.targetValue.trim()
    if (target && isNaN(parseFloat(target.replace(/,/g, '')))) {
      return addToast('The target must be a number', 'error')
    }

    setSaving(true)
    try {
      const goal = await goalsApi.create(orgId, {
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        owner_user_id: form.ownerUserId,
        focus_area: form.focusArea || undefined,
        due_date: new Date(`${form.dueDate}T00:00:00`).toISOString(),
        target_value: target ? parseFloat(target.replace(/,/g, '')) : undefined,
        unit: form.unit.trim() || undefined,
        review_cadence: form.cadence,
        first_check_in_date:
          form.cadence !== 'none' && form.checkInDate
            ? new Date(`${form.checkInDate}T00:00:00`).toISOString()
            : undefined,
      })

      // Attach afterwards — the goal needs an id first. A failure here must not
      // discard the goal that was just created, so failures are counted and
      // reported rather than thrown.
      let failed = 0
      await Promise.all([
        ...supportingIds.map((id) =>
          goalsApi.createLink(orgId, goal.id, { supporting_goal_id: id }).catch(() => {
            failed += 1
          }),
        ),
        ...projectIds.map((id) =>
          goalsApi.linkProject(orgId, goal.id, id).catch(() => {
            failed += 1
          }),
        ),
      ])

      if (failed > 0) {
        addToast(
          `Goal created, but ${failed} link${failed === 1 ? '' : 's'} didn’t attach — add ${
            failed === 1 ? 'it' : 'them'
          } from the goal’s page.`,
          'warning',
        )
      } else {
        addToast('Goal created', 'success')
      }
      onCreated(goal)
      onClose()
    } catch (err: any) {
      addToast(err?.response?.data?.message ?? 'Could not create the goal', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Modal isOpen={isOpen} onClose={() => !saving && onClose()} title="New goal" size="lg">
        <form onSubmit={handleSubmit}>
          <GoalFormFields
            state={form}
            onChange={patch}
            employees={employees}
            disabled={saving}
          />

          {allowLinking && (
            <div className="mt-5 pt-5 border-t border-[#E2E8F0] space-y-4">
              <FieldWithAdd
                label="Supporting goals"
                hint="Goals that have to land for this one to happen. Pick any that already exist, or create one."
                addLabel="New supporting goal"
                onAdd={() => setNewGoalOpen(true)}
                disabled={saving}
              >
                <MultiSelect
                  value={supportingIds}
                  onChange={setSupportingIds}
                  disabled={saving}
                  placeholder="No supporting goals"
                  searchPlaceholder="Search goals…"
                  emptyText="No other goals yet — create the first one with +."
                  options={goalOptions.map((g) => ({
                    value: g.id,
                    label: g.title,
                    hint: `${g.owner?.name ?? '—'} · due ${formatDate(g.due_date)}`,
                    color: STATUS_META[g.status]?.dot,
                  }))}
                />
              </FieldWithAdd>

              {canSeeProjects && (
                <FieldWithAdd
                  label="Projects"
                  hint="Bigger bodies of work behind this goal. A project can serve several goals, so linking it here won't take it off any others."
                  addLabel="New project"
                  onAdd={() => setNewProjectOpen(true)}
                  disabled={saving}
                >
                  <MultiSelect
                    value={projectIds}
                    onChange={setProjectIds}
                    disabled={saving}
                    placeholder="No projects"
                    searchPlaceholder="Search projects…"
                    emptyText="No projects yet — create one with +."
                    options={projectOptions.map((p) => ({
                      value: p.id,
                      label: p.name,
                      hint: p.end_date ? `ends ${formatDate(p.end_date)}` : undefined,
                    }))}
                  />
                </FieldWithAdd>
              )}
            </div>
          )}

          {/* Header X is the dismiss, so the footer carries only the primary action. */}
          <div className="flex justify-end pt-5 mt-5 border-t border-[#E2E8F0]">
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 size={15} className="animate-spin mr-1.5" />}
              {saving ? 'Creating…' : 'Create goal'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Nested quick-creates. `allowLinking={false}` stops the goal form from
          offering these same pickers again and recursing into itself. */}
      {allowLinking && (
        <CreateGoalModal
          isOpen={newGoalOpen}
          onClose={() => setNewGoalOpen(false)}
          orgId={orgId}
          employees={employees}
          defaultOwnerId={defaultOwnerId}
          allowLinking={false}
          onCreated={handleGoalCreated}
        />
      )}

      {allowLinking && canSeeProjects && (
        <QuickCreateProjectModal
          isOpen={newProjectOpen}
          onClose={() => setNewProjectOpen(false)}
          orgId={orgId}
          employees={employees}
          defaultManagerId={defaultOwnerId}
          onCreated={handleProjectCreated}
        />
      )}
    </>
  )
}

/** A form field with its own Add action — solid blue +, sat next to what it controls. */
function FieldWithAdd({
  label,
  hint,
  addLabel,
  onAdd,
  disabled,
  children,
}: {
  label: string
  hint: string
  addLabel: string
  onAdd: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">{children}</div>
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled}
          title={addLabel}
          aria-label={addLabel}
          className="shrink-0 w-[42px] h-[42px] rounded-[8px] bg-[#2563EB] hover:bg-[#1D4ED8] disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] text-white flex items-center justify-center transition-colors"
        >
          <Plus size={18} />
        </button>
      </div>
      <p className="text-[11px] text-[#475569] mt-1">{hint}</p>
    </div>
  )
}
