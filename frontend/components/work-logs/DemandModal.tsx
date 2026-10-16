'use client'

import React, { useState } from 'react'
import { X } from 'lucide-react'
import DatePicker from '@/components/ui/DatePicker'
import TimeField from '@/components/ui/TimeField'
import AssigneeSelector from '@/components/tasks/AssigneeSelector'
import ScheduleEntryList from '@/components/tasks/ScheduleEntryList'
import type { ScheduleEntryDraft } from '@/components/tasks/ScheduleEntryRow'
import type { SelectedAssignee } from '@/lib/types/tasks'
import { workLogApi } from '@/lib/api/workLogs'
import type { CreateDemandPayload } from '@/lib/types/workLogs'

interface Props {
  orgId: string
  onClose: () => void
  onCreated: () => void
}

const inputCls =
  'w-full border border-[#CBD5E1] rounded-[8px] px-3 py-2 text-sm text-[#0F172A] bg-white placeholder:text-[#94A3B8] focus:border-2 focus:border-[#2563EB] focus:outline-hidden'
const labelCls = 'text-sm font-medium text-[#374151]'

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
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/30 p-0 md:p-4">
      <div className="bg-white w-full md:max-w-2xl md:rounded-[16px] rounded-t-[16px] max-h-[92vh] overflow-y-auto shadow-[0_8px_32px_rgba(0,0,0,0.18)]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E2E8F0] sticky top-0 bg-white">
          <h2 className="text-[18px] font-semibold text-[#0F172A]">Demand a log</h2>
          <button type="button" onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-[8px] text-[#94A3B8] hover:bg-[#F1F5F9]">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div>
            <label className={labelCls}>Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Update on outstanding amount" className={`${inputCls} mt-1.5`} />
          </div>

          <div>
            <label className={labelCls}>Description (optional)</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={`${inputCls} mt-1.5`} />
          </div>

          <div>
            <label className={labelCls}>Who must write this log</label>
            <div className="mt-1.5">
              <AssigneeSelector orgId={orgId} value={assignees} onChange={handleAssigneeChange} />
            </div>
            <p className="text-xs text-[#64748B] mt-1">Must be someone below you in the hierarchy.</p>
          </div>

          {/* Kind */}
          <div>
            <label className={labelCls}>Frequency</label>
            <div className="flex items-center border border-[#E2E8F0] rounded-[8px] p-0.5 gap-0.5 mt-1.5 w-fit">
              {(['one_time', 'recurring'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`px-4 py-1.5 rounded-[6px] text-sm font-semibold transition-colors ${
                    kind === k ? 'bg-[#2563EB] text-white' : 'text-[#475569] hover:bg-[#F1F5F9]'
                  }`}
                >
                  {k === 'one_time' ? 'One-time' : 'Recurring'}
                </button>
              ))}
            </div>
          </div>

          {kind === 'one_time' ? (
            <div>
              <label className={labelCls}>Deadline</label>
              <div className="mt-1.5 flex gap-2">
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
              <label className={labelCls}>Recurrence</label>
              <div className="mt-1.5">
                <ScheduleEntryList entries={schedules} onChange={setSchedules} />
              </div>
            </div>
          )}

          {error && <p className="text-sm text-[#DC2626]">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#E2E8F0] sticky bottom-0 bg-white">
          <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-[8px] text-sm font-semibold text-[#475569] hover:bg-[#F1F5F9]">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="px-5 py-2.5 rounded-[8px] text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] disabled:bg-[#E2E8F0] disabled:text-[#94A3B8]"
          >
            {saving ? 'Creating…' : 'Demand log'}
          </button>
        </div>
      </div>
    </div>
  )
}
