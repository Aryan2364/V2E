'use client'

import Tooltip from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { useEffect, useState, useMemo } from 'react'
import { useForm, useFieldArray, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Trash2 } from 'lucide-react'
import { createRole, updateRole, deleteRole } from '@/lib/api/roles'
import DepartmentSelect from '@/components/employees/DepartmentSelect'
import LevelSelect from './LevelSelect'
import type { Department, Role, RoleLevel } from '@/lib/types'
import { Label } from '@/components/ui/label'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { useUnsavedChanges } from '@/components/ui/unsaved-changes'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetBody, SheetFooter } from '@/components/ui/sheet'

export type RoleFormTarget =
  | { mode: 'create'; deptId?: string }
  | { mode: 'edit'; role: Role }

interface RoleFormDrawerProps {
  target: RoleFormTarget | null
  orgId: string
  /**
   * When provided, a Department picker is shown so a role can be created from a
   * page-level "Add Role" (no preselected dept) or moved to another department.
   * Omit it (e.g. the setup wizard) to keep the role scoped to `target.deptId`.
   */
  departments?: Department[]
  roles?: Role[]
  onClose: () => void
  onSaved: (saved: Role) => void
  onDeleted?: (id: string) => void
}

// ─── Schema (mirrors setup wizard step-4) ───────────────────────────────────────

const roleSchema = z.object({
  department_id: z.string().min(1, 'Choose a department for this job role.'),
  title: z.string().min(1, 'Enter a title for the job role.'),
  level: z.enum(['junior', 'mid', 'senior', 'head'] as const),
  job_description: z.string().optional(),
  kra: z.array(z.object({ title: z.string(), description: z.string() })).default([]),
  kpi: z
    .array(z.object({ title: z.string(), metric: z.string(), target: z.string(), unit: z.string() }))
    .default([]),
})

type RoleFormValues = z.infer<typeof roleSchema>

// ─── Shared styles ──────────────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-lg border border-border bg-surface px-3 py-[10px] text-body text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-2 focus:border-primary transition-colors'
const smInputCls =
  'w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-body text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-2 focus:border-primary transition-colors'
const textareaCls =
  'w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-body text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-2 focus:border-primary transition-colors resize-none'
const labelCls = 'text-body font-medium text-text-secondary mb-1.5 block'
const fieldLabelCls = 'text-meta font-medium text-text-muted mb-1 block'

const EMPTY: RoleFormValues = {
  department_id: '',
  title: '',
  level: 'mid',
  job_description: '',
  kra: [],
  kpi: [],
}

/**
 * Create or edit a role from a right-hand drawer, mirroring DeptFormDrawer.
 * In edit mode the form is prefilled from the role and a Delete action appears.
 */
export default function RoleFormDrawer({
  target,
  orgId,
  departments,
  roles,
  onClose,
  onSaved,
  onDeleted,
}: RoleFormDrawerProps) {
  const open = !!target
  const isEdit = target?.mode === 'edit'
  const editing = target?.mode === 'edit' ? target.role : null

  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const [formError, setFormError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<RoleFormValues>({
    shouldFocusError: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(roleSchema) as any,
    defaultValues: EMPTY,
  })

  // Leaving with unsaved changes asks first, in the create or edit words (kit 11.3 rule 10).
  const unsaved = useUnsavedChanges({ changed: open && isDirty && !isSubmitting, noun: 'job role', mode: isEdit ? 'edit' : 'create' })
  function requestClose() {
    unsaved.guard((next) => { if (!next) onClose() })(false)
  }

  const kraArray = useFieldArray({ control, name: 'kra' })
  const kpiArray = useFieldArray({ control, name: 'kpi' })

  const chosenDeptId = watch('department_id') || (target?.mode === 'create' ? target.deptId : target?.role?.department_id) || ''
  const showHead = useMemo(() => {
    if (!roles || !chosenDeptId) return true
    const existingHeadRole = roles.find(
      (r) => r.department_id === chosenDeptId && r.level === 'head',
    )
    if (!existingHeadRole) return true
    if (isEdit && editing && editing.id === existingHeadRole.id) return true
    return false
  }, [roles, chosenDeptId, isEdit, editing])

  // Hydrate when the target changes.
  useEffect(() => {
    if (!target) return
    setFormError(null)
    setConfirmDelete(false)
    if (target.mode === 'edit') {
      const r = target.role
      reset({
        department_id: r.department_id,
        title: r.title,
        level: r.level,
        job_description: r.job_description ?? '',
        kra: r.kra ?? [],
        kpi: r.kpi ?? [],
      })
    } else {
      reset({ ...EMPTY, department_id: target.deptId ?? '' })
    }
  }, [target, reset, departments])

  const onSubmit = async (data: RoleFormValues) => {
    setFormError(null)
    const payload = {
      title: data.title.trim(),
      level: data.level,
      job_description: data.job_description?.trim() || undefined,
      kra: (data.kra ?? [])
        .filter((k) => k.title.trim() || k.description.trim())
        .map((k) => ({ title: k.title.trim(), description: k.description.trim() })),
      kpi: (data.kpi ?? [])
        .filter((k) => k.title.trim() || k.metric.trim() || k.target.trim() || k.unit.trim())
        .map((k) => ({
          title: k.title.trim(),
          metric: k.metric.trim(),
          target: k.target.trim(),
          unit: k.unit.trim(),
        })),
    }
    // The picker governs the department when `departments` is provided; otherwise
    // a created role stays scoped to the dept it was launched from.
    const pickedDept = data.department_id || undefined
    try {
      let saved: Role
      if (isEdit && editing) {
        saved = await updateRole(orgId, editing.id, {
          ...payload,
          ...(departments && pickedDept ? { department_id: pickedDept } : {}),
        })
      } else if (target?.mode === 'create') {
        const department_id = pickedDept ?? target.deptId
        if (!department_id) {
          setFormError('Choose a department for this job role.')
          return
        }
        saved = await createRole(orgId, { ...payload, department_id })
      } else {
        return
      }
      onSaved(saved)
    } catch (err: unknown) {
      const raw = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
        ?.message
      setFormError(Array.isArray(raw) ? raw[0] : raw ?? 'Could not save the job role. Try again.')
    }
  }

  const handleDelete = async () => {
    if (!editing) return
    setDeleting(true)
    setFormError(null)
    try {
      await deleteRole(orgId, editing.id)
      onDeleted?.(editing.id)
    } catch (err: unknown) {
      const raw = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
        ?.message
      setFormError(Array.isArray(raw) ? raw[0] : raw ?? 'Could not delete the job role. Try again.')
      setConfirmDelete(false)
    } finally {
      setDeleting(false)
    }
  }

  if (!mounted) return null

  return (
    <>
      {unsaved.warning}
      <Sheet open={open} onOpenChange={(next) => { if (!next) requestClose() }}>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>{isEdit ? 'Edit job role' : 'Add job role'}</SheetTitle>
          </SheetHeader>
          <SheetBody>
        <form id="role-form" onSubmit={handleSubmit(onSubmit)}>
          <div className="flex flex-col gap-4">
            {/* Department picker (page-level create / move) */}
            {departments && departments.length > 0 && (
              <div>
                <Label className="mb-2" required>Department</Label>
                <Controller
                  control={control}
                  name="department_id"
                  render={({ field }) => (
                    <DepartmentSelect
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      departments={departments}
                    />
                  )}
                />
                <InlineFieldError>{errors.department_id?.message}</InlineFieldError>
              </div>
            )}

            {/* Basic info */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="mb-2" htmlFor="role-title" required>Job role title</Label>
                <input
                  id="role-title"
                  {...register('title')}
                  placeholder="For example, Senior engineer"
                  aria-invalid={errors.title ? true : undefined}
                  className={`${inputCls} aria-invalid:border-danger`}
                  autoFocus
                />
                <InlineFieldError>{errors.title?.message}</InlineFieldError>
              </div>
              <div>
                <Label className="mb-2" required>Level</Label>
                <Controller
                  control={control}
                  name="level"
                  render={({ field }) => (
                    <LevelSelect
                      value={field.value}
                      onChange={field.onChange}
                      showHead={showHead}
                    />
                  )}
                />
              </div>
            </div>

            <div>
              <Label className="mb-2">Job description</Label>
              <textarea
                {...register('job_description')}
                rows={4}
                placeholder="For example, Owns delivery of the dealer onboarding programme"
                className={textareaCls}
              />
            </div>

            {/* KRA builder */}
            <div className="bg-surface-sunken border border-border-light rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-body font-medium text-text-primary">Key result areas (KRA)</h4>
                <Button
                  type="button"
                  onClick={() => kraArray.append({ title: '', description: '' })}
                  variant="secondary"
                  size="sm"
                >
                  <Plus size={13} /> Add KRA
                </Button>
              </div>
              <div className="flex flex-col gap-3">
                {kraArray.fields.length === 0 && (
                  <p className="text-meta text-text-muted text-center py-3">No KRAs added yet.</p>
                )}
                {kraArray.fields.map((field, i) => (
                  <div
                    key={field.id}
                    className="bg-surface border border-border-light rounded-lg p-3 flex gap-3"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-meta font-medium text-primary-text">
                      {i + 1}
                    </span>
                    <div className="flex-1 flex flex-col gap-2">
                      <input
                        {...register(`kra.${i}.title`)}
                        aria-label="KRA title" placeholder="For example, Code quality"
                        className={inputCls}
                      />
                      <textarea
                        {...register(`kra.${i}.description`)}
                        rows={2}
                        aria-label="KRA description" placeholder="For example, Fewer than 2 bugs per release"
                        className={textareaCls}
                      />
                    </div>
                    <Tooltip label="Remove KRA">
                      <Button
                        type="button"
                        onClick={() => kraArray.remove(i)}
                        aria-label="Remove KRA"
                        variant="ghost"
                        size="icon"
                      >
                        <Trash2 size={14} />
                      </Button>
                    </Tooltip>
                  </div>
                ))}
              </div>
            </div>

            {/* KPI builder */}
            <div className="bg-surface-sunken border border-border-light rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-body font-medium text-text-primary">Key performance indicators (KPI)</h4>
                <Button
                  type="button"
                  onClick={() => kpiArray.append({ title: '', metric: '', target: '', unit: '' })}
                  variant="secondary"
                  size="sm"
                >
                  <Plus size={13} /> Add KPI
                </Button>
              </div>
              <div className="flex flex-col gap-3">
                {kpiArray.fields.length === 0 && (
                  <p className="text-meta text-text-muted text-center py-3">No KPIs added yet.</p>
                )}
                {kpiArray.fields.map((field, i) => (
                  <div
                    key={field.id}
                    className="bg-surface border border-border-light rounded-lg p-3 flex gap-3"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-meta font-medium text-primary-text">
                      {i + 1}
                    </span>
                    <div className="flex-1 flex flex-col gap-2.5">
                      <div>
                        <Label className="mb-1">Indicator</Label>
                        <input
                          {...register(`kpi.${i}.title`)}
                          placeholder="e.g. On-time delivery"
                          className={smInputCls}
                        />
                      </div>
                      <div>
                        <Label className="mb-1">Measured by</Label>
                        <input
                          {...register(`kpi.${i}.metric`)}
                          placeholder="e.g. Sprints shipped on schedule"
                          className={smInputCls}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="mb-1">Target</Label>
                          <input
                            {...register(`kpi.${i}.target`)}
                            placeholder="e.g. 95"
                            className={smInputCls}
                          />
                        </div>
                        <div>
                          <Label className="mb-1">Unit</Label>
                          <input
                            {...register(`kpi.${i}.unit`)}
                            placeholder="e.g. %, count, hrs"
                            className={smInputCls}
                          />
                        </div>
                      </div>
                    </div>
                    <Tooltip label="Remove KPI">
                      <Button
                        type="button"
                        onClick={() => kpiArray.remove(i)}
                        aria-label="Remove KPI"
                        variant="ghost"
                        size="icon"
                      >
                        <Trash2 size={14} />
                      </Button>
                    </Tooltip>
                  </div>
                ))}
              </div>
            </div>

            {formError && (
              <p className="text-body text-danger rounded-lg bg-danger-bg border border-danger-border px-4 py-3">
                {formError}
              </p>
            )}

            {/* Delete (edit mode) */}
            {isEdit && (
              <div className="border-t border-border-light pt-4">
                {confirmDelete ? (
                  <div className="flex items-center gap-3">
                    <p className="text-body text-text-secondary flex-1">Delete this job role permanently?</p>
                    <Button variant="danger" size="sm" loading={deleting} onClick={handleDelete}>
                      Confirm delete
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmDelete(false)}
                      disabled={deleting}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button type="button" onClick={() => setConfirmDelete(true)} variant="danger" size="sm">
                    <Trash2 size={14} /> Delete job role
                  </Button>
                )}
              </div>
            )}
          </div>

        </form>
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="secondary" onClick={requestClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" form="role-form" loading={isSubmitting} loadingLabel="Saving">
              {isEdit ? 'Save job role' : 'Add job role'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  )
}
