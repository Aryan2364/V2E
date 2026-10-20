'use client'

import { useEffect, useState } from 'react'
import { CalendarClock, Trash2, RefreshCw } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import DatePicker from '@/components/ui/DatePicker'
import TimeField from '@/components/ui/TimeField'
import { timeBlocksApi, type TimeBlock } from '@/lib/api/time-blocks'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { useGuardedClose } from '@/lib/use-guarded-close'

const labelClass = 'block text-body font-medium text-text-secondary mb-1.5'
const inputClass =
  'w-full border border-border rounded-[8px] px-3 py-2 text-body text-text-primary bg-surface focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary'

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

  // Field errors sit under the field that is wrong (kit 11.3 rule 6).
  const [fieldErrors, setFieldErrors] = useState<{ title?: string; date?: string; time?: string }>({})
  function failField(key: 'title' | 'date' | 'time', message: string, focusId: string) {
    setFieldErrors({ [key]: message })
    requestAnimationFrame(() => {
      const el = document.getElementById(focusId)
      ;(el?.matches('input,textarea,button') ? el : el?.querySelector<HTMLElement>('input,button'))?.focus()
    })
  }
  const guarded = useGuardedClose({
    open: isOpen,
    values: { title, note, date, startTime, endTime },
    noun: 'time block',
    mode: isEditing ? 'edit' : 'create',
    onClose,
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!title.trim()) return failField('title', 'Enter a name for the time block.', 'time-block-name')
    if (!date) return failField('date', 'Choose the date of the time block.', 'time-block-date')
    const startAt = new Date(`${date}T${startTime}:00`)
    const endAt = new Date(`${date}T${endTime}:00`)
    if (endAt <= startAt) return failField('time', 'Choose an end time after the start time.', 'time-block-end')
    setFieldErrors({})
    setBusy(true)
    try {
      const payload = { title: title.trim(), note: note.trim() || undefined, start_at: startAt.toISOString(), end_at: endAt.toISOString() }
      const saved = block
        ? await timeBlocksApi.update(orgId, block.id, payload)
        : await timeBlocksApi.create(orgId, payload)
      onSaved(saved)
      onClose()
    } catch {
      setError('Could not save the time block. Try again.')
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
      setError('Could not delete the time block. Try again.')
      setBusy(false)
    }
  }

  return (
    <>
    {guarded.warning}
    <Modal isOpen={isOpen} onClose={guarded.requestClose} title={isEditing ? 'Edit time block' : 'New time block'} size="md">
      <form onSubmit={handleSubmit} className="flex flex-col gap-[18px]">
        {isGoogle ? (
          <div className="flex items-start gap-2 text-meta text-text-muted bg-surface-sunken border border-border-light rounded-[8px] px-3 py-2">
            <RefreshCw size={15} className="text-primary-text mt-0.5 shrink-0" />
            <span>Synced from your Google Calendar. Editing or deleting it here updates Google too. Colleagues only see &ldquo;Busy&rdquo;.</span>
          </div>
        ) : (
          <div className="flex items-start gap-2 text-meta text-text-muted bg-surface-sunken border border-border-light rounded-[8px] px-3 py-2">
            <CalendarClock size={15} className="text-primary-text mt-0.5 shrink-0" />
            <span>Blocks your time so nobody double-books you. Only you see the name — colleagues just see &ldquo;Busy&rdquo;. Synced to your Google Calendar.</span>
          </div>
        )}

        <div>
          <Label className="mb-2" htmlFor="time-block-name" required>Name</Label>
          <input id="time-block-name" className={`${inputClass} aria-invalid:border-danger`} aria-invalid={fieldErrors.title ? true : undefined} value={title} onChange={(e) => { setTitle(e.target.value); setFieldErrors((p) => (p.title ? { ...p, title: undefined } : p)) }} placeholder="For example, Dentist" autoFocus={!isEditing} />
          <InlineFieldError>{fieldErrors.title}</InlineFieldError>
        </div>

        <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-3">
          <div>
            <Label className="mb-2" htmlFor="time-block-date" required>Date</Label>
            <DatePicker id="time-block-date" invalid={!!fieldErrors.date} value={date} onChange={(v) => { setDate(v); setFieldErrors((p) => (p.date ? { ...p, date: undefined } : p)) }} placeholder="Select date" />
            <InlineFieldError>{fieldErrors.date}</InlineFieldError>
          </div>
          <div>
            <Label className="mb-2">Start</Label>
            <TimeField value={startTime} onChange={(t) => { setEndTime(addMinutes(t, minutesBetween(startTime, endTime))); setStartTime(t) }} />
          </div>
          <div>
            <Label className="mb-2">End</Label>
            <div id="time-block-end"><TimeField value={endTime} onChange={(t) => { setEndTime(t); setFieldErrors((p) => (p.time ? { ...p, time: undefined } : p)) }} /></div>
            <InlineFieldError>{fieldErrors.time}</InlineFieldError>
          </div>
        </div>

        <div>
          <Label className="mb-2">Private note</Label>
          <textarea className={`${inputClass} min-h-[64px] resize-y`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything you want to remember" />
        </div>

        {error && <p role="alert" className="text-label text-danger">{error}</p>}

        {confirmDelete && (
          <div className="flex items-center justify-between gap-3 bg-danger-bg border border-danger-border rounded-[8px] px-3 py-2.5">
            <span className="text-body text-danger">Delete this block? It is also removed from your Google Calendar.</span>
            <div className="flex items-center gap-2 shrink-0">
              <Button type="button" variant="secondary" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button type="button" variant="danger" size="sm" onClick={handleDelete} disabled={busy}>Delete</Button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <div>
            {isEditing && !confirmDelete && (
              <Button type="button" variant="secondary" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={15} /> Delete
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={guarded.requestClose} disabled={busy}>Cancel</Button>
            <Button type="submit" loading={busy} loadingLabel="Saving" disabled={busy}>{isEditing ? 'Save time block' : 'Add time block'}</Button>
          </div>
        </div>
      </form>
    </Modal>
    </>
  )
}
