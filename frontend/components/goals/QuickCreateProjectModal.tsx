'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import DatePicker from '@/components/ui/DatePicker'
import EmployeePicker from '@/components/ui/EmployeePicker'
import { useToast } from '@/components/ui/Toast'
import { projectsApi } from '@/lib/api/projects'
import type { Project } from '@/lib/types/projects'
import { inputClass, labelClass, type EmployeeOption } from './GoalFormFields'

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

  useEffect(() => {
    if (!isOpen) return
    setName('')
    setManagerId(defaultManagerId ?? '')
    setStartDate('')
    setEndDate('')
  }, [isOpen, defaultManagerId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return addToast('Give the project a name', 'error')
    if (!managerId) return addToast('Every project needs a manager', 'error')
    if (startDate && endDate && endDate < startDate) {
      return addToast('The end date is before the start date', 'error')
    }

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
      addToast(err?.response?.data?.message ?? 'Could not create the project', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => !saving && onClose()}
      title="New project"
      size="md"
      elevated
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className={labelClass}>Project name *</label>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Appoint 40 South-West dealers"
            disabled={saving}
            autoFocus
          />
        </div>

        <div>
          <label className={labelClass}>Project manager *</label>
          <EmployeePicker
            employees={employees}
            value={managerId}
            onChange={setManagerId}
            placeholder="Who runs this project?"
            disabled={saving}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Start date</label>
            <DatePicker
              value={startDate}
              onChange={setStartDate}
              placeholder="Optional"
              disabled={saving}
            />
          </div>
          <div>
            <label className={labelClass}>End date</label>
            <DatePicker
              value={endDate}
              onChange={setEndDate}
              min={startDate || undefined}
              placeholder="Optional"
              disabled={saving}
            />
          </div>
        </div>

        <p className="text-[12px] text-text-secondary">
          Members, budget and milestones are set up in Work once the project exists. It’ll be linked
          to this goal automatically.
        </p>

        <div className="flex justify-end pt-4 border-t border-border-light">
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 size={15} className="animate-spin mr-1.5" />}
            {saving ? 'Creating…' : 'Create & link'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
