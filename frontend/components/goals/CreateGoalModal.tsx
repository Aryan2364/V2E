'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { Button } from '@/components/ui/button'
import { MultiSelect } from '@/components/ui/multi-select'
import { useToast } from '@/components/ui/Toast'
import { usePermissions } from '@/lib/auth/use-permissions'
import { goalsApi } from '@/lib/api/goals'
import { projectsApi } from '@/lib/api/projects'
import { STATUS_META, type Goal, type GoalFocusArea } from '@/lib/types/goals'
import type { Project } from '@/lib/types/projects'
import GoalFormFields, {
  labelClass,
  type EmployeeOption,
  GOAL_FIELD_ID,
  type GoalFormErrors,
  type GoalFormState,
} from './GoalFormFields'
import QuickCreateProjectModal from './QuickCreateProjectModal'
import { formatDate } from './shared'
import { Label } from '@/components/ui/label'
import { useGuardedClose } from '@/lib/use-guarded-close'
import Tooltip from '@/components/ui/tooltip'

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
  const [errors, setErrors] = useState<GoalFormErrors>({})

  // Selections + the pools they pick from.
  const [supportingIds, setSupportingIds] = useState<string[]>([])
  const [projectIds, setProjectIds] = useState<string[]>([])
  const [goalOptions, setGoalOptions] = useState<Goal[]>([])
  const [projectOptions, setProjectOptions] = useState<Project[]>([])

  const guarded = useGuardedClose({
    open: isOpen,
    values: { form, supportingIds, projectIds },
    noun: 'goal',
    onClose,
  })

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

  const patch = (p: Partial<GoalFormState>) => {
    setForm((f) => ({ ...f, ...p }))
    setErrors((e) => {
      const next = { ...e }
      for (const k of Object.keys(p)) delete next[k as keyof GoalFormErrors]
      return next
    })
  }

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

    const errs: GoalFormErrors = {}
    if (!form.title.trim()) errs.title = 'Enter a title for the goal.'
    if (!form.ownerUserId) errs.ownerUserId = 'Choose the one person accountable for this goal.'
    if (!form.dueDate) errs.dueDate = 'Choose a deadline for the goal.'
    if (form.cadence !== 'none' && !form.checkInDate) errs.checkInDate = 'Choose when the first check-in is due.'
    const target = form.targetValue.trim()
    if (target && isNaN(parseFloat(target.replace(/,/g, '')))) errs.targetValue = 'Enter the target as a number, like 50.'
    setErrors(errs)
    const firstBad = (Object.keys(GOAL_FIELD_ID) as (keyof GoalFormErrors)[]).find((k) => errs[k])
    if (firstBad) {
      requestAnimationFrame(() => {
        const el = document.getElementById(GOAL_FIELD_ID[firstBad])
        ;(el?.matches('input,textarea,button') ? el : el?.querySelector<HTMLElement>('input,button'))?.focus()
      })
      return
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
      addToast(err?.response?.data?.message ?? 'Could not create the goal. Try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {guarded.warning}
      <Modal isOpen={isOpen} onClose={() => !saving && guarded.requestClose()} title="New goal" size="lg">
        <form onSubmit={handleSubmit}>
          <GoalFormFields
            state={form}
            onChange={patch}
            employees={employees}
            disabled={saving}
            errors={errors}
          />

          {allowLinking && (
            <div className="mt-4 pt-4 border-t border-border-light space-y-4">
              <FieldWithAdd
                label="Supporting goals"
                hint="Goals that have to land for this one to happen. Pick any that already exist, or create one."
                addLabel="New supporting goal"
                onAdd={() => setNewGoalOpen(true)}
                disabled={saving}
              >
                <MultiSelect
                  value={supportingIds}
                  onValueChange={setSupportingIds}
                  disabled={saving}
                  placeholder="No supporting goals"
                  searchPlaceholder="Search goals…"
                  emptyMessage="No other goals yet — create the first one with +."
                  options={Object.fromEntries(
                    goalOptions.map((g) => [
                      g.id,
                      {
                        label: g.title,
                        hint: `${g.owner?.name ?? '—'} · due ${formatDate(g.due_date)}`,
                        color: STATUS_META[g.status]?.dot,
                      },
                    ]),
                  )}
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
                    onValueChange={setProjectIds}
                    disabled={saving}
                    placeholder="No projects"
                    searchPlaceholder="Search projects…"
                    emptyMessage="No projects yet — create one with +."
                    options={Object.fromEntries(
                      projectOptions.map((p) => [
                        p.id,
                        { label: p.name, hint: p.end_date ? `ends ${formatDate(p.end_date)}` : undefined },
                      ]),
                    )}
                  />
                </FieldWithAdd>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-border-light">
            <Button type="button" variant="secondary" onClick={guarded.requestClose} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving} loading={saving} loadingLabel="Creating">
              Create goal
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
      <Label className="mb-2">{label}</Label>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">{children}</div>
        <Tooltip label={addLabel}>
          <Button type="button" variant="secondary" size="icon" onClick={onAdd} disabled={disabled} aria-label={addLabel} className="shrink-0">
            <Plus size={18} />
          </Button>
        </Tooltip>
      </div>
      <p className="text-meta text-text-secondary mt-1">{hint}</p>
    </div>
  )
}
