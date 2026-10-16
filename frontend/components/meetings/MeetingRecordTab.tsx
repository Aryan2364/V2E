'use client'

import { useState } from 'react'
import { Lock, Check } from 'lucide-react'
import Button from '@/components/ui/button'
import { useToast } from '@/components/ui/Toast'
import { meetingsApi } from '@/lib/api/meetings'
import RichEditor from '@/components/ui/RichEditor'
import type { Meeting } from '@/lib/types/meetings'

// Agenda + Minutes as true WYSIWYG editors. Bold/Heading/List format the text
// visually — the user never sees or types any symbols. Stored as markdown under
// the hood (unchanged for the copy-summary, backend, etc.).
export default function MeetingRecordTab({ orgId, meeting, canEdit, onSaved }: { orgId: string; meeting: Meeting; canEdit: boolean; onSaved: () => void }) {
  const { addToast } = useToast()
  const locked = meeting.status === 'closed' || meeting.status === 'cancelled' || !canEdit
  const [agenda, setAgenda] = useState(meeting.agenda ?? '')
  const [minutes, setMinutes] = useState(meeting.minutes ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await meetingsApi.updateRecord(orgId, meeting.id, { agenda, minutes })
      addToast('Record saved', 'success')
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      onSaved()
    } catch (e: any) {
      addToast(e?.response?.data?.message ?? 'Failed to save', 'error')
    } finally {
      setSaving(false)
    }
  }

  const labelCls = 'block text-body font-medium text-text-secondary mb-1.5'

  return (
    <div className="bg-surface border border-border-light rounded-[12px] p-6 flex flex-col gap-4">
      {meeting.status === 'closed' && (
        <div className="flex items-center gap-2 text-body text-text-secondary bg-surface-sunken border border-border-light rounded-[8px] px-3 py-2">
          <Lock size={14} /> This meeting is closed — the record is the official, locked version.
        </div>
      )}

      <div>
        <label className={labelCls}>Agenda</label>
        <RichEditor value={agenda} onChange={setAgenda} disabled={locked} minRows={3} placeholder="What will you discuss? One point per line." />
      </div>

      <div>
        <label className={labelCls}>Minutes</label>
        <RichEditor value={minutes} onChange={setMinutes} disabled={locked} minRows={5} placeholder="Capture what was discussed and the decisions made." />
      </div>

      {!locked && (
        <div className="flex justify-end items-center gap-3">
          {saved && <span className="inline-flex items-center gap-1 text-body font-medium text-success"><Check size={15} /> Saved</span>}
          <Button variant="primary" onClick={save} isLoading={saving} disabled={saving}>Save record</Button>
        </div>
      )}
    </div>
  )
}
