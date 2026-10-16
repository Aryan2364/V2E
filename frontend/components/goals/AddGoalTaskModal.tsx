'use client'

import { useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/button'
import DatePicker from '@/components/ui/DatePicker'
import EmployeePicker from '@/components/ui/EmployeePicker'
import { useToast } from '@/components/ui/Toast'
import { tasksApi } from '@/lib/api/tasks'

const inputClass =
  'w-full border border-border rounded-control px-3 py-2 text-body text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary'
const labelClass = 'block text-sm font-medium text-text-secondary mb-1'

interface Props {
  isOpen: boolean
  onClose: () => void
  orgId: string
  goalId: string
  employees: { user_id: string; name: string; role_title?: string | null; department_name?: string | null }[]
  onCreated: () => void
}

/**
 * Reuses the existing Task module — creates a task linked to this goal via
 * goal_id. Keeps fields minimal (title, who does it, deadline); full task
 * editing happens in the Tasks module. Goals are flat, so any goal can carry
 * work directly.
 */
export default function AddGoalTaskModal({ isOpen, onClose, orgId, goalId, employees, onCreated }: Props) {
  const { addToast } = useToast()
  const [title, setTitle] = useState('')
  const [assignee, setAssignee] = useState('')
  const [deadline, setDeadline] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setTitle('')
      setAssignee('')
      setDeadline('')
    }
  }, [isOpen])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return addToast('Task title is required', 'error')
    if (!assignee) return addToast('An executor (assignee) is required', 'error')

    setSaving(true)
    try {
      await tasksApi.createTask(orgId, {
        title: title.trim(),
        assignee_user_ids: [assignee],
        deadline: deadline ? new Date(deadline).toISOString() : undefined,
        goal_id: goalId,
      })
      addToast('Task added', 'success')
      onCreated()
      onClose()
    } catch (err: any) {
      addToast(err?.response?.data?.message ?? 'Could not add the task', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add a task to this goal" size="md">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <p className="text-sm text-text-secondary -mt-1">
          This creates a real task in the Tasks module, linked to this goal.
        </p>
        <div>
          <label className={labelClass}>Task title *</label>
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs to be done?" autoFocus />
        </div>
        <div>
          <label className={labelClass}>Executor (assignee) *</label>
          <EmployeePicker
            value={assignee}
            onChange={setAssignee}
            employees={employees}
            title="Select Executor"
            placeholder="Select executor…"
          />
        </div>
        <div>
          <label className={labelClass}>Deadline</label>
          <DatePicker value={deadline} onChange={setDeadline} placeholder="Select date" />
        </div>
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-light">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" isLoading={saving} disabled={saving}>
            Add task
          </Button>
        </div>
      </form>
    </Modal>
  )
}
