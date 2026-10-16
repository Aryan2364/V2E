'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Trash2 } from 'lucide-react'
import { createDepartment, updateDepartment, deleteDepartment } from '@/lib/api/departments'
import { placeUnderParent } from '@/lib/org-chart-layout'
import { BRANCH_PALETTE } from '@/lib/org-chart-colors'
import Button from '@/components/ui/button'
import EmployeePicker from '@/components/ui/EmployeePicker'
import DepartmentSelect from '@/components/employees/DepartmentSelect'
import Tooltip from '@/components/ui/tooltip'
import type { Department, User } from '@/lib/types'

export type DeptFormTarget =
  | { mode: 'create'; parentId?: string }
  | { mode: 'edit'; department: Department }

interface DeptFormDrawerProps {
  target: DeptFormTarget | null
  departments: Department[]
  users: User[]
  orgId: string
  onClose: () => void
  onSaved: (saved: Department) => void
  onDeleted: (id: string) => void
}

const inputCls =
  'w-full rounded-[8px] border border-border bg-white px-3 py-[10px] text-sm text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-2 focus:border-primary transition-colors'
const labelCls = 'text-sm font-medium text-text-secondary mb-1.5 block'

/**
 * Create or edit a department from a right-hand drawer. In edit mode the form is
 * prefilled from the department; new departments are auto-placed under their
 * parent so they don't land on top of the canvas origin.
 */
export default function DeptFormDrawer({
  target,
  departments,
  users,
  orgId,
  onClose,
  onSaved,
  onDeleted,
}: DeptFormDrawerProps) {
  const open = !!target
  const isEdit = target?.mode === 'edit'
  const editing = target?.mode === 'edit' ? target.department : null

  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [parentId, setParentId] = useState('')
  const [headUserId, setHeadUserId] = useState('')
  const [color, setColor] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Hydrate when the target changes.
  useEffect(() => {
    if (!target) return
    if (target.mode === 'edit') {
      setName(target.department.name)
      setDescription(target.department.description ?? '')
      setParentId(target.department.parent_department_id ?? '')
      setHeadUserId(target.department.head_user_id ?? '')
      setColor(target.department.color ?? null)
    } else {
      setName('')
      setDescription('')
      setParentId(target.parentId ?? '')
      setHeadUserId('')
      setColor(null)
    }
    setError(null)
    setConfirmDelete(false)
  }, [target])

  // A department can't be its own parent (or pick a descendant — kept simple here).
  const parentOptions = departments.filter((d) => !editing || d.id !== editing.id)

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Department name is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      let saved: Department
      if (isEdit && editing) {
        saved = await updateDepartment(orgId, editing.id, {
          name: name.trim(),
          description: description.trim() || undefined,
          // Send null (not undefined) so clearing these actually persists —
          // undefined is stripped from the PATCH and Prisma leaves the column
          // untouched, which is why "None (top-level)" appeared to do nothing.
          parent_department_id: parentId || null,
          head_user_id: headUserId || null,
          color, // hex string, or null to clear → inherit branch hue
        })
      } else {
        const { x, y } = placeUnderParent(departments, parentId || undefined)
        saved = await createDepartment(orgId, {
          name: name.trim(),
          description: description.trim() || undefined,
          parent_department_id: parentId || undefined,
          head_user_id: headUserId || undefined,
          color: color ?? undefined,
          position_x: x,
          position_y: y,
        })
      }
      onSaved(saved)
    } catch (err: unknown) {
      const raw = (err as { response?: { data?: { message?: string | string[] } } })?.response
        ?.data?.message
      setError(Array.isArray(raw) ? raw[0] : raw ?? 'Failed to save department.')
    } finally {
      setSaving(false)
    }
  }

  // Only an empty department can be deleted — the backend refuses otherwise, but
  // we gate the UI up front so the option reads as "available when empty".
  const counts = editing?._count
  const blockers: string[] = []
  if (counts) {
    if (counts.child_departments > 0)
      blockers.push(`${counts.child_departments} sub-department${counts.child_departments === 1 ? '' : 's'}`)
    if (counts.employee_profiles > 0)
      blockers.push(`${counts.employee_profiles} employee${counts.employee_profiles === 1 ? '' : 's'}`)
    if (counts.roles > 0)
      blockers.push(`${counts.roles} job role${counts.roles === 1 ? '' : 's'}`)
  }
  const canDelete = blockers.length === 0

  const handleDelete = async () => {
    if (!editing) return
    setDeleting(true)
    setError(null)
    try {
      await deleteDepartment(orgId, editing.id)
      onDeleted(editing.id)
    } catch (err: unknown) {
      const raw = (err as { response?: { data?: { message?: string | string[] } } })?.response
        ?.data?.message
      setError(Array.isArray(raw) ? raw[0] : raw ?? 'Failed to delete department.')
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
        className={`fixed inset-y-0 right-0 z-70 w-full max-w-sm bg-white border-l border-border-light shadow-[-8px_0_32px_rgba(0,0,0,0.08)] flex flex-col transition-transform duration-300 ease-in-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-light">
          <h3 className="font-semibold text-text-primary">
            {isEdit ? 'Edit Department' : 'Add Department'}
          </h3>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-[6px] flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-control transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="px-5 py-5 flex flex-col gap-4">
          <div>
            <label className={labelCls}>Department Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Engineering"
              className={inputCls}
              autoFocus
            />
          </div>
          <div>
            <label className={labelCls}>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Optional description…"
              className="w-full rounded-[8px] border border-border bg-white px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-2 focus:border-primary transition-colors resize-none"
            />
          </div>
          <div>
            <label className={labelCls}>Parent Department</label>
            <DepartmentSelect
              value={parentId}
              onChange={setParentId}
              departments={parentOptions}
              placeholder="None (top-level)"
              allLabel="None (top-level)"
            />
          </div>
          <div>
            <label className={labelCls}>Department Head</label>
            <EmployeePicker
              value={headUserId}
              onChange={setHeadUserId}
              employees={users.map((u) => ({ user_id: u.id, name: u.name }))}
              title="Select Department Head"
              placeholder="No head assigned"
              allowClear
            />
          </div>
          <div>
            <label className={labelCls}>Node Color</label>
            <div className="flex flex-wrap items-center gap-2">
              <Tooltip label="Default (inherit branch color)">
              <button
                type="button"
                onClick={() => setColor(null)}
                className={`h-7 px-2.5 rounded-[7px] text-xs font-medium border transition-colors ${
                  color === null
                    ? 'border-primary bg-primary-subtle text-primary-text'
                    : 'border-border text-text-secondary hover:bg-surface-sunken'
                }`}
              >
                Default
              </button>
              </Tooltip>
              {BRANCH_PALETTE.map((c) => (
                <Tooltip key={c} label={c}>
                <button
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 ${
                    color?.toLowerCase() === c.toLowerCase()
                      ? 'border-[#0F172A] ring-2 ring-offset-1 ring-[#0F172A]/20'
                      : 'border-white shadow-xs'
                  }`}
                  style={{ backgroundColor: c }}
                  aria-label={`Use color ${c}`}
                />
                </Tooltip>
              ))}
            </div>
            <p className="text-xs text-text-muted mt-1.5">
              Default inherits the branch hue (lighter further down the tree).
            </p>
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          </div>

          <div className="px-5 pt-4 pb-12 border-t border-border-light flex flex-col gap-3">
            <div className="flex gap-3">
              <Button variant="primary" isLoading={saving} onClick={handleSave}>
                {isEdit ? 'Save' : 'Add Department'}
              </Button>
              <Button variant="secondary" onClick={onClose} disabled={saving || deleting}>
                Cancel
              </Button>
            </div>

            {isEdit && !confirmDelete && (
              <Tooltip
                label={
                  canDelete
                    ? 'Delete this department'
                    : `Reassign its ${blockers.join(', ')} first`
                }
              >
              <button
                type="button"
                onClick={() => canDelete && setConfirmDelete(true)}
                disabled={!canDelete}
                className={`flex items-center gap-1.5 text-sm font-medium self-start transition-colors ${
                  canDelete
                    ? 'text-danger hover:text-danger'
                    : 'text-text-muted cursor-not-allowed'
                }`}
              >
                <Trash2 size={14} /> Delete department
              </button>
              </Tooltip>
            )}

            {isEdit && !canDelete && (
              <p className="text-xs text-text-muted -mt-1">
                A department with {blockers.join(', ')} can’t be deleted. Reassign or
                remove them first.
              </p>
            )}

            {isEdit && confirmDelete && (
              <div className="rounded-[8px] border border-danger-border bg-danger-bg p-3">
                <p className="text-sm text-danger mb-2.5">
                  Delete <span className="font-semibold">{editing?.name}</span>? This can’t
                  be undone.
                </p>
                <div className="flex gap-2">
                  <Button variant="danger" isLoading={deleting} onClick={handleDelete}>
                    Delete
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}
