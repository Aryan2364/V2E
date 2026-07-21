'use client'

import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Loader2, Target } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import DatePicker from '@/components/ui/DatePicker'
import EmployeePicker from '@/components/ui/EmployeePicker'
import { useToast } from '@/components/ui/Toast'
import { delegationsApi, type Delegation, type DelegationInput } from '@/lib/api/delegations'

// Base has NO width utility — callers add `w-full` (most fields) or a flex sizing
// (the criteria row) so `w-full` never fights `w-28`/`flex-1` and overflows the row.
const fieldBase =
  'border border-[#CBD5E1] rounded-[8px] px-3 py-2 text-[15px] text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]'
const inputClass = `w-full ${fieldBase}`
const labelClass = 'block text-sm font-medium text-[#374151] mb-1'

interface EmployeeOption {
  user_id: string
  name: string
  role_title?: string | null
  department_name?: string | null
}
interface CriterionRow {
  description: string
  target: string
}

interface Props {
  isOpen: boolean
  onClose: () => void
  orgId: string
  employees: EmployeeOption[]
  currentUser?: { user_id: string; name: string }
  /** When set, the modal edits this delegation instead of creating a new one. */
  existing?: Delegation | null
  onSaved: (d: Delegation) => void
}

const emptyRow = (): CriterionRow => ({ description: '', target: '' })

export default function DelegationModal({
  isOpen,
  onClose,
  orgId,
  employees,
  currentUser,
  existing,
  onSaved,
}: Props) {
  const { addToast } = useToast()
  const isEdit = !!existing

  const [title, setTitle] = useState('')
  const [outcome, setOutcome] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [kra, setKra] = useState('')
  const [runningBy, setRunningBy] = useState('')
  const [firstCheckIn, setFirstCheckIn] = useState('')
  const [criteria, setCriteria] = useState<CriterionRow[]>([emptyRow()])
  const [saving, setSaving] = useState(false)

  // (Re)seed the form whenever the modal opens or the target delegation changes.
  useEffect(() => {
    if (!isOpen) return
    setTitle(existing?.title ?? '')
    setOutcome(existing?.outcome ?? '')
    setOwnerId(existing?.owner_user_id ?? '')
    setKra(existing?.kra ?? '')
    setRunningBy(existing?.running_by ? existing.running_by.slice(0, 10) : '')
    setFirstCheckIn(existing?.first_check_in ? existing.first_check_in.slice(0, 10) : '')
    setCriteria(
      existing?.criteria?.length
        ? existing.criteria.map((c) => ({ description: c.description, target: c.target ?? '' }))
        : [emptyRow()],
    )
  }, [isOpen, existing])

  const ownerOptions = useMemo(() => employees.filter((e) => e.user_id && e.name), [employees])

  const patchRow = (i: number, patch: Partial<CriterionRow>) =>
    setCriteria((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))

  const canSubmit = title.trim() && outcome.trim() && ownerId

  async function handleSubmit() {
    if (!canSubmit) {
      addToast('Title, outcome and owner are required.', 'error')
      return
    }
    const payload: DelegationInput = {
      title: title.trim(),
      outcome: outcome.trim(),
      owner_user_id: ownerId,
      kra: kra.trim() || undefined,
      running_by: runningBy || undefined,
      first_check_in: firstCheckIn || undefined,
      criteria: criteria
        .map((c) => ({ description: c.description.trim(), target: c.target.trim() || undefined }))
        .filter((c) => c.description.length > 0),
    }
    setSaving(true)
    try {
      const saved = isEdit
        ? await delegationsApi.update(orgId, existing!.id, payload)
        : await delegationsApi.create(orgId, payload)
      addToast(isEdit ? 'Delegation updated.' : 'Delegation created.', 'success')
      onSaved(saved)
      onClose()
    } catch (err: any) {
      addToast(err?.response?.data?.message ?? 'Could not save delegation.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isEdit ? 'Edit delegation' : 'New delegation'} size="lg" closeOnEscape={false}>
      <div className="flex flex-col gap-4">
        {/* Title */}
        <div>
          <label className={labelClass}>Title *</label>
          <input
            className={inputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Short name for this delegation"
            maxLength={200}
          />
        </div>

        {/* Outcome */}
        <div>
          <label className={labelClass}>Outcome *</label>
          <textarea
            className={`${inputClass} min-h-[72px] resize-y`}
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            placeholder="What responsibility or result is being handed over?"
            maxLength={4000}
          />
        </div>

        {/* Owner + dates */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Owner *</label>
            <EmployeePicker
              value={ownerId}
              onChange={setOwnerId}
              employees={ownerOptions}
              currentUser={currentUser}
              title="Select owner"
              placeholder="Who will own this?"
            />
          </div>
          <div>
            <label className={labelClass}>Fully running by</label>
            <DatePicker value={runningBy} onChange={setRunningBy} placeholder="Handover target date" />
          </div>
        </div>

        {/* KRA (free text) + first check-in */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>KRA</label>
            <input
              className={inputClass}
              value={kra}
              onChange={(e) => setKra(e.target.value)}
              placeholder="Key result area this covers"
              maxLength={2000}
            />
          </div>
          <div>
            <label className={labelClass}>First check-in</label>
            <DatePicker value={firstCheckIn} onChange={setFirstCheckIn} placeholder="First review date" />
            <p className="text-xs text-[#64748B] mt-1">A review task is created for you on this date.</p>
          </div>
        </div>

        {/* Measurable success criteria */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className={`${labelClass} mb-0 flex items-center gap-1.5`}>
              <Target size={14} className="text-[#2563EB]" /> Success criteria
            </label>
            <button
              type="button"
              onClick={() => setCriteria((r) => [...r, emptyRow()])}
              className="w-7 h-7 flex items-center justify-center rounded-[8px] bg-[#2563EB] text-white hover:bg-[#1D4ED8] transition-colors"
              title="Add criterion"
            >
              <Plus size={15} />
            </button>
          </div>
          <p className="text-xs text-[#64748B] mb-2">What does “done” look like — measurably?</p>
          <div className="flex flex-col gap-2">
            {criteria.map((row, i) => (
              <div key={i} className="flex items-start gap-2">
                <input
                  className={`${fieldBase} flex-1 min-w-0`}
                  value={row.description}
                  onChange={(e) => patchRow(i, { description: e.target.value })}
                  placeholder="What done looks like"
                  maxLength={500}
                />
                <input
                  className={`${fieldBase} w-28 shrink-0`}
                  value={row.target}
                  onChange={(e) => patchRow(i, { target: e.target.value })}
                  placeholder="Target"
                  maxLength={200}
                />
                <button
                  type="button"
                  onClick={() => setCriteria((r) => (r.length > 1 ? r.filter((_, idx) => idx !== i) : [emptyRow()]))}
                  className="w-9 h-9 flex items-center justify-center rounded-[8px] text-[#94A3B8] hover:text-[#DC2626] hover:bg-[#FEF2F2] transition-colors shrink-0"
                  title="Remove"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Footer — X handles cancel (no duplicate Cancel button per design rules) */}
        <div className="flex justify-end pt-2 border-t border-[#F1F5F9]">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || saving}
            className="flex items-center gap-2 px-5 py-2.5 rounded-[8px] text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] transition-colors"
          >
            {saving && <Loader2 size={15} className="animate-spin" />}
            {isEdit ? 'Save changes' : 'Create delegation'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
