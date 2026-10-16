'use client'

import { useEffect, useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useForm, useFieldArray, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X, Plus, Trash2 } from 'lucide-react'
import { createRole, updateRole, deleteRole } from '@/lib/api/roles'
import Button from '@/components/ui/button'
import DepartmentSelect from '@/components/employees/DepartmentSelect'
import LevelSelect from './LevelSelect'
import type { Department, Role, RoleLevel } from '@/lib/types'

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
  department_id: z.string().min(1, 'Please choose a department for this job role.'),
  title: z.string().min(1, 'Job role title is required'),
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
  'w-full rounded-[8px] border border-border bg-white px-3 py-[10px] text-sm text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-2 focus:border-primary transition-colors'
const smInputCls =
  'w-full rounded-[8px] border border-border bg-white px-2.5 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-2 focus:border-primary transition-colors'
const textareaCls =
  'w-full rounded-[8px] border border-border bg-white px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-2 focus:border-primary transition-colors resize-none'
const labelCls = 'text-sm font-medium text-text-secondary mb-1.5 block'
const fieldLabelCls = 'text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-1 block'

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
    formState: { errors, isSubmitting },
  } = useForm<RoleFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(roleSchema) as any,
    defaultValues: EMPTY,
  })

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
          setFormError('Please choose a department for this job role.')
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
      setFormError(Array.isArray(raw) ? raw[0] : raw ?? 'Failed to save job role.')
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
      setFormError(Array.isArray(raw) ? raw[0] : raw ?? 'Failed to delete job role.')
      setConfirmDelete(false)
    } finally {
      setDeleting(false)
    }
  }

  if (!mounted) return null

  return createPortal(
    <>
      {open && <div className="fixed inset-0 bg-black/20 z-60" onClick={onClose} />}

      <div
        className={`fixed inset-y-0 right-0 z-70 w-full max-w-lg bg-white border-l border-border-light shadow-[-8px_0_32px_rgba(0,0,0,0.08)] flex flex-col transition-transform duration-300 ease-in-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-light">
          <h3 className="font-semibold text-text-primary">{isEdit ? 'Edit Job Role' : 'Add Job Role'}</h3>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-[6px] flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-control transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex-1 overflow-y-auto min-h-0"
        >
          <div className="px-5 py-5 flex flex-col gap-5">
            {/* Department picker (page-level create / move) */}
            {departments && departments.length > 0 && (
              <div>
                <label className={labelCls}>Department *</label>
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
                {errors.department_id && (
                  <p className="text-xs text-danger mt-1">{errors.department_id.message}</p>
                )}
              </div>
            )}

            {/* Basic info */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Job Role Title *</label>
                <input
                  {...register('title')}
                  placeholder="e.g. Senior Engineer"
                  className={inputCls}
                  autoFocus
                />
                {errors.title && (
                  <p className="text-xs text-danger mt-1">{errors.title.message}</p>
                )}
              </div>
              <div>
                <label className={labelCls}>Level *</label>
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
              <label className={labelCls}>Job Description</label>
              <textarea
                {...register('job_description')}
                rows={4}
                placeholder="Describe the role's responsibilities, scope, and expected outcomes…"
                className={textareaCls}
              />
            </div>

            {/* KRA builder */}
            <div className="bg-surface-sunken border border-border-light rounded-[10px] p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold text-text-primary">Key Result Areas (KRA)</h4>
                <button
                  type="button"
                  onClick={() => kraArray.append({ title: '', description: '' })}
                  className="inline-flex items-center gap-1 text-xs text-primary-text font-medium hover:text-primary-text"
                >
                  <Plus size={13} /> Add KRA
                </button>
              </div>
              <div className="flex flex-col gap-3">
                {kraArray.fields.length === 0 && (
                  <p className="text-xs text-text-muted text-center py-3">No KRAs added yet.</p>
                )}
                {kraArray.fields.map((field, i) => (
                  <div
                    key={field.id}
                    className="bg-white border border-border-light rounded-[8px] p-3 flex gap-3"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-xs font-bold text-primary-text">
                      {i + 1}
                    </span>
                    <div className="flex-1 flex flex-col gap-2">
                      <input
                        {...register(`kra.${i}.title`)}
                        placeholder="KRA title — e.g. Code quality"
                        className={inputCls}
                      />
                      <textarea
                        {...register(`kra.${i}.description`)}
                        rows={2}
                        placeholder="What does success in this area look like?"
                        className={textareaCls}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => kraArray.remove(i)}
                      className="text-text-muted hover:text-danger self-start p-1 rounded-xs transition-colors"
                      aria-label="Remove KRA"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* KPI builder */}
            <div className="bg-surface-sunken border border-border-light rounded-[10px] p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold text-text-primary">Key Performance Indicators (KPI)</h4>
                <button
                  type="button"
                  onClick={() => kpiArray.append({ title: '', metric: '', target: '', unit: '' })}
                  className="inline-flex items-center gap-1 text-xs text-primary-text font-medium hover:text-primary-text"
                >
                  <Plus size={13} /> Add KPI
                </button>
              </div>
              <div className="flex flex-col gap-3">
                {kpiArray.fields.length === 0 && (
                  <p className="text-xs text-text-muted text-center py-3">No KPIs added yet.</p>
                )}
                {kpiArray.fields.map((field, i) => (
                  <div
                    key={field.id}
                    className="bg-white border border-border-light rounded-[8px] p-3 flex gap-3"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-xs font-bold text-primary-text">
                      {i + 1}
                    </span>
                    <div className="flex-1 flex flex-col gap-2.5">
                      <div>
                        <label className={fieldLabelCls}>Indicator</label>
                        <input
                          {...register(`kpi.${i}.title`)}
                          placeholder="e.g. On-time delivery"
                          className={smInputCls}
                        />
                      </div>
                      <div>
                        <label className={fieldLabelCls}>Measured by</label>
                        <input
                          {...register(`kpi.${i}.metric`)}
                          placeholder="e.g. Sprints shipped on schedule"
                          className={smInputCls}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className={fieldLabelCls}>Target</label>
                          <input
                            {...register(`kpi.${i}.target`)}
                            placeholder="e.g. 95"
                            className={smInputCls}
                          />
                        </div>
                        <div>
                          <label className={fieldLabelCls}>Unit</label>
                          <input
                            {...register(`kpi.${i}.unit`)}
                            placeholder="e.g. %, count, hrs"
                            className={smInputCls}
                          />
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => kpiArray.remove(i)}
                      className="text-text-muted hover:text-danger self-start p-1 rounded-xs transition-colors"
                      aria-label="Remove KPI"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {formError && (
              <p className="text-sm text-danger rounded-[8px] bg-danger-bg border border-danger-border px-4 py-3">
                {formError}
              </p>
            )}

            {/* Delete (edit mode) */}
            {isEdit && (
              <div className="border-t border-border-light pt-4">
                {confirmDelete ? (
                  <div className="flex items-center gap-3">
                    <p className="text-sm text-text-secondary flex-1">Delete this job role permanently?</p>
                    <Button variant="danger" size="sm" isLoading={deleting} onClick={handleDelete}>
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
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="inline-flex items-center gap-1.5 text-sm text-danger font-medium hover:text-danger transition-colors"
                  >
                    <Trash2 size={14} /> Delete job role
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="px-5 pt-4 pb-12 border-t border-border-light flex gap-3">
            <Button type="submit" variant="primary" isLoading={isSubmitting}>
              {isEdit ? 'Save' : 'Add Job Role'}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </>,
    document.body,
  )
}
