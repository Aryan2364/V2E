'use client'

import { useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'
import { Button } from '@/components/ui/button'
import DatePicker from '@/components/ui/DatePicker'
import EmployeePicker from '@/components/ui/EmployeePicker'
import { useToast } from '@/components/ui/Toast'
import { projectsApi } from '@/lib/api/projects'
import type { Project } from '@/lib/types/projects'
import { inputClass, labelClass, type EmployeeOption } from './GoalFormFields'
import { Label } from '@/components/ui/label'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { useGuardedClose } from '@/lib/use-guarded-close'

/**
 * Create a project without leaving the goal form.
 *
 * Deliberately the bare minimum the Projects API requires (name + manager,
 * with optional dates) — the full three-step wizard, with members, budget and
 * templates, still lives in Work. This exists so someone writing a goal can
 * name the project it needs and carry on, instead of losing the half-filled
 * form to go and create it elsewhere.
 */
export default function QuickCreateProjectModal({
  isOpen,
  onClose,
  orgId,
  employees,
  defaultManagerId,
  onCreated,
}: {
  isOpen: boolean
  onClose: () => void
  orgId: string
  employees: EmployeeOption[]
  defaultManagerId?: string
  onCreated: (project: Project) => void
}) {
  const { addToast } = useToast()
  const [name, setName] = useState('')
  const [managerId, setManagerId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; manager?: string; end?: string }>({})
  const guarded = useGuardedClose({ open: isOpen, values: { name, managerId, startDate, endDate }, noun: 'project', onClose })
  const clearErr = (k: 'name' | 'manager' | 'end') => setFieldErrors((p) => (p[k] ? { ...p, [k]: undefined } : p))

  useEffect(() => {
    if (!isOpen) return
    setName('')
    setManagerId(defaultManagerId ?? '')
    setStartDate('')
    setEndDate('')
  }, [isOpen, defaultManagerId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs = {
      name: name.trim() ? undefined : 'Enter a name for the project.',
      manager: managerId ? undefined : 'Choose who runs the project.',
      end: startDate && endDate && endDate < startDate ? 'Choose an end date on or after the start date.' : undefined,
    }
    if (errs.name || errs.manager || errs.end) {
      setFieldErrors(errs)
      const id = errs.name ? 'quick-project-name' : errs.manager ? 'quick-project-manager' : 'quick-project-end'
      requestAnimationFrame(() => {
        const el = document.getElementById(id)
        ;(el?.matches('input,textarea,button') ? el : el?.querySelector<HTMLElement>('input,button'))?.focus()
      })
      return
    }
    setFieldErrors({})

    setSaving(true)
    try {
      const project = await projectsApi.create(orgId, {
        name: name.trim(),
        project_manager_user_id: managerId,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      })
      addToast('Project created', 'success')
      onCreated(project)
      onClose()
    } catch (err: any) {
      addToast(err?.response?.data?.message ?? 'Could not create the project. Try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
    {guarded.warning}
    <Modal
      isOpen={isOpen}
      onClose={() => !saving && guarded.requestClose()}
      title="New project"
      size="md"
      elevated
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label className="mb-2" htmlFor="quick-project-name" required>Project name</Label>
          <input
            id="quick-project-name"
            className={`${inputClass} aria-invalid:border-danger`}
            aria-invalid={fieldErrors.name ? true : undefined}
            value={name}
            onChange={(e) => { setName(e.target.value); clearErr('name') }}
            placeholder="For example, Appoint 40 South-West dealers"
            disabled={saving}
            autoFocus
          />
          <InlineFieldError>{fieldErrors.name}</InlineFieldError>
        </div>

        <div>
          <Label className="mb-2" required>Project manager</Label>
          <div id="quick-project-manager">
          <EmployeePicker
            employees={employees}
            value={managerId}
            onChange={(v) => { setManagerId(v); clearErr('manager') }}
            placeholder="Select project manager"
            disabled={saving}
          />
          </div>
          <InlineFieldError>{fieldErrors.manager}</InlineFieldError>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label className="mb-2">Start date</Label>
            <DatePicker
              value={startDate}
              onChange={setStartDate}
              placeholder="Select date"
              disabled={saving}
            />
          </div>
          <div>
            <Label className="mb-2" htmlFor="quick-project-end">End date</Label>
            <DatePicker
              id="quick-project-end"
              invalid={!!fieldErrors.end}
              value={endDate}
              onChange={(v) => { setEndDate(v); clearErr('end') }}
              min={startDate || undefined}
              placeholder="Select date"
              disabled={saving}
            />
            <InlineFieldError>{fieldErrors.end}</InlineFieldError>
          </div>
        </div>

        <p className="text-meta text-text-secondary">
          Members, budget and milestones are set up in Work once the project exists. It’ll be linked
          to this goal automatically.
        </p>

        <div className="flex justify-end gap-2 pt-4 border-t border-border-light">
          <Button type="button" variant="secondary" onClick={guarded.requestClose} disabled={saving}>Cancel</Button>
          <Button type="submit" disabled={saving} loading={saving} loadingLabel="Creating">
            Create and link project
          </Button>
        </div>
      </form>
    </Modal>
    </>
  )
}
