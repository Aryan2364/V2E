'use client'

import { useEffect, useState } from 'react'
import { Trash2Icon } from 'lucide-react'
import { createDepartment, updateDepartment, deleteDepartment } from '@/lib/api/departments'
import { placeUnderParent } from '@/lib/org-chart-layout'
import { BRANCH_PALETTE } from '@/lib/org-chart-colors'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import EmployeePicker from '@/components/ui/EmployeePicker'
import DepartmentSelect from '@/components/employees/DepartmentSelect'
import Tooltip from '@/components/ui/tooltip'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
  SheetFooter,
} from '@/components/ui/sheet'
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

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>{isEdit ? 'Edit Department' : 'Add Department'}</SheetTitle>
        </SheetHeader>

        <SheetBody className="flex flex-col gap-6">
          <div>
            <Label htmlFor="dept-name" required>
              Department Name
            </Label>
            <Input
              id="dept-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Engineering"
              className="mt-2 max-w-none"
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="dept-description">Description</Label>
            <Textarea
              id="dept-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Optional description…"
              className="mt-2"
            />
          </div>
          <div>
            <Label>Parent Department</Label>
            <div className="mt-2">
              <DepartmentSelect
                value={parentId}
                onChange={setParentId}
                departments={parentOptions}
                placeholder="None (top-level)"
                allLabel="None (top-level)"
              />
            </div>
          </div>
          <div>
            <Label>Department Head</Label>
            <div className="mt-2">
              <EmployeePicker
                value={headUserId}
                onChange={setHeadUserId}
                employees={users.map((u) => ({ user_id: u.id, name: u.name }))}
                title="Select Department Head"
                placeholder="No head assigned"
                allowClear
              />
            </div>
          </div>
          <div>
            <Label>Node Color</Label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Tooltip label="Default (inherit branch color)">
              <button
                type="button"
                onClick={() => setColor(null)}
                className={`h-8 rounded-lg border px-3 text-label font-medium transition-colors ${
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
                  className={`size-8 rounded-full border-2 transition-transform hover:scale-110 ${
                    color?.toLowerCase() === c.toLowerCase()
                      ? 'border-text-primary ring-2 ring-offset-1 ring-primary-ring'
                      : 'border-surface shadow-xs'
                  }`}
                  style={{ backgroundColor: c }}
                  aria-label={`Use color ${c}`}
                />
                </Tooltip>
              ))}
            </div>
            <p className="mt-2 text-label text-text-muted">
              Default inherits the branch hue (lighter further down the tree).
            </p>
          </div>
          {error && <p className="text-label text-danger">{error}</p>}

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
              className={`flex items-center gap-1 self-start text-body font-medium transition-colors ${
                canDelete
                  ? 'text-danger hover:text-danger'
                  : 'cursor-not-allowed text-text-muted'
              }`}
            >
              <Trash2Icon size={14} /> Delete department
            </button>
            </Tooltip>
          )}

          {isEdit && !canDelete && (
            <p className="text-label text-text-muted">
              A department with {blockers.join(', ')} can’t be deleted. Reassign or
              remove them first.
            </p>
          )}

          {isEdit && confirmDelete && (
            <div className="rounded-lg border border-danger-border bg-danger-bg p-3">
              <p className="mb-3 text-body text-danger">
                Delete <span className="font-medium">{editing?.name}</span>? This can’t
                be undone.
              </p>
              <div className="flex gap-2">
                <Button variant="danger" loading={deleting} loadingLabel="Deleting" onClick={handleDelete}>
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
        </SheetBody>

        <SheetFooter>
          <Button variant="secondary" onClick={onClose} disabled={saving || deleting}>
            Cancel
          </Button>
          <Button loading={saving} loadingLabel="Saving" onClick={handleSave}>
            {isEdit ? 'Save' : 'Add Department'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
