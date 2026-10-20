'use client'

import React, { useState } from 'react'
import DatePicker from '@/components/ui/DatePicker'
import TimeField from '@/components/ui/TimeField'
import AssigneeSelector from '@/components/tasks/AssigneeSelector'
import ScheduleEntryList from '@/components/tasks/ScheduleEntryList'
import type { ScheduleEntryDraft } from '@/components/tasks/ScheduleEntryRow'
import type { SelectedAssignee } from '@/lib/types/tasks'
import { workLogApi } from '@/lib/api/workLogs'
import type { CreateDemandPayload } from '@/lib/types/workLogs'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { useGuardedClose } from '@/lib/use-guarded-close'

interface Props {
  orgId: string
  onClose: () => void
  onCreated: () => void
}

function defaultSchedule(): ScheduleEntryDraft {
  return {
    schedule_type: 'weekly',
    every: 1,
    days: [5], // Friday — matches the brief's "every Friday" example
    month_days: [],
    yearly_dates: [],
    time: '09:00',
    start_date: new Date().toISOString().slice(0, 10),
    end_condition: 'never',
    end_date: '',
    end_after: 10,
  }
}

export default function DemandModal({ orgId, onClose, onCreated }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assignees, setAssignees] = useState<SelectedAssignee[]>([])
  const [kind, setKind] = useState<'one_time' | 'recurring'>('one_time')
  const [deadlineDate, setDeadlineDate] = useState('')
  const [deadlineTime, setDeadlineTime] = useState('')
  // Combine local date+time into an ISO instant. No time → end of day (23:59).
  const deadline = deadlineDate
    ? new Date(deadlineTime ? `${deadlineDate}T${deadlineTime}` : `${deadlineDate}T23:59`).toISOString()
    : ''
  const [schedules, setSchedules] = useState<ScheduleEntryDraft[]>([defaultSchedule()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{ title?: string; assignee?: string; deadline?: string }>({})
  const clearErr = (k: 'title' | 'assignee' | 'deadline') => setFieldErrors((p) => (p[k] ? { ...p, [k]: undefined } : p))
  const guarded = useGuardedClose({
    open: true,
    values: { title, description, assignees, kind, deadlineDate, deadlineTime, schedules },
    noun: 'log request',
    onClose,
  })

  const assignee = assignees[0]

  function handleAssigneeChange(next: SelectedAssignee[]) {
    // A demand has exactly one writer — keep only the most recently added.
    setAssignees(next.length ? [{ ...next[next.length - 1], is_cc: false }] : [])
  }

  async function submit() {
    setError(null)
    const errs = {
      title: title.trim() ? undefined : 'Enter a title for the log.',
      assignee: assignee ? undefined : 'Choose who must write this log.',
      deadline: kind === 'one_time' && !deadline ? 'Choose a deadline date.' : undefined,
    }
    if (errs.title || errs.assignee || errs.deadline) {
      setFieldErrors(errs)
      const id = errs.title ? 'demand-title' : errs.assignee ? 'demand-assignee' : 'demand-deadline'
      requestAnimationFrame(() => {
        const el = document.getElementById(id)
        ;(el?.matches('input,textarea,button') ? el : el?.querySelector<HTMLElement>('input,button'))?.focus()
      })
      return
    }
    setFieldErrors({})

    const payload: CreateDemandPayload = {
      title: title.trim(),
      description: description.trim() || undefined,
      assignee_user_id: assignee.user_id,
      kind,
      ...(kind === 'one_time'
        ? { deadline }
        : {
            schedule_entries: schedules.map((s, i) => ({
              schedule_type: s.schedule_type,
              every: s.every,
              days: s.days,
              month_days: s.month_days,
              yearly_dates: s.yearly_dates,
              time: s.time,
              start_date: new Date(s.start_date).toISOString(),
              end_condition: s.end_condition,
              ...(s.end_condition === 'on_date' && s.end_date && { end_date: new Date(s.end_date).toISOString() }),
              ...(s.end_condition === 'after_n' && { end_after: s.end_after }),
              order_index: i,
            })),
          }),
    }

    setSaving(true)
    try {
      await workLogApi.createDemand(orgId, payload)
      onCreated()
      onClose()
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Could not send the log request. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
    {guarded.warning}
    <Dialog open onOpenChange={(next) => { if (!next) guarded.requestClose() }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Demand a log</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-4">
            <div>
              <Label className="mb-2" htmlFor="demand-title" required>Title</Label>
              <Input id="demand-title" value={title} onChange={(e) => { setTitle(e.target.value); clearErr('title') }} aria-invalid={fieldErrors.title ? true : undefined} placeholder="For example, Update on outstanding amount" />
              <InlineFieldError>{fieldErrors.title}</InlineFieldError>
            </div>

            <div>
              <Label className="mb-2">Description</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </div>

            <div>
              <Label className="mb-2" required>Who must write this log</Label>
              <div id="demand-assignee">
              <AssigneeSelector orgId={orgId} value={assignees} onChange={(v) => { handleAssigneeChange(v); clearErr('assignee') }} />
              </div>
              <InlineFieldError>{fieldErrors.assignee}</InlineFieldError>
              <p className="text-meta text-text-muted mt-1">Must be someone below you in the hierarchy.</p>
            </div>

            {/* Kind */}
            <div>
              <Label className="mb-2">Frequency</Label>
              <div className="flex items-center border border-border-light rounded-lg p-0.5 gap-0.5 w-fit">
                {(['one_time', 'recurring'] as const).map((k) => (
                  <Button
                    key={k}
                    type="button"
                    size="sm"
                    variant={kind === k ? 'primary' : 'ghost'}
                    onClick={() => setKind(k)}
                  >
                    {k === 'one_time' ? 'One-time' : 'Recurring'}
                  </Button>
                ))}
              </div>
            </div>

            {kind === 'one_time' ? (
              <div>
                <Label className="mb-2" htmlFor="demand-deadline" required>Deadline</Label>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <DatePicker
                      id="demand-deadline"
                      invalid={!!fieldErrors.deadline}
                      value={deadlineDate}
                      onChange={(iso) => {
                        clearErr('deadline')
                        if (!iso) { setDeadlineDate(''); setDeadlineTime(''); return }
                        setDeadlineDate(iso)
                        if (!deadlineTime) setDeadlineTime('23:59')
                      }}
                      placeholder="Select date"
                    />
                  </div>
                  {/* Time — always present, disabled until a date is picked */}
                  <div className="flex-1">
                    <TimeField
                      value={deadlineTime}
                      onChange={setDeadlineTime}
                      disabled={!deadlineDate}
                      label="Deadline time"
                    />
                  </div>
                </div>
                <InlineFieldError>{fieldErrors.deadline}</InlineFieldError>
              </div>
            ) : (
              <div>
                <Label className="mb-2" required>Recurrence</Label>
                <ScheduleEntryList entries={schedules} onChange={setSchedules} />
              </div>
            )}

            {error && <p role="alert" className="text-label text-danger">{error}</p>}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={guarded.requestClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving} loadingLabel="Creating">
            Send log request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}
