'use client'

import { useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/button'
import DatePicker from '@/components/ui/DatePicker'
import EmployeePicker from '@/components/ui/EmployeePicker'
import { useToast } from '@/components/ui/Toast'
import { tasksApi } from '@/lib/api/tasks'
import { Label } from '@/components/ui/label'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { useGuardedClose } from '@/lib/use-guarded-close'

const inputClass =
  'w-full border border-border rounded-control px-3 py-2 text-body text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary'
const labelClass = 'block text-label font-medium text-text-secondary mb-1'

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
  const [fieldErrors, setFieldErrors] = useState<{ title?: string; assignee?: string }>({})
  const guarded = useGuardedClose({ open: isOpen, values: { title, assignee, deadline }, noun: 'task', onClose })

  useEffect(() => {
    if (isOpen) {
      setTitle('')
      setAssignee('')
      setDeadline('')
    }
  }, [isOpen])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !assignee) {
      setFieldErrors({
        title: title.trim() ? undefined : 'Enter a title for the task.',
        assignee: assignee ? undefined : 'Choose the person who will do the task.',
      })
      requestAnimationFrame(() => {
        const el = document.getElementById(title.trim() ? 'goal-task-assignee' : 'goal-task-title')
        ;(el?.matches('input,textarea,button') ? el : el?.querySelector<HTMLElement>('input,button'))?.focus()
      })
      return
    }
    setFieldErrors({})

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
      addToast(err?.response?.data?.message ?? 'Could not add the task. Try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
    {guarded.warning}
    <Modal isOpen={isOpen} onClose={guarded.requestClose} title="Add a task to this goal" size="md">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <p className="text-label text-text-secondary -mt-1">
          This creates a real task in the Tasks module, linked to this goal.
        </p>
        <div>
          <Label className="mb-2" htmlFor="goal-task-title" required>Task title</Label>
          <input id="goal-task-title" className={`${inputClass} aria-invalid:border-danger`} aria-invalid={fieldErrors.title ? true : undefined} value={title} onChange={(e) => { setTitle(e.target.value); setFieldErrors((p) => (p.title ? { ...p, title: undefined } : p)) }} placeholder="For example, Call the top 10 dealers" autoFocus />
          <InlineFieldError>{fieldErrors.title}</InlineFieldError>
        </div>
        <div>
          <Label className="mb-2" required>Assignee</Label>
          <div id="goal-task-assignee">
          <EmployeePicker
            value={assignee}
            onChange={(v) => { setAssignee(v); setFieldErrors((p) => (p.assignee ? { ...p, assignee: undefined } : p)) }}
            employees={employees}
            title="Select assignee"
            placeholder="Select assignee"
          />
          </div>
          <InlineFieldError>{fieldErrors.assignee}</InlineFieldError>
        </div>
        <div>
          <Label className="mb-2">Deadline</Label>
          <DatePicker value={deadline} onChange={setDeadline} placeholder="Select date" />
        </div>
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-light">
          <Button variant="secondary" type="button" onClick={guarded.requestClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" isLoading={saving} disabled={saving}>
            Add task
          </Button>
        </div>
      </form>
    </Modal>
    </>
  )
}
