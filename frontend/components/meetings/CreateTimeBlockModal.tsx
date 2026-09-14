'use client'

import { useEffect, useState } from 'react'
import { CalendarClock, Trash2, RefreshCw } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import DatePicker from '@/components/ui/DatePicker'
import TimeField from '@/components/ui/TimeField'
import { timeBlocksApi, type TimeBlock } from '@/lib/api/time-blocks'

const labelClass = 'block text-sm font-medium text-[#334155] mb-1.5'
const inputClass =
  'w-full border border-[#CBD5E1] rounded-[8px] px-3 py-2 text-sm text-[#0F172A] bg-white focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]'

function pad(n: number) { return String(n).padStart(2, '0') }
function timeToMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}
function minutesBetween(start: string, end: string): number {
  const diff = timeToMin(end) - timeToMin(start)
  return diff > 0 ? diff : diff + 1440
}
function addMinutes(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(':').map(Number)
  const total = ((h * 60 + m + mins) % 1440 + 1440) % 1440
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
}
function dateStr(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
function timeStr(d: Date) { return `${pad(d.getHours())}:${pad(d.getMinutes())}` }

// Create, edit or delete a personal Time-Block. A block is the user's own
// availability — named like a calendar event, private (colleagues see only
// "Busy"), and kept in two-way sync with their Google Calendar. Blocks imported
// from Google are fully editable here too — changes flow back to Google.
export default function CreateTimeBlockModal({
  isOpen,
  onClose,
  orgId,
  initialStart,
  block,
  onSaved,
  onDeleted,
}: {
  isOpen: boolean
  onClose: () => void
  orgId: string
  initialStart?: string
  block?: TimeBlock | null
  onSaved: (b: TimeBlock) => void
  onDeleted?: () => void
}) {
  const isEditing = !!block
  const isGoogle = block?.source === 'google'

  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('10:00')
  const [endTime, setEndTime] = useState('11:00')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setError(''); setBusy(false); setConfirmDelete(false)
    if (block) {
      const s = new Date(block.start_at)
      const e = new Date(block.end_at)
      setTitle(block.title); setNote(block.note ?? '')
      setDate(dateStr(s)); setStartTime(timeStr(s)); setEndTime(timeStr(e))
    } else if (initialStart) {
      const d = new Date(initialStart)
      setTitle(''); setNote('')
      setDate(dateStr(d)); setStartTime(timeStr(d)); setEndTime(addMinutes(timeStr(d), 60))
    } else {
      const now = new Date()
      setTitle(''); setNote('')
      setDate(dateStr(now)); setStartTime('10:00'); setEndTime('11:00')
    }
  }, [isOpen, initialStart, block])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!title.trim()) { setError('Give this block a name.'); return }
    if (!date) { setError('Pick a date.'); return }
    const startAt = new Date(`${date}T${startTime}:00`)
    const endAt = new Date(`${date}T${endTime}:00`)
    if (endAt <= startAt) { setError('End time must be after the start time.'); return }
    setBusy(true)
    try {
      const payload = { title: title.trim(), note: note.trim() || undefined, start_at: startAt.toISOString(), end_at: endAt.toISOString() }
      const saved = block
        ? await timeBlocksApi.update(orgId, block.id, payload)
        : await timeBlocksApi.create(orgId, payload)
      onSaved(saved)
      onClose()
    } catch {
      setError('Could not save. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!block) return
    setBusy(true)
    try {
      await timeBlocksApi.remove(orgId, block.id)
      onDeleted?.()
      onClose()
    } catch {
      setError('Could not delete. Please try again.')
      setBusy(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isEditing ? 'Edit time-block' : 'New time-block'} size="md" closeOnEscape={false}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-[18px]">
        {isGoogle ? (
          <div className="flex items-start gap-2 text-xs text-[#64748B] bg-[#F8FAFC] border border-[#E2E8F0] rounded-[8px] px-3 py-2">
            <RefreshCw size={15} className="text-[#2563EB] mt-0.5 shrink-0" />
            <span>Synced from your Google Calendar. Editing or deleting it here updates Google too. Colleagues only see &ldquo;Busy&rdquo;.</span>
          </div>
        ) : (
          <div className="flex items-start gap-2 text-xs text-[#64748B] bg-[#F8FAFC] border border-[#E2E8F0] rounded-[8px] px-3 py-2">
            <CalendarClock size={15} className="text-[#2563EB] mt-0.5 shrink-0" />
            <span>Blocks your time so nobody double-books you. Only you see the name — colleagues just see &ldquo;Busy&rdquo;. Synced to your Google Calendar.</span>
          </div>
        )}

        <div>
          <label className={labelClass}>Name <span className="text-[#DC2626]">*</span></label>
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Dentist, Focus time, Lunch" autoFocus={!isEditing} />
        </div>

        <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-3">
          <div>
            <label className={labelClass}>Date <span className="text-[#DC2626]">*</span></label>
            <DatePicker value={date} onChange={setDate} placeholder="Select date" />
          </div>
          <div>
            <label className={labelClass}>Start</label>
            <TimeField value={startTime} onChange={(t) => { setEndTime(addMinutes(t, minutesBetween(startTime, endTime))); setStartTime(t) }} />
          </div>
          <div>
            <label className={labelClass}>End</label>
            <TimeField value={endTime} onChange={setEndTime} />
          </div>
        </div>

        <div>
          <label className={labelClass}>Note <span className="text-[#94A3B8] font-normal">(optional, private)</span></label>
          <textarea className={`${inputClass} min-h-[64px] resize-y`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything you want to remember" />
        </div>

        {error && <p className="text-sm text-[#DC2626]">{error}</p>}

        {confirmDelete && (
          <div className="flex items-center justify-between gap-3 bg-[#FEF2F2] border border-[#FECACA] rounded-[8px] px-3 py-2.5">
            <span className="text-sm text-[#B91C1C]">Delete this block? It is also removed from your Google Calendar.</span>
            <div className="flex items-center gap-2 shrink-0">
              <button type="button" onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 text-sm font-medium text-[#475569] border border-[#E2E8F0] rounded-[8px] bg-white hover:bg-[#F8FAFC]">Cancel</button>
              <button type="button" onClick={handleDelete} disabled={busy} className="px-3 py-1.5 text-sm font-semibold text-white bg-[#DC2626] hover:bg-[#B91C1C] rounded-[8px] disabled:opacity-50">Delete</button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <div>
            {isEditing && !confirmDelete && (
              <button type="button" onClick={() => setConfirmDelete(true)} className="inline-flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium text-[#B91C1C] border border-[#FECACA] rounded-[8px] hover:bg-[#FEF2F2]">
                <Trash2 size={15} /> Delete
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2.5 text-sm font-medium text-[#475569] border border-[#E2E8F0] rounded-[8px] hover:bg-[#F8FAFC]">Cancel</button>
            <button type="submit" disabled={busy} className="px-4 py-2.5 text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-[8px] disabled:opacity-50">
              {busy ? 'Saving…' : isEditing ? 'Save changes' : 'Create time-block'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
