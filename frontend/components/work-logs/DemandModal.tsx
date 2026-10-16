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

  const assignee = assignees[0]

  function handleAssigneeChange(next: SelectedAssignee[]) {
    // A demand has exactly one writer — keep only the most recently added.
    setAssignees(next.length ? [{ ...next[next.length - 1], is_cc: false }] : [])
  }

  async function submit() {
    setError(null)
    if (!title.trim()) return setError('Give the log a title.')
    if (!assignee) return setError('Pick who must write this log.')
    if (kind === 'one_time' && !deadline) return setError('Set a deadline.')

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
      setError(e?.response?.data?.message ?? 'Could not create the demand.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Demand a log</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-4">
            <div>
              <Label className="mb-1.5">Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Update on outstanding amount" />
            </div>

            <div>
              <Label className="mb-1.5">Description (optional)</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </div>

            <div>
              <Label className="mb-1.5">Who must write this log</Label>
              <AssigneeSelector orgId={orgId} value={assignees} onChange={handleAssigneeChange} />
              <p className="text-meta text-text-muted mt-1">Must be someone below you in the hierarchy.</p>
            </div>

            {/* Kind */}
            <div>
              <Label className="mb-1.5">Frequency</Label>
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
                <Label className="mb-1.5">Deadline</Label>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <DatePicker
                      value={deadlineDate}
                      onChange={(iso) => {
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
              </div>
            ) : (
              <div>
                <Label className="mb-1.5">Recurrence</Label>
                <ScheduleEntryList entries={schedules} onChange={setSchedules} />
              </div>
            )}

            {error && <p className="text-body text-danger">{error}</p>}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving} loadingLabel="Creating">
            Demand log
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
